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
					const url = `projects/${projectId}/models/${modelId}:streamGenerateContent`
					const responseStream = await callApi(
						url,
						{
							contents: geminiMessages,
						},
						abortController.signal, // Pass the signal from our controller
					)
					return responseStream as Readable
				})

				for await (const chunk of stream) {
					const rawJson = chunk.toString()
					// Handle potential multiple JSON objects in a single chunk
					const jsonObjects = rawJson.match(/\{[\s\S]*?\}/g)
					if (jsonObjects) {
						for (const jsonObj of jsonObjects) {
							try {
								const geminiChunk = JSON.parse(jsonObj)
								const openAIChunk = convertToOpenAIStreamChunk(geminiChunk, body.model)
								if (!reply.raw.writableEnded) {
									reply.raw.write(openAIChunk)
								}
							} catch (e) {
								server.log.warn("Could not parse stream chunk:", jsonObj)
							}
						}
					}
				}

				reply.raw.write(createStreamEndChunk())
			} catch (error: any) {
				server.log.error(`Stream error: ${error.message}`)
				const errorChunk = JSON.stringify({ error: { message: error.message, type: "internal_server_error" } })
				reply.raw.write(`data: ${errorChunk}\n\n`)
				reply.raw.write(createStreamEndChunk())
			} finally {
				reply.raw.end()
			}
		} else {
			// Non-streamed response (Not implemented for this example)
			reply.code(501).send({ error: "Non-streamed responses are not implemented." })
		}
	})
}
