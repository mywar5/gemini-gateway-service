import fastify, { FastifyInstance } from "fastify"
import { registerChatRoutes } from "../chat"
import { GeminiAccountPool } from "../../services/gemini-account-pool"
import { Readable } from "stream"

// Mock the account pool
jest.mock("../../services/gemini-account-pool")

const mockGeminiAccountPool = GeminiAccountPool as jest.MockedClass<typeof GeminiAccountPool>

describe("Chat Routes", () => {
	let server: FastifyInstance

	beforeEach(() => {
		server = fastify()
		const mockPoolInstance: jest.Mocked<GeminiAccountPool> = new (mockGeminiAccountPool as any)("/fake/path")

		// Mock the executeRequest method
		mockPoolInstance.executeRequest.mockImplementation(async (_executor: any) => {
			const mockStream = new Readable({ read() {} })
			// Asynchronously push data to better simulate a real stream
			setTimeout(() => {
				mockStream.push('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n')
				setTimeout(() => {
					mockStream.push('data: {"candidates":[{"content":{"parts":[{"text":" World"}]}}]}\n\n')
					setTimeout(() => {
						mockStream.push(null) // End the stream
					}, 10)
				}, 10)
			}, 10)
			return mockStream
		})

		server.decorate("accountPool", mockPoolInstance)
		registerChatRoutes(server)
	})

	afterEach(() => {
		server.close()
	})

	it("POST /v1/chat/completions should return a stream for a valid request", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/v1/chat/completions",
			payload: {
				model: "gemini-1.0-pro",
				messages: [{ role: "user", content: "Test" }],
				stream: true,
			},
		})

		expect(response.statusCode).toBe(200)
		expect(response.headers["content-type"]).toBe("text/event-stream")

		const body = response.body
		// Check for OpenAI stream format
		expect(body).toContain('data: {"id":')
		expect(body).toContain('"object":"chat.completion.chunk"')
		expect(body).toContain('"delta":{"content":"Hello"}')
		expect(body).toContain('"delta":{"content":" World"}')
		expect(body).toContain("data: [DONE]")
	})

	it("POST /v1/chat/completions should return 400 for a request missing messages", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/v1/chat/completions",
			payload: {
				model: "gemini-1.0-pro",
				stream: true,
			},
		})

		expect(response.statusCode).toBe(400)
		const json = response.json()
		expect(json.error).toBe("Missing required fields: messages and model")
	})

	it("POST /v1/chat/completions should return 501 for non-streamed requests", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/v1/chat/completions",
			payload: {
				model: "gemini-1.0-pro",
				messages: [{ role: "user", content: "Test" }],
				stream: false,
			},
		})

		expect(response.statusCode).toBe(501)
	})

	it("should handle errors from the account pool gracefully", async () => {
		// @ts-ignore
		const mockPoolInstance = server.accountPool as jest.Mocked<GeminiAccountPool>
		const errorMessage = "All credentials failed or are frozen."
		mockPoolInstance.executeRequest.mockRejectedValue(new Error(errorMessage))

		const response = await server.inject({
			method: "POST",
			url: "/v1/chat/completions",
			payload: {
				model: "gemini-1.0-pro",
				messages: [{ role: "user", content: "Test" }],
				stream: true,
			},
		})

		expect(response.statusCode).toBe(200) // The stream is opened, but contains an error
		const body = response.body
		expect(body).toContain(`"error":{"message":"${errorMessage}"`)
		expect(body).toContain("data: [DONE]")
	})
})
