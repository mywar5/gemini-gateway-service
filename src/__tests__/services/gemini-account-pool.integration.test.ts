import { GeminiAccountPool } from "../../services/gemini-account-pool"
import * as fs from "fs/promises"
import { OAuth2Client } from "google-auth-library"
import { HttpsProxyAgent } from "hpagent"
import { jest } from "@jest/globals"

// Mocking dependencies
jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
	mkdir: jest.fn(),
}))
jest.mock("google-auth-library")
jest.mock("hpagent")

const mockedOAuth2Client = OAuth2Client as jest.MockedClass<typeof OAuth2Client>
const mockedHpagent = HttpsProxyAgent as jest.MockedClass<typeof HttpsProxyAgent>

describe("GeminiAccountPool Integration Tests", () => {
	const credentialsPath = "/fake/credentials"
	const mockCredentialFile = "account1.json"
	const mockCredentialData = {
		projectId: "test-project-1",
		credentials: {
			access_token: "fake_access_token",
			refresh_token: "fake_refresh_token",
			expiry_date: Date.now() + 3600 * 1000,
		},
	}
	let mockRequest: jest.Mock

	beforeEach(() => {
		jest.clearAllMocks()

		// Suppress console output
		jest.spyOn(console, "log").mockImplementation(() => {})
		jest.spyOn(console, "warn").mockImplementation(() => {})
		jest.spyOn(console, "error").mockImplementation(() => {})

		// Mock fs.readdir to return one credential file
		;(fs.readdir as jest.MockedFunction<typeof fs.readdir>).mockResolvedValue([mockCredentialFile] as any)

		// Mock fs.readFile to return mock credential data
		;(fs.readFile as jest.MockedFunction<typeof fs.readFile>).mockResolvedValue(JSON.stringify(mockCredentialData))

		// Mock OAuth2Client instance methods
		mockRequest = jest.fn()
		const mockAuthClientInstance = {
			setCredentials: jest.fn(),
			refreshAccessToken: jest.fn<() => Promise<any>>().mockResolvedValue({
				credentials: {
					access_token: "new_fake_access_token",
					expiry_date: Date.now() + 3600 * 1000,
				},
			}),
			request: mockRequest,
		}
		mockedOAuth2Client.mockImplementation(() => mockAuthClientInstance as any)
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	test("should initialize with http2 agent enabled by default", async () => {
		new GeminiAccountPool(credentialsPath)
		expect(mockedHpagent).toHaveBeenCalledWith(
			expect.objectContaining({
				http2: { enable: true },
			}),
		)
	})

	test("should initialize with http2 agent and proxy if proxy is provided", async () => {
		const proxy = "http://localhost:8888"
		new GeminiAccountPool(credentialsPath, proxy)
		expect(mockedHpagent).toHaveBeenCalledWith(
			expect.objectContaining({
				http2: { enable: true },
				proxy: proxy,
			}),
		)
	})

	test("should successfully warm-up a valid account on initialization", async () => {
		// Force discovery by setting projectId to null initially
		const initialData = { ...mockCredentialData, projectId: null }
		;(fs.readFile as jest.MockedFunction<typeof fs.readFile>).mockResolvedValue(JSON.stringify(initialData))
		;(mockRequest as any).mockResolvedValue({
			data: {
				cloudaicompanionProject: "discovered-project-1",
			},
		})

		const pool = new GeminiAccountPool(credentialsPath)
		await (pool as any).initializationPromise

		expect(pool.credentials).toHaveLength(1)
		const account = pool.credentials[0]
		expect(account.isInitialized).toBe(true)
		expect(account.projectId).toBe("discovered-project-1")
		expect(mockRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				url: expect.stringContaining("loadCodeAssist"),
			}),
		)
	})

	test("should freeze an account if warm-up fails", async () => {
		const errorMessage = "Project discovery failed."
		;(mockedOAuth2Client.prototype.request as any).mockRejectedValue(new Error(errorMessage))

		// Force discovery by setting projectId to null
		const initialData = { ...mockCredentialData, projectId: null }
		;(fs.readFile as jest.MockedFunction<typeof fs.readFile>).mockResolvedValue(JSON.stringify(initialData))

		const pool = new GeminiAccountPool(credentialsPath)
		await (pool as any).initializationPromise

		expect(pool.credentials).toHaveLength(1)
		const account = pool.credentials[0]
		expect(account.isInitialized).toBe(false)
		expect(account.failures).toBeGreaterThan(0.1)
		expect(account.frozenUntil).toBeGreaterThan(Date.now() - 1000) // Allow for slight timing differences
	})

	test("should use the httpAgent for requests made via executeRequest", async () => {
		const mockHttpAgentInstance = { id: "httpAgent" }
		const mockDiscoveryAgentInstance = { id: "discoveryAgent" }
		mockedHpagent
			.mockImplementationOnce(() => mockHttpAgentInstance as any)
			.mockImplementationOnce(() => mockDiscoveryAgentInstance as any)

		const pool = new GeminiAccountPool(credentialsPath)
		await (pool as any).initializationPromise

		// Ensure at least one account is initialized
		pool.credentials[0].isInitialized = true

		const requestExecutor = (callApi: any) => {
			return callApi("testMethod", { data: "test" })
		}

		;(mockRequest as any).mockResolvedValue({ data: "success" })

		await pool.executeRequest(requestExecutor)

		const requestCall = mockRequest.mock.calls.find(
			(call: any) => typeof call[0]?.url === "string" && call[0].url.includes("testMethod"),
		)

		expect(requestCall).toBeDefined()
		if (requestCall) {
			expect((requestCall[0] as any).agent).toBe(mockHttpAgentInstance)
		}
	})
})
