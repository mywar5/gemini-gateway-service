import fastify, { FastifyInstance } from "fastify"
import { registerChatRoutes } from "../chat"
import { GeminiAccountPool } from "../../services/gemini-account-pool"
import { Readable } from "stream"
import * as transformations from "../../utils/transformations"

// Mock the account pool and transformations
jest.mock("../../services/gemini-account-pool")
jest.mock("../../utils/transformations", () => ({
	...jest.requireActual("../../utils/transformations"), // Import and retain default behavior
	createInitialAssistantChunk: jest.fn(), // Mock the specific function
}))

const mockGeminiAccountPool = GeminiAccountPool as jest.MockedClass<typeof GeminiAccountPool>
const mockCreateInitialAssistantChunk = transformations.createInitialAssistantChunk as jest.Mock

describe("Chat Routes", () => {
	let server: FastifyInstance

	beforeEach(() => {
		// Reset mocks before each test
		mockCreateInitialAssistantChunk.mockClear()

		server = fastify()
		const mockPoolInstance: jest.Mocked<GeminiAccountPool> = new (mockGeminiAccountPool as any)("/fake/path")

		// Mock the executeRequest method
		mockPoolInstance.executeRequest.mockImplementation(async (_executor: any) => {
			const mockStream = new Readable({ read() {} })
			const chunks = [
				`[{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}]`,
				`,`,
				`{"candidates":[{"content":{"parts":[{"text":" world"}]}}]}]`,
				`,`,
				`{"candidates":[{"content":{"parts":[{"text":"!"}]}}]}]`,
			]

			// Push all chunks asynchronously in the next tick of the event loop
			// to ensure the test framework can await the full stream.
			process.nextTick(() => {
				for (const chunk of chunks) {
					mockStream.push(chunk)
				}
				mockStream.push(null)
			})

			return mockStream
		})

		server.decorate("accountPool", mockPoolInstance)
		registerChatRoutes(server)
	})

	afterEach(() => {
		server.close()
	})

	it("POST /v1/chat/completions should return a stream for a valid request", async () => {
		const model = "gemini-1.0-pro"
		const initialChunkContent = `data: {"id":"chatcmpl-initial","object":"chat.completion.chunk","created":12345,"model":"${model}","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`
		mockCreateInitialAssistantChunk.mockReturnValue(initialChunkContent)

		const response = await server.inject({
			method: "POST",
			url: "/v1/chat/completions",
			payload: {
				model,
				messages: [{ role: "user", content: "Test" }],
				stream: true,
			},
		})

		expect(response.statusCode).toBe(200)
		expect(response.headers["content-type"]).toBe("text/event-stream")

		// Verify that the initial chunk function was called and its result is in the body
		expect(mockCreateInitialAssistantChunk).toHaveBeenCalledWith(model)
		expect(response.body.startsWith(initialChunkContent)).toBe(true)
		const body = response.body
		// Check for OpenAI stream format from the actual stream data
		expect(body).toContain('"delta":{"content":"Hello"}')
		expect(body).toContain('"delta":{"content":" world"}')
		expect(body).toContain('"delta":{"content":"!"}')
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
