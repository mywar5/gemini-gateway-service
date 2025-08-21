import inquirer from "inquirer"
import * as fs from "fs/promises"
import * as path from "path"
import { AuthManager } from "../../setup"

// Mock the entire inquirer module
jest.mock("inquirer")
// Mock the fs/promises module
jest.mock("fs/promises")

describe("AuthManager", () => {
	const mockAccountsPath = "/mock/credentials"
	let authManager: AuthManager

	beforeEach(() => {
		// Reset mocks before each test
		;(inquirer.prompt as unknown as jest.Mock).mockClear()
		;(fs.writeFile as jest.Mock).mockClear()
		;(fs.mkdir as jest.Mock).mockClear()

		authManager = new AuthManager(mockAccountsPath)
	})

	it("should exit when user chooses to exit", async () => {
		;(inquirer.prompt as unknown as jest.Mock).mockResolvedValueOnce({ action: "Exit" })

		await authManager.startAuthFlow()

		// Expect prompt to have been called once for the main menu
		expect(inquirer.prompt).toHaveBeenCalledTimes(1)
		// Expect writeFile not to be called
		expect(fs.writeFile).not.toHaveBeenCalled()
	})

	it("should guide user through adding a new account and save credentials", async () => {
		// Mock the sequence of prompts and their answers
		;(inquirer.prompt as unknown as jest.Mock)
			.mockResolvedValueOnce({ action: "Add a new Gemini account" }) // Main menu
			.mockResolvedValueOnce({ projectId: "test-project-123" }) // Project ID prompt
			.mockResolvedValueOnce({ action: "Exit" }) // Back to main menu, then exit

		// Mock the internal authentication process to avoid network calls
		const mockCredentials = {
			access_token: "mock_access_token",
			refresh_token: "mock_refresh_token",
			token_type: "Bearer",
			expiry_date: Date.now() + 3600 * 1000,
		}

		// We need to mock the private method runAuthProcess
		const runAuthProcessSpy = jest
			.spyOn(AuthManager.prototype as any, "runAuthProcess")
			.mockResolvedValue(mockCredentials)

		await authManager.startAuthFlow()

		// Check that the prompts were called
		expect(inquirer.prompt).toHaveBeenCalledTimes(3)

		// Check that the directory was created
		expect(fs.mkdir).toHaveBeenCalledWith(mockAccountsPath, { recursive: true })

		// Check that the file was written with the correct data
		const expectedFilePath = path.join(mockAccountsPath, "test-project-123.json")
		const expectedFileContent = JSON.stringify(
			{
				projectId: "test-project-123",
				credentials: mockCredentials,
			},
			null,
			2,
		)

		expect(fs.writeFile).toHaveBeenCalledWith(expectedFilePath, expectedFileContent)

		// Clean up the spy
		runAuthProcessSpy.mockRestore()
	})

	it("should handle errors during the auth process gracefully", async () => {
		;(inquirer.prompt as unknown as jest.Mock)
			.mockResolvedValueOnce({ action: "Add a new Gemini account" })
			.mockResolvedValueOnce({ projectId: "test-project-failure" })
			.mockResolvedValueOnce({ action: "Exit" })

		const authError = new Error("Authentication failed")
		const runAuthProcessSpy = jest
			.spyOn(AuthManager.prototype as any, "runAuthProcess")
			.mockRejectedValue(authError)

		// Mock console.error to suppress expected error logs during test
		const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

		await authManager.startAuthFlow()

		// Ensure it doesn't try to write a file on failure
		expect(fs.writeFile).not.toHaveBeenCalled()

		// Ensure the error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("\nFailed to add new account:", authError)

		runAuthProcessSpy.mockRestore()
		consoleErrorSpy.mockRestore()
	})
})
