import { AuthManager } from "../setup"
import inquirer from "inquirer"
import * as fs from "fs/promises"
import * as path from "path"

// Mock the external dependencies
jest.mock("inquirer")
jest.mock("open", () => jest.fn())
jest.mock("fs/promises")

describe("AuthManager", () => {
	let authManager: AuthManager
	const mockCredentialsPath = "/fake/path"

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks()
		authManager = new AuthManager(mockCredentialsPath)
	})

	it("should trigger the auth process and save credentials", async () => {
		// Spy on the private method `runAuthProcess` and mock its implementation
		const runAuthProcessSpy = jest.spyOn(authManager as any, "runAuthProcess").mockResolvedValue({
			access_token: "fake_access_token",
			refresh_token: "fake_refresh_token",
			token_type: "Bearer",
			expiry_date: Date.now() + 3600000,
		})

		// Mock the user's interactive choices
		;(inquirer.prompt as any)
			.mockResolvedValueOnce({ action: "Add a new Gemini account" })
			.mockResolvedValueOnce({
				projectId: "test-project",
			})
			.mockResolvedValueOnce({ action: "Exit" })

		await authManager.startAuthFlow()

		// Verify that the auth process was called with the correct credentials
		expect(runAuthProcessSpy).toHaveBeenCalledWith(
			"681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
			"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",
		)

		// Verify that file was "written"
		const expectedPath = path.join(mockCredentialsPath, "test-project.json")
		expect(fs.mkdir).toHaveBeenCalledWith(mockCredentialsPath, { recursive: true })
		expect(fs.writeFile).toHaveBeenCalledWith(expectedPath, expect.stringContaining('"projectId": "test-project"'))

		// Clean up the spy
		runAuthProcessSpy.mockRestore()
	})
})
