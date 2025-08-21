import { GeminiAccountPool, Account } from "../gemini-account-pool"
import * as fs from "fs/promises"
import { OAuth2Client } from "google-auth-library"

jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
	mkdir: jest.fn(),
}))
jest.mock("google-auth-library")

const mockFs = fs as jest.Mocked<typeof fs>
const mockOAuth2Client = OAuth2Client as jest.MockedClass<typeof OAuth2Client>

describe("GeminiAccountPool - Warm-up Failure", () => {
	const mockAccountsPath = "/mock/warmup/credentials"
	let pool: GeminiAccountPool

	beforeEach(() => {
		jest.clearAllMocks()

		// Mock file system to return one account
		mockFs.readdir.mockResolvedValue(["acc_warmup_fail.json"] as any)
		mockFs.readFile.mockResolvedValue(
			JSON.stringify({
				credentials: {
					access_token: "token",
					refresh_token: "refresh",
					expiry_date: Date.now() + 3600000,
				},
				projectId: "project-id",
			}),
		)

		// Mock a successful auth refresh
		;(mockOAuth2Client.prototype.refreshAccessToken as jest.Mock).mockResolvedValue({
			credentials: { access_token: "new-token", expiry_date: Date.now() + 3600000 },
		})
	})

	afterEach(() => {
		if (pool) {
			pool.destroy()
		}
	})

	it("should handle project discovery failure during warm-up and freeze the account", async () => {
		// Mock the internal callEndpoint to throw the specific error
		const callEndpointSpy = jest
			.spyOn(GeminiAccountPool.prototype as any, "callEndpoint")
			.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'hostname')"))

		pool = new GeminiAccountPool(mockAccountsPath)
		// Wait for the initialization to complete, which includes the failing warm-up
		await (pool as any).initializationPromise

		const account = (pool as any).credentials[0] as Account

		// The account should be frozen because the warm-up failed
		expect(account.frozenUntil).toBeGreaterThan(Date.now() - 1000) // Check it was set
		// Failures should be incremented
		expect(account.failures).toBeGreaterThan(0.1)
		// It should not be marked as initialized
		expect(account.isInitialized).toBe(false)

		callEndpointSpy.mockRestore()
	})
})
