import { buildServer } from "../server"
import { GeminiAccountPool } from "../services/gemini-account-pool"
import { registerChatRoutes } from "../routes/chat"
import * as path from "path"

// Mock the dependencies
jest.mock("../services/gemini-account-pool")
jest.mock("../routes/chat")

import { FastifyInstance } from "fastify"

describe("Server Builder", () => {
	let originalEnv: NodeJS.ProcessEnv
	let mockExit: jest.SpyInstance
	let server: FastifyInstance

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks()

		// Backup original environment variables and set NODE_ENV to 'test'
		originalEnv = { ...process.env }
		process.env.NODE_ENV = "test"

		// Mock process.exit to prevent tests from stopping
		mockExit = jest.spyOn(process, "exit").mockImplementation((() => {}) as any)
	})

	afterEach(async () => {
		// Restore original environment variables and mocks
		process.env = originalEnv
		mockExit.mockRestore()
		if (server) {
			await server.close()
		}
	})

	it("should build the server correctly", () => {
		process.env.PROXY = "http://proxy.test"

		server = buildServer()
		const expectedPath = path.resolve("./accounts")

		expect(server).toBeDefined()
		expect(server).toHaveProperty("decorate")
		expect(server).toHaveProperty("register")
		expect(GeminiAccountPool).toHaveBeenCalledWith(expectedPath, "http://proxy.test")
		expect(server).toHaveProperty("accountPool")
		expect(registerChatRoutes).toHaveBeenCalledWith(server)
		expect(mockExit).not.toHaveBeenCalled()
	})
})
