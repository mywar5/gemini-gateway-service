import { OAuth2Client } from "google-auth-library"
import * as fs from "fs/promises"
import * as path from "path"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HttpsProxyAgent } = require("hpagent")

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
	auth?: OAuth2Client
}

// Constants
const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const OAUTH_CLIENT_SECRET = "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"

const OAUTH_REDIRECT_URI = "http://localhost:45289"
const RATE_LIMIT_QUARANTINE_MS = 30 * 60 * 1000 // 30 minutes
const GENERAL_FAILURE_QUARANTINE_MS = 5 * 60 * 1000 // 5 minutes

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"
export class GeminiAccountPool {
	public credentials: Account[] = []
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
			http2: {
				enable: true, // Force HTTP/2
			},
		}

		if (this.proxy) {
			console.log(`[GeminiPool] Using proxy: ${this.proxy}`)
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
			console.error(`[GeminiPool] Failed to read credentials directory: ${error}`)
			accountConfigs = []
		}

		if (accountConfigs.length === 0) {
			throw new Error("No valid credential files found.")
		}

		this.credentials = accountConfigs
			.map(({ filePath, parsedData }) => {
				const { projectId, credentials } = parsedData
				if (!credentials) {
					console.error(`[GeminiPool] Incomplete credential file, skipping: ${filePath}`)
					return null
				}
				const authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI)
				authClient.setCredentials({
					access_token: credentials.access_token,
					refresh_token: credentials.refresh_token,
					expiry_date: credentials.expiry_date,
				})
				return {
					credentials,
					projectId: projectId ? projectId.trim() : null,
					authClient,
					filePath,
					successes: 0.1,
					failures: 0.1,
					frozenUntil: 0,
					isInitialized: false,
				}
			})
			.filter((acc): acc is Account => acc !== null)

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
			// If projectId is not present in the file, discover it.
			if (!account.projectId) {
				console.log(`[GeminiPool] Project ID for ${account.filePath} not found, discovering...`)
				account.projectId = await this.discoverProjectId(account)
			}
			account.isInitialized = true
			console.log(
				`[GeminiPool] Successfully warmed up account ${account.filePath} with project ${account.projectId}`,
			)
		} catch (error: any) {
			console.error(`[GeminiPool] Failed to warm up account ${account.filePath}, freezing. Error:`, error.message)
			// Freeze the account immediately upon warm-up failure
			account.failures++
			const jitter = Math.random() * 1000
			const cooldownDuration = GENERAL_FAILURE_QUARANTINE_MS + jitter
			account.frozenUntil = Date.now() + cooldownDuration
			account.isInitialized = false
			console.warn(
				`[GeminiPool] Account ${account.filePath} frozen for ${cooldownDuration / 1000}s due to warm-up failure.`,
			)
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

	protected sampleBeta(alpha: number, beta: number): number {
		const gammaA = this.sampleGamma(alpha, 1)
		const gammaB = this.sampleGamma(beta, 1)
		return gammaA / (gammaA + gammaB)
	}

	public selectAccount(): Account | null {
		if (process.env.NODE_ENV !== "test") {
			const DECAY_FACTOR = 0.995
			const MIN_COUNT = 0.1
			this.credentials.forEach((acc) => {
				acc.successes = Math.max(MIN_COUNT, acc.successes * DECAY_FACTOR)
				acc.failures = Math.max(MIN_COUNT, acc.failures * DECAY_FACTOR)
			})
		}

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
			console.log(
				`[GeminiPool] Selected account ${bestAccount.filePath} with score ${maxScore.toFixed(
					4,
				)} (successes: ${bestAccount.successes.toFixed(2)}, failures: ${bestAccount.failures.toFixed(2)})`,
			)
		} else {
			console.warn("[GeminiPool] Could not select a best account from the available pool.")
		}

		return bestAccount
	}

	public async executeRequest<T>(
		requestExecutor: (
			callApi: (urlOrMethod: string, body: any, signal?: AbortSignal) => Promise<any>,
			projectId: string,
		) => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		await this.initializationPromise

		const attemptedAccounts = new Set<string>()
		console.log("[GeminiPool] Executing new request...")

		for (let i = 0; i < this.credentials.length + 1; i++) {
			if (signal?.aborted) {
				console.log("[GeminiPool] Request aborted by caller during execution loop.")
				throw new Error("Request aborted by caller.")
			}

			const account = this.selectAccount()
			if (!account) {
				break
			}

			if (attemptedAccounts.has(account.filePath)) {
				if (attemptedAccounts.size === this.credentials.filter((acc) => acc.frozenUntil <= Date.now()).length) {
					break
				}
				continue
			}
			attemptedAccounts.add(account.filePath)

			try {
				await this.ensureAuthenticated(account)
				if (!account.isInitialized) {
					await this.warmUpAccount(account)
					if (account.frozenUntil > Date.now()) {
						continue
					}
				}

				if (!account.projectId) {
					throw new Error(`Account ${account.filePath} could not discover a project ID.`)
				}

				const callApi = (urlOrMethod: string, body: any, apiSignal?: AbortSignal) =>
					this.callEndpoint(account, urlOrMethod, body, true, apiSignal)

				const result = await requestExecutor(callApi, account.projectId)
				account.successes++
				return result
			} catch (error: any) {
				console.error(`[GeminiPool] Account ${account.filePath} failed. Error:`, error)
				account.failures++

				const isRateLimit = error.response && error.response.status === 429
				const jitter = Math.random() * 1000
				const baseCooldown = isRateLimit ? RATE_LIMIT_QUARANTINE_MS : GENERAL_FAILURE_QUARANTINE_MS
				const backoffMultiplier = Math.pow(2, Math.min(account.failures - 1, 4))
				const cooldownDuration = Math.min(baseCooldown * backoffMultiplier, 60 * 60 * 1000) + jitter

				account.frozenUntil = Date.now() + cooldownDuration
				console.warn(
					`[GeminiPool] Account ${
						account.filePath
					} frozen for ${cooldownDuration / 1000}s due to ${isRateLimit ? "rate limit" : "failure"}.`,
				)
			}
		}

		throw new Error("[GeminiPool] All credentials failed or are frozen.")
	}

	public unfreezeAccount(accountIdentifier: string): boolean {
		const account = this.credentials.find((acc) => acc.filePath.endsWith(accountIdentifier))

		if (account) {
			account.frozenUntil = 0
			console.log(`[GeminiPool] Account ${account.filePath} has been manually unfrozen.`)
			return true
		}

		return false
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
			const dataToSave = {
				projectId: account.projectId,
				credentials: account.credentials,
			}
			await fs.writeFile(account.filePath, JSON.stringify(dataToSave, null, 2))
		} catch (error) {
			console.error(`[GeminiPool] Failed to save credentials for ${account.filePath}`, error)
		}
	}

	private async discoverProjectId(account: Account): Promise<string> {
		const initialProjectId = "default"
		const clientMetadata = {
			ideType: "IDE_UNSPECIFIED",
			platform: "PLATFORM_UNSPECIFIED",
			pluginType: "GEMINI",
			duetProject: initialProjectId,
		}

		try {
			const loadRequest = {
				cloudaicompanionProject: initialProjectId,
				metadata: clientMetadata,
			}
			const loadResponse = await this.callEndpoint(account, "loadCodeAssist", loadRequest, true)

			if (loadResponse.cloudaicompanionProject) {
				const discoveredId = loadResponse.cloudaicompanionProject.trim()
				account.projectId = discoveredId
				await this.saveAccountCredentials(account)
				return discoveredId
			}

			const defaultTier = loadResponse.allowedTiers?.find((tier: any) => tier.isDefault)
			const tierId = defaultTier?.id || "free-tier"
			const onboardRequest = {
				tierId: tierId,
				cloudaicompanionProject: initialProjectId,
				metadata: clientMetadata,
			}
			let lroResponse = await this.callEndpoint(account, "onboardUser", onboardRequest, true)

			const MAX_RETRIES = 10
			let retryCount = 0
			let backoff = 1000
			const MAX_BACKOFF = 16000

			while (!lroResponse.done && retryCount < MAX_RETRIES) {
				const jitter = Math.random() * 500
				await new Promise((resolve) => setTimeout(resolve, backoff + jitter))
				lroResponse = await this.callEndpoint(account, "onboardUser", onboardRequest, true)
				backoff = Math.min(MAX_BACKOFF, backoff * 2)
				retryCount++
			}

			if (!lroResponse.done) {
				throw new Error("Onboarding timed out.")
			}

			const discoveredProjectId = lroResponse.response?.cloudaicompanionProject?.id?.trim() || initialProjectId
			account.projectId = discoveredProjectId
			await this.saveAccountCredentials(account)
			return discoveredProjectId
		} catch (error: any) {
			console.error("Failed to discover project ID:", error.response?.data || error.message)
			throw new Error("Project discovery failed.")
		}
	}

	private async callEndpoint(
		account: Account,
		urlOrMethod: string,
		body: any,
		retryAuth: boolean = true,
		signal?: AbortSignal,
	): Promise<any> {
		let url: string
		if (urlOrMethod.startsWith("projects/")) {
			// This is a generative model call, use the Vertex AI endpoint, which requires a location.
			const location = "us-central1" // A common default for Gemini models.
			const vertexAiEndpoint = `https://${location}-aiplatform.googleapis.com`
			const vertexApiVersion = "v1"

			// Deconstruct the incoming partial path: `projects/{projectId}/models/{modelId}:streamGenerateContent`
			const [projectAndModelsPath, methodName] = urlOrMethod.split(":")
			const pathParts = projectAndModelsPath.split("/") // ["projects", "{projectId}", "models", "{modelId}"]
			const projectId = pathParts[1]
			const modelId = pathParts[3]

			// Construct the full, correct URL according to Vertex AI specifications.
			url = `${vertexAiEndpoint}/${vertexApiVersion}/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:${methodName}`
		} else {
			// This is a Code Assist call for project discovery.
			url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${urlOrMethod}`
		}

		// Dynamically set responseType based on whether the call is for a stream
		const responseType = url.includes(":stream") ? "stream" : "json"
		// Use the high-performance agent only for non-stream requests due to a bug in gaxios with stream + agent
		const agent = responseType === "stream" ? undefined : this.httpAgent

		console.log(
			`[GeminiPool] Calling API for ${account.filePath}: URL=${url}, ResponseType=${responseType}, Agent=${
				agent ? "hpagent" : "default"
			}`,
		)

		try {
			// The project ID is part of the URL, so it should not be in the body.
			const res = await account.authClient.request({
				url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				responseType,
				data: JSON.stringify(body), // Send the original body
				signal: signal,
				agent, // Use the dynamically selected agent
			})
			return res.data
		} catch (error: any) {
			console.error(`[GeminiPool] Error calling ${url} for account ${account.filePath}:`, error)
			if (error.response?.status === 401 && retryAuth) {
				console.log(`[GeminiPool] Received 401, attempting token refresh for ${account.filePath}`)
				await this.ensureAuthenticated(account)
				return this.callEndpoint(account, urlOrMethod, body, false)
			}
			throw error
		}
	}

	public destroy(): void {
		if (this.httpAgent) {
			this.httpAgent.destroy()
			console.log("[GeminiPool] HttpsProxyAgent destroyed.")
		}
	}
}
