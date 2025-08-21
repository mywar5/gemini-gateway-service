import { FastifyInstance } from "fastify"
import { buildServer } from "../server"
import * as fs from "fs/promises"
import { Readable } from "stream"

// Mock dependencies at the top level
jest.mock("fs/promises")
jest.mock("google-auth-library", () => {
	const mockRequest = jest.fn().mockImplementation(async (config: any) => {
		if (config.url.includes("streamGenerateContent")) {
			const mockStream = new Readable({ read() {} })
			setTimeout(() => {
				mockStream.push('data: {"candidates":[{"content":{"parts":[{"text":"E2E Test"}]}}]}')
				mockStream.push(null) // End stream
			}, 10)
			return { data: mockStream }
		}
		// Mock for project ID discovery
		return { data: { cloudaicompanionProject: "e2e-project-id" } }
	})

	const mockOAuth2Client = {
		setCredentials: jest.fn(),
		refreshAccessToken: jest.fn().mockResolvedValue({
			credentials: { access_token: "new_access_token", expiry_date: Date.now() + 3600000 },
		}),
		request: mockRequest,
	}
	return {
		OAuth2Client: jest.fn().mockImplementation(() => mockOAuth2Client),
	}
})

const mockedFs = fs as jest.Mocked<typeof fs>

describe("End-to-End Chat Completion", () => {
	let server: FastifyInstance

	beforeAll(async () => {
		// Setup mock file system for account pool initialization
		const mockCredential = {
			projectId: "test-project-e2e",
			credentials: {
				access_token: "fake-access-token",
				refresh_token: "fake-refresh-token",
				expiry_date: Date.now() + 3600000,
			},
		}
		mockedFs.readdir.mockResolvedValue(["test-account.json"] as any)
		mockedFs.readFile.mockResolvedValue(JSON.stringify(mockCredential))
		mockedFs.writeFile.mockResolvedValue() // Mock writeFile for token refreshes

		server = buildServer()
		await server.ready() // Wait for the server and its plugins to be ready
	})

	afterAll(async () => {
		await server.close()
	})

	it("should process a valid streaming request through the full server stack", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/v1/chat/completions",
			payload: {
				model: "gemini-1.0-pro",
				messages: [{ role: "user", content: "This is an E2E test" }],
				stream: true,
			},
		})

		expect(response.statusCode).toBe(200)
		expect(response.headers["content-type"]).toBe("text/event-stream")

		const body = response.body
		expect(body).toContain('"delta":{"content":"E2E Test"}')
		expect(body).toContain("data: [DONE]")
	})

	it("should return 400 if the payload is invalid", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/v1/chat/completions",
			payload: {
				// Missing 'messages'
				model: "gemini-1.0-pro",
				stream: true,
			},
		})

		expect(response.statusCode).toBe(400)
		expect(response.json().error).toContain("Missing required fields")
	})
})
