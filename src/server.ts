import fastify, { FastifyInstance } from "fastify"
import { GeminiAccountPool } from "./services/gemini-account-pool"
import { registerChatRoutes } from "./routes/chat"
import { registerManagementRoutes } from "./routes/management"
import * as fs from "fs/promises"
import * as path from "path"

export function buildServer(): FastifyInstance {
	const server = fastify({
		logger: {
			level: "info",
			transport:
				process.env.NODE_ENV !== "test"
					? {
							target: "pino-pretty",
						}
					: undefined,
		},
	})

	// The accounts path is now fixed to the project's 'accounts' directory.
	const accountsPath = path.resolve("./accounts")
	const proxy = process.env.PROXY

	// Initialize the account pool
	const accountPool = new GeminiAccountPool(accountsPath, proxy)

	// Make the pool available to routes
	server.decorate("accountPool", accountPool)

	// Register routes
	registerChatRoutes(server)
	registerManagementRoutes(server)

	return server
}

export const start = async () => {
	const server = buildServer()
	try {
		// Simple environment variable handling
		const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000
		const host = process.env.HOST || "0.0.0.0"
		const accountsPath = path.resolve("./accounts")

		// Pre-flight check for accounts
		const stats = await fs.stat(accountsPath).catch(() => null)
		if (!stats || !(await fs.readdir(accountsPath)).some((file) => file.endsWith(".json"))) {
			server.log.warn(`Accounts directory '${accountsPath}' is empty or does not exist.`)
			server.log.info("Please run 'npm run setup' to configure Gemini accounts.")
		}

		await server.listen({ port, host })

		const publicIp = process.env.PUBLIC_IP || "YOUR_PUBLIC_IP"
		const publicPort = process.env.PUBLIC_PORT || port

		server.log.info(`Internal server listening at http://${host}:${port}`)
		server.log.info(`Service is accessible externally at http://${publicIp}:${publicPort}`)
	} catch (err) {
		server.log.error(err)
		process.exit(1)
	}
}

// This allows the server to be started directly when running the file,
// but also to be imported and started programmatically for testing.
if (require.main === module) {
	start()
}

// Add a declaration to FastifyInstance to include our decorator
declare module "fastify" {
	export interface FastifyInstance {
		accountPool: GeminiAccountPool
	}
}
