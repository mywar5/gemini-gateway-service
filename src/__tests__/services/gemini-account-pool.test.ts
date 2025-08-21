import { GeminiAccountPool, Account } from "../../services/gemini-account-pool"
import * as fs from "fs/promises"
import { OAuth2Client } from "google-auth-library"

// Mocking dependencies
jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
	mkdir: jest.fn(),
}))

jest.mock("google-auth-library", () => {
	const mockOAuth2Client = {
		setCredentials: jest.fn(),
		refreshAccessToken: jest.fn().mockResolvedValue({
			credentials: { access_token: "new_access_token" },
		}),
		request: jest.fn().mockResolvedValue({
			data: { cloudaicompanionProject: "discovered-id" },
		}),
	}
	return {
		OAuth2Client: jest.fn().mockImplementation(() => mockOAuth2Client),
	}
})

describe("GeminiAccountPool", () => {
	const credentialsPath = "/fake/credentials/path"
	let pool: GeminiAccountPool
	let mockAccounts: Account[]

	beforeEach(() => {
		jest.clearAllMocks()
		jest.spyOn(console, "log").mockImplementation(() => {})
		jest.spyOn(console, "warn").mockImplementation(() => {})
		jest.spyOn(console, "error").mockImplementation(() => {})

		const mockAuthClient = {
			setCredentials: jest.fn(),
			refreshAccessToken: jest.fn().mockResolvedValue({
				credentials: { access_token: "new_access_token" },
			}),
		}

		mockAccounts = [
			{
				filePath: "acc1.json",
				successes: 10,
				failures: 1,
				frozenUntil: 0,
				isInitialized: true,
				authClient: mockAuthClient,
				projectId: "project-1",
				credentials: {
					refresh_token: "refresh1",
					expiry_date: Date.now() + 3600 * 1000,
					access_token: "access1",
					token_type: "Bearer",
				},
			} as unknown as Account,
			{
				filePath: "acc2.json",
				successes: 1,
				failures: 10,
				frozenUntil: 0,
				isInitialized: true,
				authClient: mockAuthClient,
				projectId: "project-2",
				credentials: {
					refresh_token: "refresh2",
					expiry_date: Date.now() + 3600 * 1000,
					access_token: "access2",
					token_type: "Bearer",
				},
			} as unknown as Account,
			{
				filePath: "acc3.json",
				successes: 5,
				failures: 5,
				frozenUntil: Date.now() + 10000,
				isInitialized: true,
				authClient: mockAuthClient,
				projectId: "project-3",
				credentials: {
					refresh_token: "refresh3",
					expiry_date: Date.now() + 3600 * 1000,
					access_token: "access3",
					token_type: "Bearer",
				},
			} as unknown as Account,
		]
		const mockedFs = fs as jest.Mocked<typeof fs>
		mockedFs.readdir.mockResolvedValue(mockAccounts.map((a) => a.filePath) as any)
		mockedFs.readFile.mockImplementation((filePath) => {
			const account = mockAccounts.find((a) => filePath.toString().includes(a.filePath))
			return Promise.resolve(JSON.stringify({ credentials: account?.credentials }))
		})
	})

	afterEach(async () => {
		if (pool) {
			await pool.destroy()
		}
	})

	describe("Initialization", () => {
		it("should initialize correctly with valid credential files", async () => {
			pool = new GeminiAccountPool(credentialsPath)
			await (pool as any).initializationPromise

			expect(pool.credentials).toHaveLength(3)
			expect(pool.credentials[0].isInitialized).toBe(true)
			expect(pool.credentials[1].isInitialized).toBe(true)
			expect(pool.credentials[2].isInitialized).toBe(true)
		})

		it("should throw an error if no valid credential files are found", async () => {
			const mockedFs = fs as jest.Mocked<typeof fs>
			mockedFs.readdir.mockResolvedValue([] as any)
			pool = new GeminiAccountPool(credentialsPath)
			await expect((pool as any).initializationPromise).rejects.toThrow("No valid credential files found.")
		})
	})

	describe("Account Selection", () => {
		beforeEach(async () => {
			pool = new GeminiAccountPool(credentialsPath)
			await (pool as any).initializationPromise
			pool.credentials = mockAccounts
		})

		it("should select an available account", () => {
			const account = pool.selectAccount()
			expect(account).not.toBeNull()
			expect(account!.frozenUntil).toBeLessThanOrEqual(Date.now())
		})

		it("should return null if all accounts are frozen", () => {
			pool.credentials.forEach((acc) => (acc.frozenUntil = Date.now() + 10000))
			const account = pool.selectAccount()
			expect(account).toBeNull()
		})

		it("should select the account with the highest score", () => {
			jest.spyOn(pool as any, "sampleBeta").mockImplementation((alpha: any, _beta: any) => {
				if (alpha === 10.1) return 0.9 // acc1
				if (alpha === 1.1) return 0.1 // acc2
				return 0
			})

			const account = pool.selectAccount()
			expect(account).not.toBeNull()
			expect(account!.filePath).toBe("acc1.json")
		})
	})

	describe("Request Execution", () => {
		beforeEach(async () => {
			pool = new GeminiAccountPool(credentialsPath)
			await (pool as any).initializationPromise
			pool.credentials = mockAccounts.slice(0, 2) // Use only acc1 and acc2
			pool.credentials.forEach((c) => {
				c.frozenUntil = 0
				c.failures = 1 // Reset failures for consistent testing
			})
		})

		it("should handle request failure, freeze the account, and retry", async () => {
			const failingExecutor = jest
				.fn()
				.mockRejectedValueOnce(new Error("Request failed"))
				.mockResolvedValue("success on retry")

			jest.spyOn(pool, "selectAccount").mockImplementation(() => {
				const acc1 = pool.credentials.find(
					(a) => a.filePath.includes("acc1.json") && a.frozenUntil <= Date.now(),
				)
				if (acc1) return acc1
				const acc2 = pool.credentials.find((a) => a.filePath.includes("acc2.json"))
				return acc2 || null
			})

			const result = await pool.executeRequest(failingExecutor)

			expect(result).toBe("success on retry")
			expect(failingExecutor).toHaveBeenCalledTimes(2)
			const firstAccount = pool.credentials.find((a) => a.filePath.includes("acc1.json"))!
			expect(firstAccount.failures).toBe(2)
			expect(firstAccount.frozenUntil).toBeGreaterThan(Date.now())
		})

		it("should handle token refresh failure and retry with another account", async () => {
			const executor = jest.fn().mockResolvedValue("success")

			const firstAccount = pool.credentials.find((a) => a.filePath.includes("acc1.json"))!
			firstAccount.credentials.expiry_date = Date.now() - 1000 // Expire the token

			const firstAccountAuth = firstAccount.authClient as jest.Mocked<OAuth2Client>
			firstAccountAuth.refreshAccessToken.mockRejectedValueOnce(new Error("Token refresh failed") as never)

			jest.spyOn(pool, "selectAccount").mockImplementation(() => {
				const acc1 = pool.credentials.find(
					(a) => a.filePath.includes("acc1.json") && a.frozenUntil <= Date.now(),
				)
				if (acc1) return acc1
				const acc2 = pool.credentials.find((a) => a.filePath.includes("acc2.json"))
				return acc2 || null
			})

			const result = await pool.executeRequest(executor)

			expect(result).toBe("success")
			expect(executor).toHaveBeenCalledTimes(1)
			const failedAccount = pool.credentials.find((a) => a.filePath.includes("acc1.json"))!
			expect(failedAccount.failures).toBe(2)
			expect(failedAccount.frozenUntil).toBeGreaterThan(Date.now())
		})

		it("should throw an error if all accounts fail", async () => {
			const failingExecutor = jest.fn().mockRejectedValue(new Error("Request failed"))

			await expect(pool.executeRequest(failingExecutor)).rejects.toThrow("All credentials failed or are frozen.")

			expect(failingExecutor).toHaveBeenCalledTimes(2)
		})
	})
})
