import {
	convertToGeminiMessages,
	convertToOpenAIStreamChunk,
	createInitialAssistantChunk,
	createStreamEndChunk,
} from "../transformations"

describe("Transformation Utilities", () => {
	describe("convertToGeminiMessages", () => {
		it("should convert basic user and assistant messages", () => {
			const messages = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there" },
			]
			const result = convertToGeminiMessages(messages as any)
			expect(result).toEqual([
				{ role: "user", parts: [{ text: "Hello" }] },
				{ role: "model", parts: [{ text: "Hi there" }] },
			])
		})

		it("should merge consecutive messages from the same role", () => {
			const messages = [
				{ role: "user", content: "First part." },
				{ role: "user", content: "Second part." },
			]
			const result = convertToGeminiMessages(messages as any)
			expect(result).toEqual([{ role: "user", parts: [{ text: "First part.\n\nSecond part." }] }])
		})

		it("should ignore system messages", () => {
			const messages = [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello" },
			]
			const result = convertToGeminiMessages(messages as any)
			expect(result).toEqual([{ role: "user", parts: [{ text: "Hello" }] }])
		})
	})

	describe("convertToOpenAIStreamChunk", () => {
		it("should convert a standard Gemini chunk to an OpenAI SSE chunk", () => {
			const geminiChunk = {
				candidates: [{ content: { parts: [{ text: "Hello world" }] } }],
			}
			const result = convertToOpenAIStreamChunk(geminiChunk, "gemini-pro", "")
			expect(result).not.toBeNull()
			const data = JSON.parse(result!.sseChunk.replace("data: ", ""))
			expect(data.choices[0].delta.content).toBe("Hello world")
			expect(result!.fullText).toBe("Hello world")
		})

		it("should return null if there is no text content", () => {
			const geminiChunk = {
				candidates: [{ content: { parts: [{}] } }],
			}
			const result = convertToOpenAIStreamChunk(geminiChunk, "gemini-pro", "previous text")
			expect(result).toBeNull()
		})

		it("should map finishReason 'STOP' to 'stop'", () => {
			const geminiChunk = {
				candidates: [{ content: { parts: [{ text: "Final answer." }] }, finishReason: "STOP" }],
			}
			const result = convertToOpenAIStreamChunk(geminiChunk, "gemini-pro", "")
			const data = JSON.parse(result!.sseChunk.replace("data: ", ""))
			expect(data.choices[0].finish_reason).toBe("stop")
		})

		it("should map finishReason 'TOOL_CODE' to 'tool_calls'", () => {
			const geminiChunk = {
				candidates: [
					{
						content: { parts: [{ text: "<tool_code>" }] },
						finishReason: "TOOL_CODE",
					},
				],
			}
			const result = convertToOpenAIStreamChunk(geminiChunk, "gemini-pro", "")
			const data = JSON.parse(result!.sseChunk.replace("data: ", ""))
			expect(data.choices[0].finish_reason).toBe("tool_calls")
		})
	})

	describe("createInitialAssistantChunk", () => {
		it("should create a valid initial SSE chunk", () => {
			const result = createInitialAssistantChunk("gemini-pro")
			expect(result.startsWith("data: ")).toBe(true)
			const data = JSON.parse(result.replace("data: ", ""))
			expect(data.choices[0].delta.role).toBe("assistant")
			expect(data.choices[0].delta.content).toBe("")
		})
	})

	describe("createStreamEndChunk", () => {
		it("should return the correct [DONE] message", () => {
			expect(createStreamEndChunk()).toBe("data: [DONE]\n\n")
		})
	})
})
