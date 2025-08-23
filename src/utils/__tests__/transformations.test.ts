import {
	convertToGeminiMessages,
	convertToOpenAIStreamChunk,
	createInitialAssistantChunk,
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

		it("should correctly handle complex content arrays and merge consecutive roles", () => {
			const openAIMessages: OpenAIChatMessage[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Hello, this is the first part." },
						{ type: "image_url" }, // Should be ignored
					],
				},
				{
					role: "user",
					content: "This is the second part, as a simple string.",
				},
				{
					role: "assistant",
					content: "This is an assistant message.",
				},
			]
			const expected = [
				{
					role: "user",
					parts: [{ text: "Hello, this is the first part.\n\nThis is the second part, as a simple string." }],
				},
				{ role: "model", parts: [{ text: "This is an assistant message." }] },
			]
			expect(convertToGeminiMessages(openAIMessages)).toEqual(expected)
		})

		it("should return an empty array if all messages are non-text", () => {
			const openAIMessages: OpenAIChatMessage[] = [
				{ role: "user", content: [{ type: "image_url" }] },
				{ role: "assistant", content: "" },
			]
			expect(convertToGeminiMessages(openAIMessages)).toEqual([])
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

		it("should handle empty or malformed Gemini chunks gracefully by returning null", () => {
			const geminiChunk = {}
			const model = "gemini-1.0-pro"
			const result = convertToOpenAIStreamChunk(geminiChunk, model, "some text")
			expect(result).toBeNull()
		})

		it("should correctly convert a tool call chunk", () => {
			const geminiChunk = {
				candidates: [
					{
						content: {
							parts: [
								{
									functionCall: {
										name: "execute_command",
										args: { command: "ls -l" },
									},
								},
							],
						},
					},
				],
			}
			const model = "gemini-pro"
			const result = convertToOpenAIStreamChunk(geminiChunk, model, "")
			expect(result).not.toBeNull()
			const parsed = JSON.parse(result!.sseChunk.replace("data: ", ""))
			const toolCall = parsed.choices[0].delta.tool_calls[0]

			expect(parsed.choices[0].finish_reason).toBe("tool_calls")
			expect(toolCall.type).toBe("function")
			expect(toolCall.function.name).toBe("execute_command")
			expect(toolCall.function.arguments).toBe(JSON.stringify({ command: "ls -l" }))
		})

		it("should set finish_reason to 'stop' when Gemini indicates it", () => {
			const geminiChunk = {
				candidates: [{ content: { parts: [{ text: "Final answer." }] }, finishReason: "STOP" }],
			}
			const model = "gemini-pro"
			const result = convertToOpenAIStreamChunk(geminiChunk, model, "")
			expect(result).not.toBeNull()
			const parsed = JSON.parse(result!.sseChunk.replace("data: ", ""))
			expect(parsed.choices[0].finish_reason).toBe("stop")
		})
	})

	describe("createStreamEndChunk", () => {
		it("should return the correct [DONE] chunk", () => {
			expect(createStreamEndChunk()).toBe("data: [DONE]\n\n")
		})
	})

	describe("createInitialAssistantChunk", () => {
		it("should create a valid initial SSE chunk with an assistant role", () => {
			const model = "gemini-1.5-pro-latest"
			const sseChunk = createInitialAssistantChunk(model)

			expect(sseChunk.startsWith("data: ")).toBe(true)
			expect(sseChunk.endsWith("\n\n")).toBe(true)

			const jsonString = sseChunk.replace(/^data: /, "").trim()
			const data = JSON.parse(jsonString)

			expect(data.object).toBe("chat.completion.chunk")
			expect(data.model).toBe(model)
			expect(data.choices).toHaveLength(1)

			const choice = data.choices[0]
			expect(choice.index).toBe(0)
			expect(choice.finish_reason).toBeNull()
			expect(choice.delta.role).toBe("assistant")
			expect(choice.delta.content).toBe("")
		})
	})
})
