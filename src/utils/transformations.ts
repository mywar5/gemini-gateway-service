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
	let systemMessage: string | null = null
	const otherMessages: OpenAIChatMessage[] = []

	// Separate system messages from the rest
	for (const msg of messages) {
		if (msg.role === "system") {
			// Concatenate multiple system messages
			systemMessage = systemMessage ? `${systemMessage}\n\n${msg.content}` : msg.content
		} else if (msg.role === "user" || msg.role === "assistant") {
			otherMessages.push(msg)
		}
	}

	// Process user and assistant messages
	for (let i = 0; i < otherMessages.length; i++) {
		const msg = otherMessages[i]
		const role = msg.role === "assistant" ? "model" : "user"
		let content = msg.content

		// Prepend system message to the first user message
		if (i === 0 && role === "user" && systemMessage) {
			content = `${systemMessage}\n\n${content}`
		}

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
 * @returns A string formatted as an OpenAI-style Server-Sent Event.
 */
export function convertToOpenAIStreamChunk(geminiChunk: any, model: string): string {
	const timestamp = Math.floor(Date.now() / 1000)
	const id = `chatcmpl-${Buffer.from(timestamp.toString()).toString("base64")}`

	// This is a simplified transformation. A real implementation would need to handle
	// different chunk types, content filtering, etc.
	const content = geminiChunk.candidates?.[0]?.content?.parts?.[0]?.text || ""

	const streamChunk = {
		id,
		object: "chat.completion.chunk",
		created: timestamp,
		model,
		choices: [
			{
				index: 0,
				delta: {
					content: content,
				},
				finish_reason: null,
			},
		],
	}

	return `data: ${JSON.stringify(streamChunk)}\n\n`
}

/**
 * Creates the final "done" chunk for an OpenAI stream.
 * @returns A string indicating the end of the stream.
 */
export function createStreamEndChunk(): string {
	return "data: [DONE]\n\n"
}
