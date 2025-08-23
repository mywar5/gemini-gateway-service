// This file will contain the logic to transform OpenAI-compatible API requests
// into the format expected by the Google Gemini API, and vice-versa for the responses.

// Placeholder for OpenAI request message format
export interface OpenAIChatMessage {
	role: "user" | "assistant" | "system"
	content: string
}

// Placeholder for Gemini request content format
export interface GeminiContent {
	role: "user" | "model"
	parts: { text: string }[]
}

/**
 * Converts an array of OpenAI-formatted messages to Gemini-formatted content.
 * @param messages The array of OpenAI messages.
 * @returns The array of Gemini content.
 */
export function convertToGeminiMessages(messages: OpenAIChatMessage[]): GeminiContent[] {
	const result: GeminiContent[] = []
	const otherMessages = messages.filter((msg) => msg.role === "user" || msg.role === "assistant")

	// Process user and assistant messages
	for (const msg of otherMessages) {
		const role = msg.role === "assistant" ? "model" : "user"
		const content = msg.content

		// Merge consecutive messages from the same role
		if (result.length > 0 && result[result.length - 1].role === role) {
			const lastPart = result[result.length - 1].parts[0]
			lastPart.text = lastPart.text ? `${lastPart.text}\n\n${content}` : content
		} else {
			result.push({
				role,
				parts: [{ text: content }],
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

	const fullText = geminiChunk.candidates?.[0]?.content?.parts?.[0]?.text || ""

	if (fullText === lastSentText) {
		return null // No new content to send
	}

	const deltaContent = fullText.startsWith(lastSentText) ? fullText.substring(lastSentText.length) : fullText

	if (!deltaContent) {
		return { sseChunk: "", fullText } // No new content to send, but update the last sent text
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
				finish_reason: null,
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
