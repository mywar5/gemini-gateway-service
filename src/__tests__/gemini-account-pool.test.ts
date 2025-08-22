import { GeminiAccountPool } from "../services/gemini-account-pool"
import { HttpsProxyAgent } from "hpagent"
import { OAuth2Client } from "google-auth-library"
import * as fs from "fs/promises"
import { jest } from "@jest/globals"

// Mock the external dependencies
jest.mock("hpagent")
jest.mock("google-auth-library")
jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
	mkdir: jest.fn(),
}))

const mockOAuth2Client = OAuth2Client as jest.MockedClass<typeof OAuth2Client>
const mockHttpsProxyAgent = HttpsProxyAgent as jest.MockedClass<typeof HttpsProxyAgent>

describe("GeminiAccountPool", () => {
	let pool: GeminiAccountPool
	const mockCredentialsPath = "/fake/credentials"

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks()

		const mockedFs = fs as jest.Mocked<typeof fs>
		// Mock file system to return a single valid account file
		mockedFs.readdir.mockResolvedValue(["account1.json"] as any)
		mockedFs.readFile.mockResolvedValue(
			JSON.stringify({
				projectId: null, // Start with no project ID to force discovery
				credentials: {
					access_token: "fake_access_token",
					refresh_token: "fake_refresh_token",
					expiry_date: Date.now() + 3600 * 1000,
				},
			}),
		)

		// Mock the OAuth2Client's request method
		const mockRequest = jest.fn<() => Promise<any>>()
		mockRequest.mockResolvedValueOnce({
			// First call for loadCodeAssist
			data: {
				allowedTiers: [{ id: "free-tier", isDefault: true }],
			},
		})
		mockRequest.mockResolvedValueOnce({
			// Second call for onboardUser (LRO start)
			data: {
				done: false,
				name: "operations/123",
			},
		})
		mockRequest.mockResolvedValue({
			// Subsequent calls for LRO polling and final result
			data: {
				done: true,
				response: {
					cloudaicompanionProject: {
						id: "discovered-project-id",
					},
				},
			},
		})

		mockOAuth2Client.prototype.request = mockRequest as any
	})

	it("should use the discoveryAgent for project ID discovery", async () => {
		// Instantiate the pool, which triggers initialization
		pool = new GeminiAccountPool(mockCredentialsPath)

		// Wait for the initialization to complete
		// @ts-ignore - Accessing private property for testing
		await pool.initializationPromise

		// Verify that HttpsProxyAgent was instantiated twice with different options
		expect(mockHttpsProxyAgent).toHaveBeenCalledTimes(2)

		// Chat agent with HTTP/2 enabled
		expect(mockHttpsProxyAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				http2: { enable: true },
			}),
		)

		// Discovery agent without HTTP/2 enabled
		expect(mockHttpsProxyAgent).toHaveBeenCalledWith(
			expect.not.objectContaining({
				http2: expect.anything(),
			}),
		)

		// Get the instances of the mocked agents
		const chatAgentInstance = mockHttpsProxyAgent.mock.results[0].value

		// Verify that the discovery calls used the correct agent
		const requestCalls = (mockOAuth2Client.prototype.request as jest.Mock).mock.calls
		const discoveryCalls = requestCalls.filter(
			(call: any) =>
				typeof call[0]?.url === "string" &&
				(call[0].url.includes("loadCodeAssist") || call[0].url.includes("onboardUser")),
		)

		expect(discoveryCalls.length).toBeGreaterThan(0)
		discoveryCalls.forEach((call: any) => {
			const agentUsed = call[0].agent
			expect(agentUsed).toBeDefined()
			expect(agentUsed).not.toBe(chatAgentInstance)
		})
	})
})
