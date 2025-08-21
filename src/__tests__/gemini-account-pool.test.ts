import { GeminiAccountPool } from "../services/gemini-account-pool"
import * as fs from "fs/promises"
import { OAuth2Client } from "google-auth-library"

jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
}))

const mockOAuth2ClientInstance = {
	setCredentials: jest.fn(),
	refreshAccessToken: jest.fn(),
	request: jest.fn(),
}

jest.mock("google-auth-library", () => ({
	OAuth2Client: jest.fn().mockImplementation(() => mockOAuth2ClientInstance),
}))

describe("GeminiAccountPool", () => {
	let pool: GeminiAccountPool
	const credentialsPath = "/test-credentials"

	beforeEach(() => {
		jest.clearAllMocks()
	})

	afterEach(() => {
		if (pool) {
			pool.destroy()
		}
	})

	it("should initialize correctly and warm up an account without proxy", async () => {
		const mockCreds = {
			projectId: "test-project-id",
			credentials: {
				access_token: "test-access-token",
				refresh_token: "test-refresh-token",
				expiry_date: Date.now() + 3600 * 1000,
			},
		}

		;(fs.readdir as jest.Mock).mockResolvedValue(["test-account.json"])
		;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockCreds))

		mockOAuth2ClientInstance.refreshAccessToken.mockResolvedValue({
			credentials: {
				access_token: "new-access-token",
				expiry_date: Date.now() + 3600 * 1000,
			},
		})

		// Mock the discovery process
		mockOAuth2ClientInstance.request
			.mockResolvedValueOnce({
				data: {
					cloudaicompanionProject: "discovered-project-123",
				},
			})
			.mockResolvedValueOnce({
				// For the second call inside discoverProjectId if needed
				data: {
					done: true,
					response: {
						cloudaicompanionProject: {
							id: "onboarded-project-456",
						},
					},
				},
			})

		pool = new GeminiAccountPool(credentialsPath)
		await (pool as any).initializationPromise

		const account = pool.credentials[0]
		expect(account).toBeDefined()
		expect(account.isInitialized).toBe(true)
		expect(account.projectId).toBe("discovered-project-123")

		// Verify that OAuth2Client was constructed correctly
		expect(OAuth2Client).toHaveBeenCalledWith({
			clientId: expect.any(String),
			clientSecret: expect.any(String),
			redirectUri: expect.any(String),
		})

		// Verify that the discovery request was made
		expect(mockOAuth2ClientInstance.request).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://cloudcode-pa.googleapis.com",
				url: "/v1internal:loadCodeAssist",
			}),
		)
	})
})
