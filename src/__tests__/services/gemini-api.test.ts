import { GeminiAccountPool, Account } from "../../services/gemini-account-pool"
import { OAuth2Client } from "google-auth-library"
import * as fs from "fs/promises"

// Mock the entire google-auth-library and fs/promises
jest.mock("google-auth-library")
jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
	mkdir: jest.fn(),
}))

const mockRequest = jest.fn()
const mockRefreshAccessToken = jest.fn()

// Mock the implementation of OAuth2Client
const MockOAuth2Client = OAuth2Client as jest.MockedClass<typeof OAuth2Client>

describe("GeminiAccountPool - Google API Interaction", () => {
	const mockCredentialsPath = "/mock/credentials"
	let pool: GeminiAccountPool

	beforeEach(async () => {
		jest.useFakeTimers()
		// Clear all mocks before each test
		mockRequest.mockClear()
		mockRefreshAccessToken.mockClear()
		const mockedFs = fs as jest.Mocked<typeof fs>
		mockedFs.readdir.mockResolvedValue(["account1.json"] as any)
		mockedFs.readFile.mockResolvedValue(
			JSON.stringify({
				client_id: "test_client_id",
				client_secret: "test_client_secret",
				refresh_token: "test_refresh_token",
			}),
		)
		mockedFs.writeFile.mockClear()
		MockOAuth2Client.mockImplementation(() => {
			return {
				request: mockRequest,
				refreshAccessToken: mockRefreshAccessToken,
				setCredentials: jest.fn(),
			} as any
		})
		pool = new GeminiAccountPool(mockCredentialsPath)
		await (pool as any).initializationPromise
	})

	afterEach(async () => {
		jest.useRealTimers()
		// Destroy the pool's agent after each test to prevent open handles
		if (pool) {
			pool.destroy()
		}
	})
	const createMockAccount = (filePath: string, projectId?: string, tokenExpired = false): Account => ({
		credentials: {
			access_token: "mock_access_token",
			refresh_token: "mock_refresh_token",
			token_type: "Bearer",
			expiry_date: tokenExpired ? Date.now() - 1000 : Date.now() + 3600 * 1000,
		},
		projectId: projectId || null,
		authClient: new MockOAuth2Client(),
		filePath,
		successes: 1,
		failures: 1,
		frozenUntil: 0,
		isInitialized: true,
	})

	it("should call the correct API endpoint with the correct hostname", async () => {
		// Arrange
		const mockedFs = fs as jest.Mocked<typeof fs>
		mockedFs.readdir.mockResolvedValue(["account1.json"] as any)
		mockedFs.readFile.mockResolvedValue(
			JSON.stringify({
				client_id: "test_client_id",
				client_secret: "test_client_secret",
				refresh_token: "test_refresh_token",
			}),
		)
		const account = createMockAccount("account1.json", "test-project")
		pool = new GeminiAccountPool(mockCredentialsPath)
		await (pool as any).initializationPromise
		pool.credentials = [account]

		const methodName = "testMethod"
		const requestBody = { data: "test" }
		const expectedUrl = `https://cloudcode-pa.googleapis.com/v1internal:${methodName}`

		mockRequest.mockResolvedValue({ data: { success: true } })

		// Act
		await (pool as any).callEndpoint(account, methodName, requestBody, false)

		// Assert
		expect(mockRequest).toHaveBeenCalledTimes(1)
		expect(mockRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				url: expectedUrl,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				data: JSON.stringify({ data: "test" }),
			}),
		)
	})

	it("should attempt to refresh token on 401 error and retry the request", async () => {
		// Arrange
		const mockedFs = fs as jest.Mocked<typeof fs>
		mockedFs.readdir.mockResolvedValue(["account1.json"] as any)
		mockedFs.readFile.mockResolvedValue(
			JSON.stringify({
				client_id: "test_client_id",
				client_secret: "test_client_secret",
				refresh_token: "test_refresh_token",
			}),
		)
		const account = createMockAccount("account1.json", "test-project", true) // Token is expired
		pool = new GeminiAccountPool(mockCredentialsPath)
		await (pool as any).initializationPromise
		pool.credentials = [account]

		// Mock the private save method to avoid actual file system calls
		jest.spyOn(pool as any, "saveAccountCredentials").mockResolvedValue(undefined)

		const methodName = "testMethod"
		const requestBody = { data: "test" }

		// Simulate a 401 error on the first call, then a success
		mockRequest
			.mockRejectedValueOnce({ response: { status: 401 } })
			.mockResolvedValueOnce({ data: { success: true } })

		// Simulate a successful token refresh
		mockRefreshAccessToken.mockResolvedValue({
			credentials: { access_token: "new_access_token", expiry_date: Date.now() + 3600 * 1000 },
		})

		// Act
		const result = await (pool as any).callEndpoint(account, methodName, requestBody, true)

		// Assert
		expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1) // Token refresh was called
		expect(mockRequest).toHaveBeenCalledTimes(2) // Original call + retry
		expect(result).toEqual({ success: true }) // The final result is successful
	})
})
