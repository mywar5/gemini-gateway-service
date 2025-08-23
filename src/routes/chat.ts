import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { Readable } from "stream"
import { convertToGeminiMessages, convertToOpenAIStreamChunk, createStreamEndChunk } from "../utils/transformations"

// Define the expected request body structure
interface ChatCompletionRequestBody {
	messages: { role: "user" | "assistant" | "system"; content: string }[]
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
				let chunkCounter = 0

				for await (const chunk of stream) {
					chunkCounter++
					const rawChunk = chunk.toString()
					server.log.info({ chunk: rawChunk, chunkNumber: chunkCounter }, "Received a raw chunk from stream.")
					buffer += rawChunk

					// This logic correctly handles a stream of concatenated or fragmented JSON objects.
					let braceLevel = 0
					let objectStartIndex = -1

					let i = 0
					while (i < buffer.length) {
						if (buffer[i] === "{") {
							if (braceLevel === 0) {
								objectStartIndex = i
							}
							braceLevel++
						} else if (buffer[i] === "}") {
							braceLevel--
							if (braceLevel === 0 && objectStartIndex !== -1) {
								const objectStr = buffer.substring(objectStartIndex, i + 1)
								try {
									const geminiChunk = JSON.parse(objectStr)
									const openAIChunk = convertToOpenAIStreamChunk(geminiChunk, body.model)
									if (openAIChunk && !reply.raw.writableEnded) {
										server.log.info(
											{ object: objectStr },
											"Parsed and writing a complete JSON object.",
										)
										reply.raw.write(openAIChunk)
									}
									// Reset buffer to the part after the parsed object
									buffer = buffer.substring(i + 1)
									// Reset search for the next object
									i = -1
									objectStartIndex = -1
									braceLevel = 0
								} catch (e) {
									server.log.warn({ object: objectStr }, "Failed to parse a potential JSON object.")
								}
							}
						}
						i++
					}
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
