import { registerChatRoutes } from "../routes/chat"
import { FastifyInstance } from "fastify"
import { Readable } from "stream"

// Mock server setup
const mockServer = {
	post: jest.fn(),
	log: {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	},
	accountPool: {
		executeRequest: jest.fn(),
	},
} as unknown as FastifyInstance

// Mock request and reply
const mockRequest = (body: any) => ({
	body,
	raw: {
		on: jest.fn(),
		aborted: false,
	},
})

const mockReply = () => {
	const writable = new Readable({
		read() {},
	})
	writable.push(null) // End the stream immediately

	const raw = {
		writeHead: jest.fn(),
		write: jest.fn(),
		end: jest.fn(),
		writableEnded: false,
	}

	return {
		code: jest.fn().mockReturnThis(),
		send: jest.fn(),
		raw,
	}
}

describe("Chat Routes", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		registerChatRoutes(mockServer)
	})

	it("should handle a streaming request with a tool call split across multiple chunks", async () => {
		const body = {
			messages: [{ role: "user", content: "List files in the current directory." }],
			model: "gemini-pro",
			stream: true,
		}

		const mockStream = new Readable({
			read() {},
		})

		;(mockServer.accountPool as any).executeRequest.mockResolvedValue(mockStream)

		const handler = (mockServer.post as jest.Mock).mock.calls[0][1]
		const req = mockRequest(body)
		const reply = mockReply()

		// Execute the handler but don't wait for it to complete
		handler(req, reply)

		// Simulate the stream chunks
		mockStream.push(
			'[{ "response": { "candidates": [ { "content": { "parts": [ { "text": "Okay, I will list the files. <execute_tool><tool_name>list_files</tool_name>" } ] } } ] } }]',
		)
		mockStream.push(
			', { "response": { "candidates": [ { "content": { "parts": [ { "text": "<parameters><path>.</path><recursive>false</recursive></parameters></execute_tool>" } ] }, "finishReason": "TOOL_CODE" } ] } }]',
		)
		mockStream.push(null) // End of stream

		// Allow the async operations to complete
		await new Promise((resolve) => setImmediate(resolve))

		// Simulate client-side reconstruction of the message
		const sseMessages = reply.raw.write.mock.calls
			.map((call) => call[0])
			.filter((s) => s.startsWith("data: ") && !s.includes("[DONE]"))

		let reconstructedContent = ""
		for (const msg of sseMessages) {
			try {
				const jsonStr = msg.substring(6) // Remove "data: "
				const parsed = JSON.parse(jsonStr)
				if (parsed.choices && parsed.choices[0].delta.content) {
					reconstructedContent += parsed.choices[0].delta.content
				}
			} catch (e) {
				// Ignore parsing errors for this test
			}
		}

		// Check for the correctly assembled tool call in the reconstructed content
		const toolCallRegex =
			/<execute_tool>\s*<tool_name>list_files<\/tool_name>\s*<parameters>\s*<path>\.<\/path>\s*<recursive>false<\/recursive>\s*<\/parameters>\s*<\/execute_tool>/s
		expect(reconstructedContent).toMatch(toolCallRegex)

		// Ensure the stream ends correctly
		expect(reply.raw.write).toHaveBeenCalledWith("data: [DONE]\n\n")
		expect(reply.raw.end).toHaveBeenCalled()
	})
})
