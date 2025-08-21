import { OAuth2Client } from "google-auth-library"
import * as fs from "fs/promises"
import * as path from "path"
import * as http from "http"
import inquirer from "inquirer"

// --- Static Configuration ---
// --- Static Configuration ---
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET
const OAUTH_REDIRECT_URI = "http://localhost:45289"

if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
	console.error("Error: Missing required environment variables for setup: OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET")
	console.error("Please set them in your environment or in a .env file before running the setup script.")
	process.exit(1)
}

// --- Type Definitions ---
interface OAuthCredentials {
	access_token: string
	refresh_token: string
	token_type: string
	expiry_date: number
}

// --- Interactive Authentication Manager ---
export class AuthManager {
	constructor(private credentialsPath: string) {}

	public async startAuthFlow(): Promise<void> {
		let running = true
		while (running) {
			const { action } = await inquirer.prompt([
				{
					type: "list",
					name: "action",
					message: "What would you like to do?",
					choices: ["Add a new Gemini account", "Exit"],
				},
			])

			if (action === "Add a new Gemini account") {
				await this.addNewAccount()
			} else {
				running = false
			}
		}
	}

	private async addNewAccount(): Promise<void> {
		try {
			const { projectId } = await inquirer.prompt([
				{
					type: "input",
					name: "projectId",
					message: "Enter the Google Cloud Project ID for this account:",
					validate: (input) => !!input || "Project ID cannot be empty.",
				},
			])

			const credentials = await this.runAuthProcess()
			if (credentials) {
				const finalConfig = { projectId, credentials }
				await fs.mkdir(this.credentialsPath, { recursive: true })
				await fs.writeFile(
					path.join(this.credentialsPath, `${projectId}.json`),
					JSON.stringify(finalConfig, null, 2),
				)
				console.log(`\nSuccessfully added and saved credentials for project ${projectId}.`)
			}
		} catch (error) {
			console.error("\nFailed to add new account:", error)
		}
	}

	private runAuthProcess(): Promise<OAuthCredentials | null> {
		return new Promise((resolve, reject) => {
			const oAuth2Client = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI)

			const authUrl = oAuth2Client.generateAuthUrl({
				access_type: "offline",
				scope: ["https://www.googleapis.com/auth/cloud-platform"],
				prompt: "consent",
			})

			console.log("\nPlease open the following URL in your browser to authorize the application:")
			console.log(authUrl)

			const server = http.createServer(async (req, res) => {
				try {
					if (req.url) {
						const url = new URL(req.url, `http://${req.headers.host}`)
						const code = url.searchParams.get("code")
						if (code) {
							res.end("Authentication successful! You can close this window.")
							server.close()
							const { tokens } = await oAuth2Client.getToken(code)
							if (
								tokens.access_token &&
								tokens.refresh_token &&
								tokens.token_type &&
								tokens.expiry_date
							) {
								resolve({
									access_token: tokens.access_token,
									refresh_token: tokens.refresh_token,
									token_type: tokens.token_type,
									expiry_date: tokens.expiry_date,
								})
							} else {
								reject(new Error("Failed to retrieve a complete token set."))
							}
						}
					}
				} catch (e: any) {
					res.end("An error occurred during authentication.")
					server.close()
					reject(e)
				}
			})

			const port = new URL(OAUTH_REDIRECT_URI).port
			server
				.listen(port, () => {
					console.log(`\nWaiting for authentication callback on port ${port}...`)
				})
				.on("error", (_err) => {
					reject(new Error(`Could not start temporary server on port ${port}. Is it already in use?`))
				})
		})
	}
}

async function main() {
	console.log("Gemini Gateway Service - Interactive Setup")
	// The accounts path is now fixed to the project's 'accounts' directory.
	const absoluteAccountsPath = path.resolve("./accounts")
	console.log(`Using accounts directory: ${absoluteAccountsPath}`)

	const authManager = new AuthManager(absoluteAccountsPath)
	await authManager.startAuthFlow()
}

// This ensures the main function is only called when the script is executed directly
if (require.main === module) {
	main().catch(console.error)
}
