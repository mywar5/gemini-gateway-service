export type MatchedChunk = {
	type: "text" | "tool_code"
	toolName?: string
	text: string
}

/**
 * A streaming XML matcher that can find and extract content from multiple different tags.
 */
export class XmlMatcher {
	private buffer: string = ""
	// Regex to find any opening XML tag, e.g., <tool_name>
	private openTagRegex = /<([a-zA-Z0-9_-]+)>/

	/**
	 * Processes a new chunk of text data and yields structured chunks of text or tool code.
	 * @param data The new string data from the stream.
	 * @returns A generator that yields MatchedChunk objects.
	 */
	public *update(data: string): Generator<MatchedChunk> {
		this.buffer += data
		let openMatch

		while ((openMatch = this.buffer.match(this.openTagRegex)) !== null) {
			const openTag = openMatch[0]
			const tagName = openMatch[1]
			const openIndex = openMatch.index!
			const closeTag = `</${tagName}>`
			const closeIndex = this.buffer.indexOf(closeTag, openIndex)

			if (closeIndex === -1) {
				// Found an open tag, but not its corresponding close tag yet.
				// Wait for more data.
				break
			}

			// Yield the text part before the matched XML tag.
			if (openIndex > 0) {
				yield { type: "text", text: this.buffer.substring(0, openIndex) }
			}

			// Yield the content inside the matched XML tags.
			const matchedContent = this.buffer.substring(openIndex + openTag.length, closeIndex)
			yield { type: "tool_code", toolName: tagName, text: matchedContent }

			// Update the buffer to what's after the closing tag.
			this.buffer = this.buffer.substring(closeIndex + closeTag.length)
		}
	}

	/**
	 * Yields any remaining text in the buffer as a final text chunk.
	 * @returns A generator that yields the final MatchedChunk if any text remains.
	 */
	public *final(): Generator<MatchedChunk> {
		if (this.buffer.length > 0) {
			yield { type: "text", text: this.buffer }
			this.buffer = ""
		}
	}
}
