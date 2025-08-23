import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { Readable } from "stream"
import {
	convertToGeminiMessages,
	convertToOpenAIStreamChunk,
	createInitialAssistantChunk,
	createStreamEndChunk,
	OpenAIChatMessage,
} from "../utils/transformations"

// Define the expected request body structure, aligning with the transformation logic
interface ChatCompletionRequestBody {
	messages: OpenAIChatMessage[]
	model: string
	stream?: boolean
}

export function registerChatRoutes(server: FastifyInstance) {
	server.post("/v1/chat/completions", async (request: FastifyRequest, reply: FastifyReply) => {
		const body = request.body as ChatCompletionRequestBody

		if (!body.messages || !body.model) {
			return reply.code(400).send({ error: "Missing required fields: messages and model" })
		}

		if (body.stream) {
			// Set headers for Server-Sent Events (SSE)
			reply.raw.writeHead(200, {
				"Content-Type": "text/event-stream",
				Connection: "keep-alive",
				"Cache-Control": "no-cache",
			})

			try {
				// Send the initial assistant role chunk to establish the stream
				const initialChunk = createInitialAssistantChunk(body.model)
				reply.raw.write(initialChunk)

				const geminiMessages = convertToGeminiMessages(body.messages)

				const abortController = new AbortController()
				request.raw.on("close", () => {
					if (request.raw.aborted) {
						server.log.warn("Client connection closed, aborting Gemini request.")
						abortController.abort()
					}
				})

				const stream = await server.accountPool.executeRequest(async (callApi, projectId) => {
					const modelId = body.model.includes("/") ? body.model.split("/").pop() : body.model
					const requestBody = {
						model: modelId,
						project: projectId,
						request: { contents: geminiMessages },
					}
					server.log.info({ requestBody }, "Sending request to Gemini stream API")
					const responseStream = await callApi("streamGenerateContent", requestBody, abortController.signal)
					return responseStream as Readable
				})

				server.log.info("Successfully obtained stream from Gemini API. Starting to process chunks...")

				let buffer = ""
				let lastSentText = ""
				let chunkCounter = 0
				let braceLevel = 0
				let inJsonArray = false

				const processBuffer = () => {
					// This function processes the buffer to find and parse complete JSON objects from the stream.
					while (true) {
						if (!inJsonArray) {
							const arrayStartIndex = buffer.indexOf("[")
							if (arrayStartIndex !== -1) {
								buffer = buffer.substring(arrayStartIndex + 1)
								inJsonArray = true
							} else {
								// If no array start is found and buffer is not empty, it's likely malformed data.
								if (buffer.length > 0) buffer = ""
								break
							}
						}

						const objectStartIndex = buffer.indexOf("{")
						if (objectStartIndex === -1) {
							break // No start of a new object, wait for more data.
						}

						// Scan for the matching closing brace.
						let i = objectStartIndex
						braceLevel = 0
						let foundObject = false
						for (; i < buffer.length; i++) {
							if (buffer[i] === "{") {
								braceLevel++
							} else if (buffer[i] === "}") {
								braceLevel--
								if (braceLevel === 0) {
									const objectStr = buffer.substring(objectStartIndex, i + 1)
									try {
										const geminiChunk = JSON.parse(objectStr)
										// Ensure we pass the inner 'response' object if it exists.
										const contentChunk = geminiChunk.response || geminiChunk
										const result = convertToOpenAIStreamChunk(contentChunk, body.model, lastSentText)

										if (result && result.sseChunk && !reply.raw.writableEnded) {
											reply.raw.write(result.sseChunk)
											lastSentText = result.fullText
										}
									} catch (e) {
										server.log.warn({ object: objectStr, error: e }, "Failed to parse a JSON object from stream.")
									}
									buffer = buffer.substring(i + 1)
									foundObject = true
									break // Restart the while loop to process the rest of the buffer.
								}
							}
						}

						if (!foundObject) {
							break // Incomplete object in buffer, wait for more data.
						}
					}
				}

				for await (const chunk of stream) {
					chunkCounter++
					const rawChunk = chunk.toString()
					server.log.info({ chunk: rawChunk, chunkNumber: chunkCounter }, "Received a raw chunk from stream.")
					buffer += rawChunk
					processBuffer()
				}

				server.log.info({ finalChunkCount: chunkCounter }, "Stream processing loop finished.")
				reply.raw.write(createStreamEndChunk())
			} catch (error: any) {
				server.log.error(`Stream error: ${error.message}`)
				if (!reply.raw.writableEnded) {
					const errorChunk = JSON.stringify({
						error: { message: error.message, type: "internal_server_error" },
					})
					reply.raw.write(`data: ${errorChunk}\n\n`)
					reply.raw.write(createStreamEndChunk())
				}
			} finally {
				if (!reply.raw.writableEnded) {
					server.log.info("Ending the response stream.")
					reply.raw.end()
				}
			}
		} else {
			// Non-streamed response (Not implemented for this example)
			reply.code(501).send({ error: "Non-streamed responses are not implemented." })
		}
	})
}
