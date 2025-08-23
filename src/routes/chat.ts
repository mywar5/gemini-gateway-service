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
			reply.raw.writeHead(200, {
				"Content-Type": "text/event-stream",
				Connection: "keep-alive",
				"Cache-Control": "no-cache",
			})

			try {
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

				const decoder = new TextDecoder("utf-8")
				let buffer = ""
				let lastSentText = ""
				let chunkCounter = 0
				let braceLevel = 0
				let inJsonArray = false

				const processBuffer = () => {
					while (true) {
						if (!inJsonArray) {
							const arrayStartIndex = buffer.indexOf("[")
							if (arrayStartIndex !== -1) {
								buffer = buffer.substring(arrayStartIndex)
								inJsonArray = true
							} else {
								if (buffer.length > 0) buffer = ""
								break
							}
						}

						const objectStartIndex = buffer.indexOf("{")
						if (objectStartIndex === -1) {
							if (buffer.includes("]")) {
								inJsonArray = false
								buffer = ""
							}
							break
						}

						let i = objectStartIndex
						braceLevel = 0
						let foundObject = false
						for (; i < buffer.length; i++) {
							if (buffer[i] === "{") braceLevel++
							else if (buffer[i] === "}") {
								braceLevel--
								if (braceLevel === 0) {
									const objectStr = buffer.substring(objectStartIndex, i + 1)
									try {
										const geminiChunk = JSON.parse(objectStr)
										const contentChunk = geminiChunk.response || geminiChunk
										const result = convertToOpenAIStreamChunk(
											contentChunk,
											body.model,
											lastSentText,
										)

										if (result && result.sseChunk && !reply.raw.writableEnded) {
											reply.raw.write(result.sseChunk)
											lastSentText = result.fullText
										}
									} catch (e) {
										server.log.warn(
											{ object: objectStr, error: e },
											"Failed to parse JSON object from stream.",
										)
									}
									buffer = buffer.substring(i + 1)
									foundObject = true
									break
								}
							}
						}

						if (!foundObject) break
					}
				}

				for await (const chunk of stream) {
					chunkCounter++
					const rawChunk = decoder.decode(chunk, { stream: true })
					server.log.info({ chunk: rawChunk, chunkNumber: chunkCounter }, "Received a raw chunk from stream.")
					buffer += rawChunk
					processBuffer()
				}

				const finalChunk = decoder.decode()
				if (finalChunk) {
					buffer += finalChunk
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
