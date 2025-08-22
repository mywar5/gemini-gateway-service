import { GeminiAccountPool } from "../gemini-account-pool"
import * as fs from "fs/promises"
import { OAuth2Client } from "google-auth-library"
import { HttpsProxyAgent } from "hpagent"

// Mock the external dependencies
jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
}))
jest.mock("google-auth-library")
jest.mock("hpagent")

const mockedOAuth2Client = OAuth2Client as jest.MockedClass<typeof OAuth2Client>
const mockedHpagent = HttpsProxyAgent as jest.MockedClass<typeof HttpsProxyAgent>

describe("GeminiAccountPool Auth and Proxy", () => {
	const credentialsPath = "/test/creds"
	const proxy = "http://proxy.example.com:8080"
	let pool: GeminiAccountPool

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks()

		// Mock file system reads
		const mockCredFile = {
			projectId: "test-project-id",
			credentials: {
				access_token: "fake_access_token",
				refresh_token: "fake_refresh_token",
				expiry_date: Date.now() - 1000, // Expired token
			},
		}
		;(fs.readdir as jest.Mock).mockResolvedValue(["account1.json"])
		;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockCredFile))

		// Mock OAuth2Client
		const mockAuthClientInstance = {
			setCredentials: jest.fn(),
			refreshAccessToken: jest.fn().mockResolvedValue({
				credentials: {
					access_token: "new_refreshed_token",
					refresh_token: "new_refresh_token",
					expiry_date: Date.now() + 3600 * 1000,
				},
			}),
			request: jest.fn(),
		}
		mockedOAuth2Client.mockImplementation(() => mockAuthClientInstance as any)
	})

	afterEach(() => {
		if (pool) {
			pool.destroy()
		}
	})

	it("should instantiate HttpsProxyAgent with proxy options when proxy is provided", async () => {
		// Initialize the pool with a proxy
		pool = new GeminiAccountPool(credentialsPath, proxy)
		await (pool as any).initializationPromise // Wait for initialization to complete

		// Check if HttpsProxyAgent was instantiated with the correct options
		expect(mockedHpagent).toHaveBeenCalledWith(
			expect.objectContaining({
				proxy: proxy,
			}),
		)
	})

	it("should use the proxied agent for refreshing tokens", async () => {
		pool = new GeminiAccountPool(credentialsPath, proxy)
		await (pool as any).initializationPromise

		const account = pool.credentials[0]
		expect(account).toBeDefined()

		// Manually trigger authentication check which should lead to a refresh
		await (pool as any).ensureAuthenticated(account)

		// Verify that the refreshAccessToken method on the mocked client was called
		const mockAuthClientInstance = mockedOAuth2Client.mock.results[0].value
		expect(mockAuthClientInstance.refreshAccessToken).toHaveBeenCalledTimes(1)
	})
})
