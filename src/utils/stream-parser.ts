/**
 * A robust parser for a stream that contains a single JSON array, split across multiple chunks.
 * It correctly handles nested structures and extracts complete JSON objects from the stream.
 */
export class StreamParser {
	private buffer = ""
	private braceLevel = 0
	private inString = false
	private backslashes = 0

	/**
	 * Processes an incoming chunk of data and yields any complete JSON objects found.
	 * @param chunk The string chunk received from the stream.
	 * @returns An async generator that yields parsed JSON objects.
	 */
	public async *parse(chunk: string): AsyncGenerator<any> {
		this.buffer += chunk

		while (true) {
			// At the start of each attempt, trim any leading characters that are not part of an object.
			// This handles commas, whitespace, and the initial array bracket.
			const originalLength = this.buffer.length
			this.buffer = this.buffer.replace(/^[\s,[]+/, "")
			if (this.buffer.length === 0 && originalLength > 0) {
				// We consumed some leading characters, let's try again with the potentially empty buffer
				continue
			}

			// If the buffer is empty or doesn't start with an object, we can't proceed.
			if (!this.buffer.startsWith("{")) {
				break
			}

			let objectStartIndex = 0
			this.braceLevel = 0
			this.inString = false
			let foundObject = false

			for (let i = objectStartIndex; i < this.buffer.length; i++) {
				const char = this.buffer[i]

				if (this.inString) {
					if (char === '"' && this.backslashes % 2 === 0) {
						this.inString = false
					}
					this.backslashes = char === "\\" ? this.backslashes + 1 : 0
					continue
				}

				if (char === '"') {
					this.inString = true
					this.backslashes = 0
				} else if (char === "{") {
					this.braceLevel++
				} else if (char === "}") {
					this.braceLevel--
					if (this.braceLevel === 0) {
						const objectStr = this.buffer.substring(objectStartIndex, i + 1)
						try {
							const geminiChunk = JSON.parse(objectStr)
							yield geminiChunk
						} catch (e) {
							console.warn({ object: objectStr, error: e }, "Failed to parse JSON object from stream.")
						}
						// Remove the parsed object from the buffer and continue the while loop.
						this.buffer = this.buffer.substring(i + 1)
						foundObject = true
						break // Exit the for loop, the while loop will restart
					}
				}
			}

			// If we didn't find a complete object in the buffer, break the while loop and wait for more data.
			if (!foundObject) {
				break
			}
		}
	}
}
