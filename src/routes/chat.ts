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

				// Manually create an AbortController to handle client connection closing.
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
				let lastSentIndex = -1
				let chunkCounter = 0

				for await (const chunk of stream) {
					chunkCounter++
					const rawChunk = chunk.toString()
					server.log.info({ chunk: rawChunk, chunkNumber: chunkCounter }, "Received a raw chunk from stream.")
					buffer += rawChunk

					try {
						const geminiChunks = JSON.parse(buffer)
						if (Array.isArray(geminiChunks)) {
							server.log.info(
								{ count: geminiChunks.length },
								"Successfully parsed buffer into a JSON array.",
							)
							for (let i = lastSentIndex + 1; i < geminiChunks.length; i++) {
								const geminiChunk = geminiChunks[i]
								const openAIChunk = convertToOpenAIStreamChunk(geminiChunk, body.model)
								if (openAIChunk && !reply.raw.writableEnded) {
									server.log.info({ index: i }, "Writing converted OpenAI chunk to response.")
									reply.raw.write(openAIChunk)
								}
								lastSentIndex = i
							}
						}
					} catch (e) {
						server.log.trace(
							{ bufferLength: buffer.length },
							"Buffer is not a complete JSON array yet. Continuing to buffer.",
						)
					}
				}

				server.log.info({ finalChunkCount: chunkCounter }, "Stream processing loop finished.")

				try {
					const geminiChunks = JSON.parse(buffer)
					if (Array.isArray(geminiChunks)) {
						for (let i = lastSentIndex + 1; i < geminiChunks.length; i++) {
							const geminiChunk = geminiChunks[i]
							const openAIChunk = convertToOpenAIStreamChunk(geminiChunk, body.model)
							if (openAIChunk && !reply.raw.writableEnded) {
								server.log.info({ index: i }, "Writing final converted OpenAI chunk to response.")
								reply.raw.write(openAIChunk)
							}
						}
					}
				} catch (e: any) {
					server.log.error(`Failed to parse the final JSON buffer. Content: "${buffer}"`, e)
				}

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
