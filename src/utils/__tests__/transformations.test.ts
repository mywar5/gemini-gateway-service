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
		it("should return the delta content when new text is added", () => {
			const geminiChunk = {
				candidates: [{ content: { parts: [{ text: "Hello world" }] } }],
			}
			const model = "gemini-1.0-pro"
			const lastSentText = "Hello "
			const result = convertToOpenAIStreamChunk(geminiChunk, model, lastSentText)

			expect(result).not.toBeNull()
			expect(result?.sseChunk.startsWith("data: ")).toBe(true)
			const data = JSON.parse(result!.sseChunk.replace("data: ", ""))
			expect(data.choices[0].delta.content).toBe("world")
			expect(result?.fullText).toBe("Hello world")
		})

		it("should return the full text as delta if lastSentText is empty", () => {
			const geminiChunk = {
				candidates: [{ content: { parts: [{ text: "First chunk" }] } }],
			}
			const model = "gemini-1.0-pro"
			const result = convertToOpenAIStreamChunk(geminiChunk, model, "")

			expect(result).not.toBeNull()
			const data = JSON.parse(result!.sseChunk.replace("data: ", ""))
			expect(data.choices[0].delta.content).toBe("First chunk")
			expect(result?.fullText).toBe("First chunk")
		})

		it("should return null if the text content has not changed", () => {
			const geminiChunk = {
				candidates: [{ content: { parts: [{ text: "Same text" }] } }],
			}
			const model = "gemini-1.0-pro"
			const result = convertToOpenAIStreamChunk(geminiChunk, model, "Same text")
			expect(result).toBeNull()
		})

		it("should handle empty or malformed Gemini chunks gracefully", () => {
			const geminiChunk = {}
			const model = "gemini-1.0-pro"
			const result = convertToOpenAIStreamChunk(geminiChunk, model, "some text")
			expect(result).not.toBeNull()
			// It should return an empty delta because the new text is empty, and it's different from lastSentText
			expect(result?.sseChunk).toBe("")
			expect(result?.fullText).toBe("")
		})
	})

	describe("createStreamEndChunk", () => {
		it("should return the correct [DONE] chunk", () => {
			expect(createStreamEndChunk()).toBe("data: [DONE]\n\n")
		})
	})
})
