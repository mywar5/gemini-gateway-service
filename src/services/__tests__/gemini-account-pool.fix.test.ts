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

describe("GeminiAccountPool executeRequest Robustness", () => {
	let pool: GeminiAccountPool

	beforeEach(async () => {
		jest.clearAllMocks()
		const credentialsPath = "/fake/robustness_path"
		;(mockFs.readdir as jest.Mock).mockResolvedValue(["account1.json", "account2.json"])
		;(mockFs.readFile as jest.Mock).mockResolvedValue(createMockCredentialFile("test-project-id"))
		mockOAuth2Client.mockImplementation(() => createMockClient() as any)

		pool = new GeminiAccountPool(credentialsPath)
		jest.spyOn(pool as any, "warmUpAccount").mockResolvedValue(undefined)
		await (pool as any).initializationPromise
	})

	afterEach(() => {
		pool.destroy()
	})

	it("should throw an error after exhausting all retries", async () => {
		const maxRetries = 3
		// The executor should call the provided API function.
		const requestExecutor = jest.fn().mockImplementation(async (callApi) => {
			return callApi("testMethod", { test: "body" })
		})

		const failingAccount = pool.credentials[0]
		jest.spyOn(pool, "selectAccount").mockReturnValue(failingAccount)
		const callEndpointSpy = jest.spyOn(pool as any, "callEndpoint").mockRejectedValue(new Error("API Error"))

		await expect(pool.executeRequest(requestExecutor, undefined, maxRetries)).rejects.toThrow(
			`[GeminiPool] Request failed after ${maxRetries} attempts. All credentials may be failing or frozen.`,
		)

		// The executor is called on each attempt. Given the mock setup,
		// the loop will break after the first attempt because the same account is selected
		// and the guard condition `attemptedAccounts.size >= availableAccounts.length` will be met.
		expect(requestExecutor).toHaveBeenCalledTimes(1)
		expect(callEndpointSpy).toHaveBeenCalledTimes(1)
	})

	it("should succeed on the second attempt if the first account fails", async () => {
		const badAccount = pool.credentials[0]
		const goodAccount = pool.credentials[1]
		// The executor should call the provided API function.
		const requestExecutor = jest.fn().mockImplementation(async (callApi) => {
			// This executor will be called twice, but the underlying callApi will fail the first time.
			const result = await callApi("testMethod", { test: "body" })
			// To make the test simpler, we assume the final result is what callEndpoint returns.
			return result.data
		})

		jest.spyOn(pool, "selectAccount").mockReturnValueOnce(badAccount).mockReturnValueOnce(goodAccount)

		// `callEndpoint` will throw an error only when called with the bad account
		const callEndpointSpy = jest.spyOn(pool as any, "callEndpoint").mockImplementation(async (account: any) => {
			if (account.filePath === badAccount.filePath) {
				throw new Error("Simulated failure for bad account")
			}
			// Return a success-like object for the good account.
			return { data: "success" }
		})

		const finalResult = await pool.executeRequest(requestExecutor)

		expect(finalResult).toBe("success")
		expect(callEndpointSpy).toHaveBeenCalledTimes(2) // Called for bad and good account
		expect(requestExecutor).toHaveBeenCalledTimes(2) // Called for bad and good account

		expect(badAccount.failures).toBeGreaterThan(0.1)
		expect(badAccount.frozenUntil).toBeGreaterThan(Date.now())
		expect(goodAccount.successes).toBeGreaterThan(0.1)
	})
})
