import { GeminiAccountPool } from "../../services/gemini-account-pool"
import * as fs from "fs/promises"
import { OAuth2Client } from "google-auth-library"
import { HttpsProxyAgent } from "hpagent"

// Mocking dependencies
jest.mock("fs/promises", () => ({
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
	mkdir: jest.fn(),
}))
jest.mock("google-auth-library")
jest.mock("hpagent")

const mockedFs = fs as jest.Mocked<typeof fs>
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

	beforeEach(() => {
		jest.clearAllMocks()

		// Suppress console output
		jest.spyOn(console, "log").mockImplementation(() => {})
		jest.spyOn(console, "warn").mockImplementation(() => {})
		jest.spyOn(console, "error").mockImplementation(() => {})

		// Mock fs.readdir to return one credential file
		mockedFs.readdir.mockResolvedValue([mockCredentialFile] as any)

		// Mock fs.readFile to return mock credential data
		mockedFs.readFile.mockResolvedValue(JSON.stringify(mockCredentialData))

		// Mock OAuth2Client instance methods
		const mockAuthClientInstance = {
			setCredentials: jest.fn(),
			refreshAccessToken: jest.fn().mockResolvedValue({
				credentials: {
					access_token: "new_fake_access_token",
					expiry_date: Date.now() + 3600 * 1000,
				},
			}),
			request: jest.fn(),
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
		const mockRequest = jest.fn().mockResolvedValue({
			data: {
				cloudaicompanionProject: "discovered-project-1",
			},
		})

		mockedOAuth2Client.mockImplementation(
			() =>
				({
					setCredentials: jest.fn(),
					request: mockRequest,
				}) as any,
		)

		const pool = new GeminiAccountPool(credentialsPath)
		await (pool as any).initializationPromise // Wait for initialization to complete

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
		const mockRequest = jest.fn().mockRejectedValue(new Error(errorMessage))

		mockedOAuth2Client.mockImplementation(
			() =>
				({
					setCredentials: jest.fn(),
					request: mockRequest,
				}) as any,
		)

		// Suppress console.error for this test
		const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

		const pool = new GeminiAccountPool(credentialsPath)
		await (pool as any).initializationPromise

		expect(pool.credentials).toHaveLength(1)
		const account = pool.credentials[0]
		expect(account.isInitialized).toBe(false)
		expect(account.failures).toBeGreaterThan(0.1)
		expect(account.frozenUntil).toBeGreaterThan(Date.now())

		consoleErrorSpy.mockRestore()
	})

	test("should use the httpAgent for requests made via executeRequest", async () => {
		const mockAgentInstance = { destroy: jest.fn() }
		mockedHpagent.mockImplementation(() => mockAgentInstance as any)

		const mockRequestExecutor = jest.fn().mockResolvedValue("Success")
		const mockRequest = jest.fn().mockResolvedValue({
			data: { cloudaicompanionProject: "discovered-project-1" },
		})

		mockedOAuth2Client.mockImplementation(
			() =>
				({
					setCredentials: jest.fn(),
					request: mockRequest,
				}) as any,
		)

		const pool = new GeminiAccountPool(credentialsPath)
		await (pool as any).initializationPromise

		await pool.executeRequest(mockRequestExecutor)

		expect(mockRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				agent: mockAgentInstance,
			}),
		)
	})
})
