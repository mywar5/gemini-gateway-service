import { GeminiAccountPool } from "../services/gemini-account-pool"
import { HttpsProxyAgent } from "hpagent"
import { OAuth2Client } from "google-auth-library"
import * as fs from "fs/promises"
import { jest } from "@jest/globals"
import { GaxiosOptions, GaxiosResponse } from "gaxios"

// Mock the external dependencies
jest.mock("hpagent")
jest.mock("google-auth-library")
jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
	mkdir: jest.fn(),
}))

const mockHttpsProxyAgent = HttpsProxyAgent as jest.MockedClass<typeof HttpsProxyAgent>

describe("GeminiAccountPool", () => {
	let pool: GeminiAccountPool
	const mockCredentialsPath = "/fake/credentials"
	let mockRequest: jest.Mock<(options: GaxiosOptions) => Promise<GaxiosResponse<any>>>

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks()

		const mockedFs = fs as jest.Mocked<typeof fs>
		// Mock file system to return a single valid account file
		mockedFs.readdir.mockResolvedValue(["account1.json"] as any)
		mockedFs.readFile.mockResolvedValue(
			JSON.stringify({
				projectId: "pre-existing-project-id", // Start with a project ID
				credentials: {
					access_token: "fake_access_token",
					refresh_token: "fake_refresh_token",
					expiry_date: Date.now() + 3600 * 1000,
				},
			}),
		)

		// Mock the OAuth2Client's request method
		mockRequest = jest.fn()
		jest.spyOn(OAuth2Client.prototype, "request").mockImplementation(mockRequest)

		// Instantiate the pool for each test
		pool = new GeminiAccountPool(mockCredentialsPath)
	})

	it("should initialize with http2-enabled agent", () => {
		expect(mockHttpsProxyAgent).toHaveBeenCalledTimes(1)
		expect(mockHttpsProxyAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				http2: { enable: true },
			}),
		)
	})

	it("should make successful API calls with correct parameters", async () => {
		// @ts-ignore - Accessing private property for testing
		await pool.initializationPromise

		const mockApiResponse = {
			data: { success: true },
			status: 200,
			statusText: "OK",
			headers: {},
			config: {},
		} as GaxiosResponse
		mockRequest.mockResolvedValue(mockApiResponse)

		const testMethod = "testMethod"
		const testBody = { key: "value" }

		const result = await pool.executeRequest(async (callApi, projectId) => {
			expect(projectId).toBe("pre-existing-project-id")
			return callApi(testMethod, testBody)
		})

		expect(result).toEqual(mockApiResponse.data)
		expect(mockRequest).toHaveBeenCalledTimes(1)
		const requestConfig = mockRequest.mock.calls[0][0]

		// Verify the URL format is correct (using ':')
		expect(requestConfig.url).toContain(`:${testMethod}`)

		// Verify the request body is passed in 'data' property
		expect(requestConfig.data).toEqual(JSON.stringify(testBody))
		expect(requestConfig.body).toBeUndefined()

		// Verify the http2-enabled agent is used
		expect(requestConfig.agent).toBe(pool.httpAgent)
	})

	it("should handle API call failures and freeze the account", async () => {
		// @ts-ignore
		await pool.initializationPromise

		const apiError = new Error("API Failure") as any
		apiError.response = { status: 500 }
		mockRequest.mockRejectedValue(apiError)

		await expect(
			pool.executeRequest(async (callApi) => {
				return callApi("failingMethod", {})
			}),
		).rejects.toThrow("All credentials failed or are frozen.")

		const account = pool.credentials[0]
		expect(account.failures).toBeGreaterThan(0.1)
		expect(account.frozenUntil).toBeGreaterThan(Date.now())
	})
})
