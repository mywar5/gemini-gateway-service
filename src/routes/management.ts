import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"

interface UnfreezeRequestBody {
	account: string // The identifier for the account, e.g., the .json filename
}

export function registerManagementRoutes(server: FastifyInstance) {
	server.post("/v1/management/unfreeze", (request: FastifyRequest, reply: FastifyReply) => {
		const body = request.body as UnfreezeRequestBody

		if (!body || !body.account) {
			return reply.code(400).send({ error: "Missing required field: account" })
		}

		const success = server.accountPool.unfreezeAccount(body.account)

		if (success) {
			reply.code(200).send({ message: `Account '${body.account}' has been unfrozen.` })
		} else {
			reply.code(404).send({ error: `Account '${body.account}' not found.` })
		}
	})
}
