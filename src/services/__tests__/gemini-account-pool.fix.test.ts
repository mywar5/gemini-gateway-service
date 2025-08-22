import * as fs from "fs/promises"
import { OAuth2Client } from "google-auth-library"
import { GeminiAccountPool } from "../gemini-account-pool"

// Mock external dependencies
jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
}))
jest.mock("google-auth-library")

const mockFs = fs as jest.Mocked<typeof fs>
const mockOAuth2Client = OAuth2Client as jest.MockedClass<typeof OAuth2Client>

const createMockClient = () => ({
	setCredentials: jest.fn(),
	refreshAccessToken: jest.fn().mockResolvedValue({
		credentials: {
			access_token: "new_mock_access_token",
			refresh_token: "new_mock_refresh_token",
			expiry_date: Date.now() + 3600 * 1000,
		},
	}),
	request: jest.fn(),
})

const createMockCredentialFile = (projectId?: string) => {
	const data: any = {
		credentials: {
			access_token: "mock_access_token",
			refresh_token: "mock_refresh_token",
			expiry_date: Date.now() + 3600 * 1000,
		},
	}
	if (projectId) {
		data.projectId = projectId
	}
	return JSON.stringify(data)
}

describe("GeminiAccountPool Project ID Discovery Fix", () => {
	let mockClientInstance: ReturnType<typeof createMockClient>
	let pool: GeminiAccountPool | null = null

	beforeEach(() => {
		jest.clearAllMocks()
		mockClientInstance = createMockClient()
		mockOAuth2Client.mockImplementation(() => mockClientInstance as any)
	})

	afterEach(() => {
		if (pool) {
			pool.destroy()
			pool = null
		}
	})

	it("should call authClient.request with baseURL and relative url during project discovery", async () => {
		// 1. Setup: Mock the environment
		const credentialsPath = "/fake/credentials"
		;(mockFs.readdir as jest.Mock).mockResolvedValueOnce(["account1.json"])
		const creds = createMockCredentialFile() // No project ID initially
		;(mockFs.readFile as jest.Mock).mockResolvedValueOnce(creds)
		;(mockFs.writeFile as jest.Mock).mockResolvedValueOnce(undefined) // Mock the save operation

		// Mock the API response for loadCodeAssist
		mockClientInstance.request.mockResolvedValue({
			data: { cloudaicompanionProject: "discovered-project-id" },
		})

		// 2. Action: Initialize the pool, which triggers warm-up and discovery
		pool = new GeminiAccountPool(credentialsPath)
		await (pool as any).initializationPromise

		// 3. Assertion: Verify the fix
		// The crucial check: ensure `request` was called with the correct structure
		expect(mockClientInstance.request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
				method: "POST",
				data: expect.any(String),
			}),
		)
		// Ensure it also saved the newly discovered project ID
		expect(mockFs.writeFile).toHaveBeenCalledTimes(1)
		const writtenContent = (mockFs.writeFile as jest.Mock).mock.calls[0][1]
		const writtenData = JSON.parse(writtenContent)
		expect(writtenData.projectId).toBe("discovered-project-id")
	})

	it("should handle onboarding flow correctly if loadCodeAssist returns no project", async () => {
		// 1. Setup
		const credentialsPath = "/fake/credentials"
		;(mockFs.readdir as jest.Mock).mockResolvedValueOnce(["account1.json"])
		const creds = createMockCredentialFile()
		;(mockFs.readFile as jest.Mock).mockResolvedValueOnce(creds)
		;(mockFs.writeFile as jest.Mock).mockResolvedValue(undefined)

		// Mock loadCodeAssist response (no project, requires onboarding)
		mockClientInstance.request.mockResolvedValueOnce({
			data: { allowedTiers: [{ id: "free-tier", isDefault: true }] },
		})
		// Mock onboardUser response
		mockClientInstance.request.mockResolvedValueOnce({
			data: {
				done: true,
				response: { cloudaicompanionProject: { id: "onboarded-project-id" } },
			},
		})

		// 2. Action
		pool = new GeminiAccountPool(credentialsPath)
		await (pool as any).initializationPromise
		// Check loadCodeAssist call
		expect(mockClientInstance.request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
			}),
		)

		// Check onboardUser call
		expect(mockClientInstance.request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
			}),
		)
		expect(mockFs.writeFile).toHaveBeenCalled()
		const lastWriteCall = (mockFs.writeFile as jest.Mock).mock.calls.slice(-1)[0]
		const writtenData = JSON.parse(lastWriteCall[1])
		expect(writtenData.projectId).toBe("onboarded-project-id")
	})
})
