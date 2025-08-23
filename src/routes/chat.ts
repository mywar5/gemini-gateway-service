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
				for await (const chunk of stream) {
					buffer += chunk.toString()
					const lines = buffer.split("\n")
					buffer = lines.pop() || "" // Keep the last, possibly incomplete, line in the buffer

					for (const line of lines) {
						if (line.trim() === "") continue // Skip empty lines
						try {
							const geminiChunk = JSON.parse(line)
							const openAIChunk = convertToOpenAIStreamChunk(geminiChunk, body.model)
							if (openAIChunk && !reply.raw.writableEnded) {
								reply.raw.write(openAIChunk)
							}
						} catch (e: any) {
							server.log.warn(`Could not parse stream line as JSON: "${line}"`, e)
						}
					}
				}

				// Process any remaining data in the buffer
				if (buffer.trim() !== "" && !reply.raw.writableEnded) {
					try {
						const geminiChunk = JSON.parse(buffer)
						const openAIChunk = convertToOpenAIStreamChunk(geminiChunk, body.model)
						if (openAIChunk) {
							reply.raw.write(openAIChunk)
						}
					} catch (e: any) {
						server.log.warn(`Could not parse final buffer content as JSON: "${buffer}"`, e)
					}
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
