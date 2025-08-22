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

				const stream = await server.accountPool.executeRequest(async (callApi) => {
					const modelId = body.model.includes("/") ? body.model.split("/").pop() : body.model
					const responseStream = await callApi(`models/${modelId}:streamGenerateContent`, {
						contents: geminiMessages,
					})
					return responseStream as Readable
				})

				for await (const chunk of stream) {
					// Assuming the chunk is a buffer that needs to be parsed
					const rawJson = chunk.toString()
					// Gemini stream often sends multiple JSON objects, sometimes not perfectly formed.
					// A robust solution would handle this better.
					try {
						const geminiChunk = JSON.parse(rawJson.replace(/^data: /, ""))
						const openAIChunk = convertToOpenAIStreamChunk(geminiChunk, body.model)
						reply.raw.write(openAIChunk)
					} catch (e) {
						server.log.warn("Could not parse stream chunk:", rawJson)
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
