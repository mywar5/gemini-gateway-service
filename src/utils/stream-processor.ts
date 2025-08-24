import { Writable } from "stream"

/**
 * A Writable stream that parses a stream of JSON objects from a Gemini API stream.
 * It handles chunked and incomplete JSON objects, assembling them before parsing.
 */
export class StreamProcessor extends Writable {
	private buffer = ""
	private rawChunkCounter = 0
	private braceLevel = 0
	private inJsonArray = false

	constructor(
		private readonly destinationStream: Writable,
		private readonly onChunkParsed: (chunk: any) => void,
		private readonly onComplete: (finalChunkCount: number) => void,
	) {
		super({ decodeStrings: false })
	}

	_write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		this.rawChunkCounter++
		this.buffer += chunk.toString("utf8")

		this.processBuffer()
		callback()
	}

	_final(callback: (error?: Error | null) => void): void {
		// Process any remaining data in the buffer
		this.processBuffer()
		this.onComplete(this.rawChunkCounter)
		callback()
	}

	private processBuffer(): void {
		while (true) {
			if (!this.inJsonArray) {
				const arrayStartIndex = this.buffer.indexOf("[")
				if (arrayStartIndex !== -1) {
					this.buffer = this.buffer.substring(arrayStartIndex)
					this.inJsonArray = true
				} else {
					// If no array start is found, and buffer has content, it's likely invalid data.
					if (this.buffer.length > 0) {
						this.buffer = "" // Clear buffer to prevent processing invalid data.
					}
					break
				}
			}

			const objectStartIndex = this.buffer.indexOf("{")
			if (objectStartIndex === -1) {
				// If we are in an array but see a closing bracket, reset the state.
				if (this.buffer.includes("]")) {
					this.inJsonArray = false
					this.buffer = "" // Clear buffer.
				}
				break // Wait for more data if no object start is found.
			}

			let i = objectStartIndex
			this.braceLevel = 0
			let foundObject = false
			for (; i < this.buffer.length; i++) {
				if (this.buffer[i] === "{") {
					this.braceLevel++
				} else if (this.buffer[i] === "}") {
					this.braceLevel--
					if (this.braceLevel === 0) {
						const objectStr = this.buffer.substring(objectStartIndex, i + 1)
						try {
							const geminiChunk = JSON.parse(objectStr)
							const contentChunk = geminiChunk.response || geminiChunk
							this.onChunkParsed(contentChunk)
						} catch (e) {
							// Log the error but continue processing.
							console.warn("Failed to parse JSON object from stream.", {
								object: objectStr,
								error: e,
							})
						}
						this.buffer = this.buffer.substring(i + 1)
						foundObject = true
						break // Restart processing for the rest of the buffer.
					}
				}
			}

			if (!foundObject) {
				break // Incomplete object, wait for more data.
			}
		}
	}
}
