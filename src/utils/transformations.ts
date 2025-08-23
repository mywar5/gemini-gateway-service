// This file will contain the logic to transform OpenAI-compatible API requests
// into the format expected by the Google Gemini API, and vice-versa for the responses.

// Defines the structure for a part of a message's content, which can be text or other types.
export interface OpenAIContentPart {
	type: "text" | "image_url"
	text?: string
	// Other fields like image_url can be added here but are ignored by the transformation.
}

// Defines the possible structures for the content of an OpenAI message.
export type OpenAIMessageContent = string | OpenAIContentPart[]

// Defines the structure for a single message in an OpenAI-compatible request.
export interface OpenAIChatMessage {
	role: "user" | "assistant" | "system"
	content: OpenAIMessageContent
}

// Defines the structure for a Gemini-formatted message part.
export interface GeminiContent {
	role: "user" | "model"
	parts: { text: string }[]
}

/**
 * Extracts and concatenates text from the complex content of an OpenAI message.
 * @param content The content of an OpenAI message.
 * @returns A single string with all text parts concatenated.
 */
function getTextFromContent(content: OpenAIMessageContent): string {
	if (typeof content === "string") {
		return content
	}
	if (Array.isArray(content)) {
		return content
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n")
	}
	return ""
}

/**
 * Converts an array of OpenAI-formatted messages to Gemini-formatted content.
 * This version correctly handles complex content types and merges consecutive messages.
 * @param messages The array of OpenAI messages.
 * @returns The array of Gemini content.
 */
export function convertToGeminiMessages(messages: OpenAIChatMessage[]): GeminiContent[] {
	const result: GeminiContent[] = []
	// Filter out system messages and process only user and assistant roles.
	const filteredMessages = messages.filter((msg) => msg.role === "user" || msg.role === "assistant")

	for (const msg of filteredMessages) {
		const role = msg.role === "assistant" ? "model" : "user"
		const textContent = getTextFromContent(msg.content)

		if (!textContent) {
			continue // Skip messages with no text content.
		}

		// If the last message in the result has the same role, merge the content.
		if (result.length > 0 && result[result.length - 1].role === role) {
			result[result.length - 1].parts[0].text += `\n\n${textContent}`
		} else {
			// Otherwise, push a new message object.
			result.push({
				role,
				parts: [{ text: textContent }],
			})
		}
	}

	return result
}

/**
 * Transforms a Gemini stream chunk into an OpenAI-compatible SSE chunk.
 * @param geminiChunk The chunk from the Gemini API stream.
 * @param model The model name to include in the response.
 * @param lastSentText The text content that was sent in the previous chunk.
 * @returns A string formatted as an OpenAI-style Server-Sent Event, and the full text of the current chunk.
 */
export function convertToOpenAIStreamChunk(
	geminiChunk: any,
	model: string,
	lastSentText: string,
): { sseChunk: string; fullText: string } | null {
	const timestamp = Math.floor(Date.now() / 1000)
	const id = `chatcmpl-${Buffer.from(Math.random().toString()).toString("base64").substring(0, 29)}`

	const candidate = geminiChunk.candidates?.[0]
	if (!candidate) {
		return null
	}

	// Check for tool calls first
	const toolCallPart = candidate.content?.parts?.find((p: any) => p.functionCall)
	if (toolCallPart) {
		const functionCall = toolCallPart.functionCall
		const toolChunk = {
			id,
			object: "chat.completion.chunk",
			created: timestamp,
			model,
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								index: 0,
								id: `call_${Buffer.from(Math.random().toString()).toString("base64").substring(0, 24)}`,
								type: "function",
								function: {
									name: functionCall.name,
									arguments: JSON.stringify(functionCall.args),
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		}
		return {
			sseChunk: `data: ${JSON.stringify(toolChunk)}\n\n`,
			fullText: lastSentText, // No change in text content
		}
	}

	// Fallback to text content if no tool call
	const fullText = candidate.content?.parts?.[0]?.text || ""

	if (fullText === lastSentText) {
		return null // No new content to send
	}

	const deltaContent = fullText.startsWith(lastSentText) ? fullText.substring(lastSentText.length) : fullText

	if (!deltaContent) {
		return { sseChunk: "", fullText } // No new content, but update last sent text
	}

	const streamChunk = {
		id,
		object: "chat.completion.chunk",
		created: timestamp,
		model,
		choices: [
			{
				index: 0,
				delta: {
					content: deltaContent,
				},
				finish_reason: candidate.finishReason === "STOP" ? "stop" : null,
			},
		],
	}

	return {
		sseChunk: `data: ${JSON.stringify(streamChunk)}\n\n`,
		fullText,
	}
}

/**
 * Creates the final "done" chunk for an OpenAI stream.
 * @returns A string indicating the end of the stream.
 */
export function createInitialAssistantChunk(model: string): string {
	const timestamp = Math.floor(Date.now() / 1000)
	const id = `chatcmpl-${Buffer.from(Math.random().toString()).toString("base64").substring(0, 29)}`

	const initialChunk = {
		id,
		object: "chat.completion.chunk",
		created: timestamp,
		model,
		choices: [
			{
				index: 0,
				delta: {
					role: "assistant",
					content: "",
				},
				finish_reason: null,
			},
		],
	}
	return `data: ${JSON.stringify(initialChunk)}\n\n`
}

/**
 * Creates the final "done" chunk for an OpenAI stream.
 * @returns A string indicating the end of the stream.
 */
export function createStreamEndChunk(): string {
	return "data: [DONE]\n\n"
}
