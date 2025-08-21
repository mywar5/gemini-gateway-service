import { GeminiAccountPool, Account } from "../gemini-account-pool"
import * as fs from "fs/promises"
import { OAuth2Client } from "google-auth-library"
import * as path from "path"

// Mock the external dependencies
jest.mock("fs/promises")
jest.mock("google-auth-library")

const mockFs = fs as jest.Mocked<typeof fs>
const mockOAuth2Client = OAuth2Client as jest.MockedClass<typeof OAuth2Client>

// A more robust mock for the OAuth2Client
const mockAuthResult = {
	credentials: { access_token: "new-token", expiry_date: Date.now() + 3600000 },
}

let pool: GeminiAccountPool

describe("GeminiAccountPool", () => {
	const mockAccountsPath = "/mock/credentials"

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks()

		// Setup successful mock for OAuth2Client by default
		;(mockOAuth2Client.prototype.refreshAccessToken as jest.Mock).mockResolvedValue(mockAuthResult)

		// Mock implementation for fs.readdir and fs.readFile
		mockFs.readdir.mockResolvedValue(["acc1.json", "acc2.json"] as any)
		mockFs.readFile.mockImplementation((filePath: any) => {
			const fileName = path.basename(filePath)
			if (fileName === "acc1.json") {
				return Promise.resolve(
					JSON.stringify({
						credentials: {
							access_token: "token1",
							refresh_token: "refresh1",
							expiry_date: Date.now() + 3600000,
						},
						projectId: "project-1",
					}),
				)
			}
			if (fileName === "acc2.json") {
				return Promise.resolve(
					JSON.stringify({
						credentials: {
							access_token: "token2",
							refresh_token: "refresh2",
							expiry_date: Date.now() + 3600000,
						},
						projectId: "project-2",
					}),
				)
			}
			return Promise.reject(new Error("File not found"))
		})
	})

	afterEach(() => {
		if (pool) {
			pool.destroy()
		}
	})

	it("should initialize and warm up credentials on creation", async () => {
		pool = new GeminiAccountPool(mockAccountsPath)
		// @ts-ignore - Accessing private property for testing
		await (pool as any).initializationPromise

		// @ts-ignore
		const credentials = (pool as any).credentials as Account[]
		expect(credentials.length).toBe(2)
		expect(mockFs.readdir).toHaveBeenCalledWith(mockAccountsPath)
	})
	describe("discoverProjectId during warm-up", () => {
		beforeEach(() => {
			// Mock a file without a projectId
			mockFs.readFile.mockImplementation((filePath: any) => {
				const fileName = path.basename(filePath)
				if (fileName === "acc1.json") {
					return Promise.resolve(
						JSON.stringify({
							credentials: {
								access_token: "token1",
								refresh_token: "refresh1",
								expiry_date: Date.now() + 3600000,
							},
							// No projectId
						}),
					)
				}
				return Promise.reject(new Error("File not found"))
			})
			mockFs.readdir.mockResolvedValue(["acc1.json"] as any)
		})

		it("should call discoverProjectId if projectId is missing and save it", async () => {
			const discoveredProjectId = "discovered-project-123"
			// Spy on the internal callEndpoint method instead of the whole discoverProjectId
			const callEndpointSpy = jest
				.spyOn(GeminiAccountPool.prototype as any, "callEndpoint")
				// Mock the two-step discovery process
				.mockResolvedValueOnce({ cloudaicompanionProject: discoveredProjectId }) // 1. loadCodeAssist

			const saveSpy = jest
				.spyOn(GeminiAccountPool.prototype as any, "saveAccountCredentials")
				.mockResolvedValue(undefined)

			pool = new GeminiAccountPool(mockAccountsPath)
			await (pool as any).initializationPromise

			const account = (pool as any).credentials[0] as Account
			expect(callEndpointSpy).toHaveBeenCalled()
			expect(account.projectId).toBe(discoveredProjectId)
			expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ projectId: discoveredProjectId }))
		})

		it("should handle warm-up failure gracefully", async () => {
			pool = new GeminiAccountPool(mockAccountsPath)
			const discoveryError = new Error("Discovery failed")
			jest.spyOn(pool as any, "discoverProjectId").mockRejectedValue(discoveryError)

			await (pool as any).initializationPromise

			const account = (pool as any).credentials[0] as Account
			expect(account.isInitialized).toBe(false)
			expect(account.frozenUntil).toBeGreaterThan(Date.now())
		})
	})
	it("should select an account", async () => {
		pool = new GeminiAccountPool(mockAccountsPath)
		// @ts-ignore
		await (pool as any).initializationPromise
		const account = pool.selectAccount()
		expect(account).not.toBeNull()
		// Normalize paths for cross-platform compatibility
		const expectedPaths = ["/mock/credentials/acc1.json", "/mock/credentials/acc2.json"].map((p) =>
			path.normalize(p),
		)
		expect(expectedPaths).toContain(path.normalize(account!.filePath))
	})

	it("should handle request success and update account stats", async () => {
		pool = new GeminiAccountPool(mockAccountsPath)
		// @ts-ignore
		await (pool as any).initializationPromise
		const executor = jest.fn().mockResolvedValue("success")

		const credentials = (pool as any).credentials as Account[]
		const initialAccountRef = credentials.find((a) => a.filePath.includes("acc1"))!
		const initialSuccesses = initialAccountRef.successes

		jest.spyOn(pool, "selectAccount").mockReturnValue(initialAccountRef)

		const result = await pool.executeRequest(executor)

		expect(result).toBe("success")
		expect(executor).toHaveBeenCalled()
		expect(initialAccountRef.successes).toBeCloseTo(initialSuccesses * 0.995 + 1)
	})

	it("should handle request failure, freeze the account, and retry", async () => {
		pool = new GeminiAccountPool(mockAccountsPath)
		// @ts-ignore
		await (pool as any).initializationPromise

		const failingExecutor = jest
			.fn()
			.mockRejectedValueOnce(new Error("Request failed"))
			.mockResolvedValue("success on retry")

		const credentials = (pool as any).credentials as Account[]
		const firstAccount = credentials.find((a) => a.filePath.includes("acc1"))!
		const secondAccount = credentials.find((a) => a.filePath.includes("acc2"))!
		const initialFailures = firstAccount.failures

		jest.spyOn(pool, "selectAccount").mockReturnValueOnce(firstAccount).mockReturnValueOnce(secondAccount)

		const result = await pool.executeRequest(failingExecutor)

		expect(result).toBe("success on retry")
		expect(failingExecutor).toHaveBeenCalledTimes(2)
		expect(firstAccount.failures).toBeCloseTo(initialFailures * 0.995 + 1)
		expect(firstAccount.frozenUntil).toBeGreaterThan(Date.now())
	})

	it("should apply a longer freeze duration for rate limit (429) errors", async () => {
		pool = new GeminiAccountPool(mockAccountsPath)
		// @ts-ignore
		await (pool as any).initializationPromise

		const rateLimitError = new Error("Rate limit exceeded")
		// @ts-ignore
		rateLimitError.response = { status: 429 }

		const failingExecutor = jest.fn().mockRejectedValueOnce(rateLimitError).mockResolvedValue("success on retry")

		const credentials = (pool as any).credentials as Account[]
		const firstAccount = credentials.find((a) => a.filePath.includes("acc1"))!
		const secondAccount = credentials.find((a) => a.filePath.includes("acc2"))!

		firstAccount.failures = 1
		const backoffMultiplier = Math.pow(2, Math.min(firstAccount.failures, 4))

		jest.spyOn(pool, "selectAccount").mockReturnValueOnce(firstAccount).mockReturnValueOnce(secondAccount)

		await pool.executeRequest(failingExecutor)

		const freezeDuration = firstAccount.frozenUntil - Date.now()
		const rateLimitDuration = 30 * 60 * 1000
		const expectedMinDuration = rateLimitDuration * backoffMultiplier

		expect(freezeDuration).toBeGreaterThan(rateLimitDuration)
		expect(freezeDuration).toBeLessThanOrEqual(expectedMinDuration + 2000)
	})

	it("should apply exponential backoff for repeated failures", async () => {
		pool = new GeminiAccountPool(mockAccountsPath)
		// @ts-ignore
		await (pool as any).initializationPromise

		const persistentError = new Error("Persistent failure")
		const failingExecutor = jest.fn().mockRejectedValue(persistentError)

		const credentials = (pool as any).credentials as Account[]
		const firstAccount = credentials.find((a) => a.filePath.includes("acc1"))!
		const secondAccount = credentials.find((a) => a.filePath.includes("acc2"))!

		firstAccount.failures = 1
		jest.spyOn(pool, "selectAccount").mockReturnValueOnce(firstAccount).mockReturnValueOnce(secondAccount)
		await pool.executeRequest(failingExecutor).catch(() => {})
		const firstFreezeDuration = firstAccount.frozenUntil - Date.now()

		firstAccount.frozenUntil = 0
		jest.spyOn(pool, "selectAccount").mockReturnValueOnce(firstAccount).mockReturnValueOnce(secondAccount)
		await pool.executeRequest(failingExecutor).catch(() => {})
		const secondFreezeDuration = firstAccount.frozenUntil - Date.now()

		expect(secondFreezeDuration).toBeGreaterThan(firstFreezeDuration * 1.8)
	})

	it("should return null if all credentials are frozen", async () => {
		pool = new GeminiAccountPool(mockAccountsPath)
		// @ts-ignore
		await (pool as any).initializationPromise
		;(pool as any).credentials.forEach((acc: Account) => (acc.frozenUntil = Date.now() + 10000))

		const account = pool.selectAccount()
		expect(account).toBeNull()
	})

	describe("Initialization Failure", () => {
		it("should throw an error if the credentials directory does not exist", async () => {
			mockFs.readdir.mockRejectedValue(new Error("Directory not found"))
			pool = new GeminiAccountPool(mockAccountsPath)
			await expect((pool as any).initializationPromise).rejects.toThrow(
				"[GeminiPool] Multi-account load failed: Error: Directory not found",
			)
		})

		it("should throw an error if no valid credential files are found", async () => {
			mockFs.readdir.mockResolvedValue([] as any)
			pool = new GeminiAccountPool(mockAccountsPath)
			await expect((pool as any).initializationPromise).rejects.toThrow("No valid credential files found.")
		})
	})

	describe("Token Refresh and Credential Saving", () => {
		it("should handle token refresh failure and retry with another account", async () => {
			// BEFORE pool creation, set up the specific file system mock for this test
			mockFs.readFile.mockImplementation((filePath: any) => {
				const fileName = path.basename(filePath)
				if (fileName === "acc1.json") {
					return Promise.resolve(
						JSON.stringify({
							credentials: {
								access_token: "expired-token",
								refresh_token: "bad-refresh-token",
								expiry_date: Date.now() - 1000, // Expired token
							},
							projectId: "project-1",
						}),
					)
				}
				if (fileName === "acc2.json") {
					return Promise.resolve(
						JSON.stringify({
							credentials: {
								access_token: "valid-token",
								refresh_token: "good-refresh-token",
								expiry_date: Date.now() + 3600000,
							},
							projectId: "project-2",
						}),
					)
				}
				return Promise.reject(new Error("File not found"))
			})

			// AND set up the specific auth client mock for this test
			const refreshError = new Error("Token refresh failed")
			// This mock will now PERSIST for any refresh attempts
			;(mockOAuth2Client.prototype.refreshAccessToken as jest.Mock).mockRejectedValue(refreshError)

			// NOW create the pool. Initialization will fail for acc1 but succeed for acc2.
			pool = new GeminiAccountPool(mockAccountsPath)
			await (pool as any).initializationPromise

			const executor = jest.fn().mockResolvedValue("success")
			const result = await pool.executeRequest(executor)

			expect(result).toBe("success")
			const credentials = (pool as any).credentials as Account[]
			const failedAccount = credentials.find((a) => a.filePath.includes("acc1.json"))!

			// The initial warm-up failure does not freeze the account, but marks it as uninitialized.
			// The first executeRequest will try acc1, fail to warm up again, and THEN freeze it.
			expect(failedAccount.frozenUntil).toBeGreaterThan(Date.now())
			expect(executor).toHaveBeenCalledTimes(1)
		})
	})
})
