import { StreamProcessor } from "../stream-processor"
import { Writable } from "stream"

// Mock Writable stream for testing
class MockWritable extends Writable {
	public content = ""
	_write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		this.content += chunk.toString()
		callback()
	}
}

describe("StreamProcessor", () => {
	it("should process a complete JSON object in a single chunk", (done) => {
		const destinationStream = new MockWritable()
		const parsedChunks: any[] = []
		const onComplete = (finalChunkCount: number) => {
			expect(finalChunkCount).toBe(1)
			expect(parsedChunks.length).toBe(1)
			expect(parsedChunks[0].candidates[0].content.parts[0].text).toBe("Hello, world!")
			done()
		}
		const processor = new StreamProcessor(destinationStream, (chunk) => parsedChunks.push(chunk), onComplete)

		const geminiResponse =
			'[{ "response": { "candidates": [ { "content": { "parts": [ { "text": "Hello, world!" } ] } } ] } }]'
		processor.write(geminiResponse)
		processor.end()
	})

	it("should handle JSON streamed in multiple chunks", (done) => {
		const destinationStream = new MockWritable()
		const parsedChunks: any[] = []
		const onComplete = (finalChunkCount: number) => {
			expect(finalChunkCount).toBe(3)
			expect(parsedChunks.length).toBe(1)
			expect(parsedChunks[0].candidates[0].content.parts[0].text).toBe("This is a test.")
			done()
		}
		const processor = new StreamProcessor(destinationStream, (chunk) => parsedChunks.push(chunk), onComplete)

		processor.write('[{"response":{"candidates":[{"content":{"parts":[{"text":"This is')
		processor.write(' a test."}]}}]}')
		processor.write("}]")
		processor.end()
	})

	it("should handle multiple JSON objects in the stream", (done) => {
		const destinationStream = new MockWritable()
		const parsedChunks: any[] = []
		const onComplete = (finalChunkCount: number) => {
			expect(finalChunkCount).toBe(1)
			expect(parsedChunks.length).toBe(2)
			expect(parsedChunks[0].candidates[0].content.parts[0].text).toBe("First part.")
			expect(parsedChunks[1].candidates[0].content.parts[0].text).toBe("Second part.")
			done()
		}
		const processor = new StreamProcessor(destinationStream, (chunk) => parsedChunks.push(chunk), onComplete)

		const geminiResponse =
			'[{"response":{"candidates":[{"content":{"parts":[{"text":"First part."}]}}]}}, {"response":{"candidates":[{"content":{"parts":[{"text":"Second part."}]}}]}}]'
		processor.write(geminiResponse)
		processor.end()
	})

	it("should correctly parse text containing special characters and unicode", (done) => {
		const destinationStream = new MockWritable()
		const parsedChunks: any[] = []
		const onComplete = (finalChunkCount: number) => {
			expect(finalChunkCount).toBe(1)
			expect(parsedChunks.length).toBe(1)
			expect(parsedChunks[0].candidates[0].content.parts[0].text).toBe('Text with "quotes" and unicode 😊.')
			done()
		}
		const processor = new StreamProcessor(destinationStream, (chunk) => parsedChunks.push(chunk), onComplete)

		const geminiResponse =
			'[{"response":{"candidates":[{"content":{"parts":[{"text":"Text with \\"quotes\\" and unicode 😊."}]}}]} }]'
		processor.write(geminiResponse)
		processor.end()
	})

	it("should handle empty stream and not call onChunkParsed", (done) => {
		const destinationStream = new MockWritable()
		const parsedChunks: any[] = []
		const onComplete = (finalChunkCount: number) => {
			expect(finalChunkCount).toBe(0)
			expect(parsedChunks.length).toBe(0)
			done()
		}
		const processor = new StreamProcessor(destinationStream, (chunk) => parsedChunks.push(chunk), onComplete)

		processor.end()
	})
})
