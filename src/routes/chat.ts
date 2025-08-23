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
					// The model ID is now part of the request body, not the URL.
					const modelId = body.model.includes("/") ? body.model.split("/").pop() : body.model
					const requestBody = {
						model: modelId,
						project: projectId,
						request: {
							contents: geminiMessages,
						},
					}
					const responseStream = await callApi(
						"streamGenerateContent", // Pass the method name directly
						requestBody,
						abortController.signal,
					)
					return responseStream as Readable
				})

				let buffer = ""
				let lastSentIndex = -1 // Keep track of the last processed object in the array

				for await (const chunk of stream) {
					buffer += chunk.toString()

					// The API returns a single JSON array that gets chunked.
					// We need to buffer until we can parse a valid array structure.
					try {
						// Attempt to parse the entire buffer as a JSON array
						const geminiChunks = JSON.parse(buffer)

						if (Array.isArray(geminiChunks)) {
							// Process only new chunks that haven't been sent yet
							for (let i = lastSentIndex + 1; i < geminiChunks.length; i++) {
								const geminiChunk = geminiChunks[i]
								const openAIChunk = convertToOpenAIStreamChunk(geminiChunk, body.model)
								if (openAIChunk && !reply.raw.writableEnded) {
									reply.raw.write(openAIChunk)
								}
								lastSentIndex = i // Update the index of the last sent chunk
							}
						}
					} catch (e) {
						// This is expected if the JSON is not yet complete.
						// We simply continue to buffer more data.
						// To avoid spamming logs, we can add a more sophisticated check later if needed.
						server.log.trace("Buffer does not contain a complete JSON array yet. Buffering more data.")
					}
				}

				// After the stream ends, there might be remaining, valid JSON in the buffer
				// that was complete but didn't trigger the try-catch block one last time.
				// This is a fallback to ensure the last piece of data is processed.
				try {
					const geminiChunks = JSON.parse(buffer)
					if (Array.isArray(geminiChunks)) {
						for (let i = lastSentIndex + 1; i < geminiChunks.length; i++) {
							const geminiChunk = geminiChunks[i]
							const openAIChunk = convertToOpenAIStreamChunk(geminiChunk, body.model)
							if (openAIChunk && !reply.raw.writableEnded) {
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
					reply.raw.end()
				}
			}
		} else {
			// Non-streamed response (Not implemented for this example)
			reply.code(501).send({ error: "Non-streamed responses are not implemented." })
		}
	})
}
