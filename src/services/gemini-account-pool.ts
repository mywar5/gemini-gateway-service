import { OAuth2Client } from "google-auth-library"
import * as fs from "fs/promises"
import * as path from "path"
import { HttpsProxyAgent } from "hpagent"

// Interfaces
interface OAuthCredentials {
	access_token: string
	refresh_token: string
	token_type: string
	expiry_date: number
}

export interface Account {
	credentials: OAuthCredentials
	projectId: string | null
	authClient: OAuth2Client
	filePath: string
	successes: number
	failures: number
	frozenUntil: number
	isInitialized: boolean
}

// Constants
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET
const OAUTH_REDIRECT_URI = "http://localhost:45289"
const RATE_LIMIT_QUARANTINE_MS = 30 * 60 * 1000 // 30 minutes
const GENERAL_FAILURE_QUARANTINE_MS = 5 * 60 * 1000 // 5 minutes

export class GeminiAccountPool {
	private credentials: Account[] = []
	private initializationPromise: Promise<void> | null = null
	public httpAgent: any

	constructor(
		private credentialsPath: string,
		private proxy?: string,
	) {
		const agentOptions: any = {
			keepAlive: true,
			maxSockets: 100,
			maxFreeSockets: 10,
			scheduling: "lifo",
			http2: { enable: true },
		}

		if (this.proxy) {
			agentOptions.proxy = this.proxy
		}

		this.httpAgent = new HttpsProxyAgent(agentOptions)
		this.initializationPromise = this.initialize()
	}

	private async initialize(): Promise<void> {
		let accountConfigs: { filePath: string; parsedData: any }[] = []
		try {
			const files = await fs.readdir(this.credentialsPath)
			const configPromises = files
				.filter((file) => path.extname(file) === ".json")
				.map(async (file) => {
					const filePath = path.join(this.credentialsPath, file)
					try {
						const credData = await fs.readFile(filePath, "utf-8")
						return { filePath, parsedData: JSON.parse(credData) }
					} catch (e) {
						console.error(`[GeminiPool] Failed to load credential file: ${filePath}`, e)
						return null
					}
				})
			accountConfigs = (await Promise.all(configPromises)).filter(
				(config): config is { filePath: string; parsedData: any } => config !== null,
			)
		} catch (error) {
			throw new Error(`[GeminiPool] Multi-account load failed: ${error}`)
		}

		if (accountConfigs.length === 0) {
			throw new Error("No valid credential files found.")
		}

		this.credentials = accountConfigs.map(({ filePath, parsedData }) => {
			const credentials = (parsedData.credentials || parsedData) as OAuthCredentials
			const projectId = parsedData.projectId || null
			const authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI)
			authClient.setCredentials({
				access_token: credentials.access_token,
				refresh_token: credentials.refresh_token,
				expiry_date: credentials.expiry_date,
			})
			return {
				credentials,
				projectId,
				authClient,
				filePath,
				successes: 1,
				failures: 1,
				frozenUntil: 0,
				isInitialized: false,
			}
		})

		console.log(`[GeminiPool] Starting parallel warm-up for ${this.credentials.length} credentials...`)
		const warmUpPromises = this.credentials.map((acc) => this.warmUpAccount(acc))
		await Promise.allSettled(warmUpPromises)
		console.log("[GeminiPool] Parallel warm-up process completed.")
	}

	private async warmUpAccount(account: Account): Promise<void> {
		if (account.isInitialized) return
		console.log(`[GeminiPool] Warming up account: ${account.filePath}`)
		try {
			await this.ensureAuthenticated(account)
			if (!account.projectId) {
				account.projectId = await this.discoverProjectId(account)
			}
			account.isInitialized = true
			console.log(
				`[GeminiPool] Successfully warmed up account ${account.filePath} with project ${account.projectId}`,
			)
		} catch (error: any) {
			console.error(`[GeminiPool] Failed to warm up account ${account.filePath}:`, error.message)
			throw error
		}
	}

	private sampleNormal(): number {
		let u = 0,
			v = 0
		while (u === 0) u = Math.random()
		while (v === 0) v = Math.random()
		return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
	}

	private sampleGamma(alpha: number, beta: number): number {
		if (alpha >= 1) {
			const d = alpha - 1.0 / 3.0
			const c = 1.0 / Math.sqrt(9.0 * d)
			while (true) {
				let x, v
				do {
					x = this.sampleNormal()
					v = 1.0 + c * x
				} while (v <= 0)
				v = v * v * v
				const u = Math.random()
				const x2 = x * x
				if (u < 1.0 - 0.0331 * x2 * x2) return (d * v) / beta
				if (Math.log(u) < 0.5 * x2 + d * (1.0 - v + Math.log(v))) return (d * v) / beta
			}
		} else {
			return this.sampleGamma(alpha + 1, beta) * Math.pow(Math.random(), 1 / alpha)
		}
	}

	private sampleBeta(alpha: number, beta: number): number {
		const gammaA = this.sampleGamma(alpha, 1)
		const gammaB = this.sampleGamma(beta, 1)
		return gammaA / (gammaA + gammaB)
	}

	public selectAccount(): Account | null {
		const DECAY_FACTOR = 0.995
		const MIN_COUNT = 0.1
		this.credentials.forEach((acc) => {
			acc.successes = Math.max(MIN_COUNT, acc.successes * DECAY_FACTOR)
			acc.failures = Math.max(MIN_COUNT, acc.failures * DECAY_FACTOR)
		})

		const now = Date.now()
		const availableAccounts = this.credentials.filter((acc) => acc.frozenUntil <= now)

		if (availableAccounts.length === 0) {
			console.warn("[GeminiPool] All credentials are currently frozen.")
			return null
		}

		const uninitialized = availableAccounts.find((acc) => !acc.isInitialized)
		if (uninitialized) {
			console.log(`[GeminiPool] Selecting uninitialized account to warm up: ${uninitialized.filePath}`)
			return uninitialized
		}

		let bestAccount: Account | null = null
		let maxScore = -1

		for (const account of availableAccounts) {
			const score = this.sampleBeta(account.successes, account.failures)
			if (score > maxScore) {
				maxScore = score
				bestAccount = account
			}
		}

		if (bestAccount) {
			console.log(`[GeminiPool] Selected account ${bestAccount.filePath} with score ${maxScore.toFixed(4)}`)
		}

		return bestAccount
	}

	public async executeRequest<T>(
		requestExecutor: (account: Account, projectId: string) => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		await this.initializationPromise

		if (signal?.aborted) {
			throw new Error("Request aborted by caller.")
		}

		const account = this.selectAccount()

		if (!account) {
			throw new Error("[GeminiPool] All credentials failed or are frozen.")
		}

		try {
			await this.ensureAuthenticated(account)
			if (!account.isInitialized) {
				await this.warmUpAccount(account)
			}

			if (!account.projectId) {
				throw new Error(`Account ${account.filePath} could not discover a project ID.`)
			}

			const result = await requestExecutor(account, account.projectId)
			account.successes++
			return result
		} catch (error: any) {
			console.error(`[GeminiPool] Account ${account.filePath} failed. Error: ${error.message}`)
			account.failures++

			const jitter = Math.random() * 1000
			let baseCooldown = GENERAL_FAILURE_QUARANTINE_MS
			if (error.response?.status === 429) {
				baseCooldown = RATE_LIMIT_QUARANTINE_MS
			}
			const backoffMultiplier = Math.pow(2, Math.min(account.failures - 1, 4))
			const cooldownDuration = Math.min(baseCooldown * backoffMultiplier, 60 * 60 * 1000) + jitter

			account.frozenUntil = Date.now() + cooldownDuration
			console.warn(`[GeminiPool] Account ${account.filePath} frozen for ${cooldownDuration / 1000}s.`)

			// Retry with another account
			return this.executeRequest(requestExecutor, signal)
		}
	}

	private async ensureAuthenticated(account: Account): Promise<void> {
		if (account.credentials && account.credentials.expiry_date < Date.now()) {
			console.log(`[GeminiPool] Token expired for ${account.filePath}, refreshing...`)
			try {
				const { credentials } = await account.authClient.refreshAccessToken()
				if (credentials.access_token) {
					account.credentials = {
						access_token: credentials.access_token!,
						refresh_token: credentials.refresh_token || account.credentials.refresh_token,
						token_type: credentials.token_type || "Bearer",
						expiry_date: credentials.expiry_date || Date.now() + 3600 * 1000,
					}
					account.authClient.setCredentials(account.credentials)
					await this.saveAccountCredentials(account)
					console.log(`[GeminiPool] Token refreshed and saved for ${account.filePath}`)
				}
			} catch (error) {
				console.error(`[GeminiPool] Failed to refresh token for ${account.filePath}`, error)
				throw new Error(`Token refresh failed: ${error}`)
			}
		}
	}

	private async saveAccountCredentials(account: Account): Promise<void> {
		try {
			const fileContent = await fs.readFile(account.filePath, "utf-8")
			const originalData = JSON.parse(fileContent)
			let dataToSave: any

			if (originalData.credentials) {
				dataToSave = { ...originalData, credentials: account.credentials, projectId: account.projectId }
			} else {
				dataToSave = { ...account.credentials }
				if (originalData.projectId) dataToSave.projectId = originalData.projectId
			}
			if (dataToSave.projectId === null) delete dataToSave.projectId

			await fs.writeFile(account.filePath, JSON.stringify(dataToSave, null, 2))
		} catch (error) {
			console.error(`[GeminiPool] Failed to save credentials for ${account.filePath}`, error)
		}
	}

	private async discoverProjectId(account: Account): Promise<string> {
		// This logic is highly specific and might need adjustment.
		// For now, we assume a simplified version.
		// A real implementation would need the full LRO polling logic.
		console.log(`[GeminiPool] Project ID discovery for ${account.filePath} is a placeholder.`)
		return "mock-project-id"
	}

	public destroy(): void {
		if (this.httpAgent) {
			this.httpAgent.destroy()
			console.log("[GeminiPool] HttpsProxyAgent destroyed.")
		}
	}
}
