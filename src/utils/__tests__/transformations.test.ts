import {
	convertToGeminiMessages,
	convertToOpenAIStreamChunk,
	createStreamEndChunk,
	OpenAIChatMessage,
} from "../transformations"

describe("Transformation Utilities", () => {
	describe("convertToGeminiMessages", () => {
		it("should convert user and assistant messages correctly", () => {
			const openAIMessages: OpenAIChatMessage[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
			]
			const expected = [
				{ role: "user", parts: [{ text: "Hello" }] },
				{ role: "model", parts: [{ text: "Hi there!" }] },
			]
			expect(convertToGeminiMessages(openAIMessages)).toEqual(expected)
		})

		it("should filter out system messages", () => {
			const openAIMessages: OpenAIChatMessage[] = [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello" },
			]
			const expected = [{ role: "user", parts: [{ text: "Hello" }] }]
			expect(convertToGeminiMessages(openAIMessages)).toEqual(expected)
		})

		it("should handle an empty array", () => {
			expect(convertToGeminiMessages([])).toEqual([])
		})
	})

	describe("convertToOpenAIStreamChunk", () => {
		it("should create a valid OpenAI stream chunk from a Gemini chunk", () => {
			const geminiChunk = {
				candidates: [
					{
						content: {
							parts: [{ text: " example" }],
						},
					},
				],
			}
			const model = "gemini-1.0-pro"
			const result = convertToOpenAIStreamChunk(geminiChunk, model)

			expect(result.startsWith("data: ")).toBe(true)
			expect(result.endsWith("\n\n")).toBe(true)

			const data = JSON.parse(result.replace("data: ", ""))
			expect(data.object).toBe("chat.completion.chunk")
			expect(data.model).toBe(model)
			expect(data.choices[0].delta.content).toBe(" example")
		})

		it("should handle empty or malformed Gemini chunks gracefully", () => {
			const geminiChunk = {}
			const model = "gemini-1.0-pro"
			const result = convertToOpenAIStreamChunk(geminiChunk, model)
			const data = JSON.parse(result.replace("data: ", ""))
			expect(data.choices[0].delta.content).toBe("")
		})
	})

	describe("createStreamEndChunk", () => {
		it("should return the correct [DONE] chunk", () => {
			expect(createStreamEndChunk()).toBe("data: [DONE]\n\n")
		})
	})
})
