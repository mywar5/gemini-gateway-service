import { StreamParser } from "../stream-parser"

// Helper function to collect all yielded values from an async generator for a single chunk
async function collectResults(parser: StreamParser, chunk: string): Promise<any[]> {
	const results: any[] = []
	for await (const result of parser.parse(chunk)) {
		results.push(result)
	}
	return results
}

// Helper function to process multiple chunks sequentially with the same parser instance
async function processChunks(parser: StreamParser, chunks: string[]): Promise<any[]> {
	const allResults: any[] = []
	for (const chunk of chunks) {
		for await (const result of parser.parse(chunk)) {
			allResults.push(result)
		}
	}
	return allResults
}

describe("StreamParser (Robust Implementation)", () => {
	it("should parse a single, complete JSON object arriving in one chunk", async () => {
		const parser = new StreamParser()
		const chunk = '[{"key": "value"}]'
		const results = await collectResults(parser, chunk)
		expect(results).toEqual([{ key: "value" }])
	})

	it("should handle the opening bracket in a separate chunk", async () => {
		const parser = new StreamParser()
		const results1 = await collectResults(parser, "[")
		const results2 = await collectResults(parser, '{"key": "value"}]')
		expect(results1).toEqual([])
		expect(results2).toEqual([{ key: "value" }])
	})

	it("should correctly parse the problematic log stream", async () => {
		const parser = new StreamParser()
		const chunk1 =
			'[{\n  "response": {\n    "candidates": [\n      {\n        "content": {\n          "role": "model",\n          "parts": [\n            {\n              "text": "OK, I will analyze this project. First, I need to understand the basic structure of the project.\\n<execute_bash>\\nls -F\\n</execute_bash>"\n            }\n          ]\n        }\n      }\n    ]\n  }\n}]'
		const chunk2 = "]" // This chunk is often just the closing bracket.

		const results1 = await collectResults(parser, chunk1)
		const results2 = await collectResults(parser, chunk2)

		const expected = [
			{
				response: {
					candidates: [
						{
							content: {
								role: "model",
								parts: [
									{
										text: "OK, I will analyze this project. First, I need to understand the basic structure of the project.\n<execute_bash>\nls -F\n</execute_bash>",
									},
								],
							},
						},
					],
				},
			},
		]

		expect(results1).toEqual(expected)
		expect(results2).toEqual([]) // The closing bracket should not yield any object.
	})

	it("should not parse an incomplete JSON object", async () => {
		const parser = new StreamParser()
		const chunk = '[{"key": "value"' // Missing closing brace and bracket
		const results = await collectResults(parser, chunk)
		expect(results).toEqual([])
	})

	it("should parse a complete object once the closing brace arrives in a subsequent chunk", async () => {
		const parser = new StreamParser()
		const results = await processChunks(parser, ['[{"key": "value"', "}]"])
		expect(results).toEqual([{ key: "value" }])
	})

	it("should parse multiple complete objects in a single chunk, separated by commas", async () => {
		const parser = new StreamParser()
		const chunk = '[{"id": 1}, {"id": 2}, {"id": 3}]'
		const results = await collectResults(parser, chunk)
		expect(results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
	})

	it("should parse multiple objects arriving in different chunks", async () => {
		const parser = new StreamParser()
		const results1 = await collectResults(parser, '[{"id": 1},')
		const results2 = await collectResults(parser, '{"id": 2}, {"id": 3}')
		const results3 = await collectResults(parser, "]")

		expect(results1).toEqual([{ id: 1 }])
		expect(results2).toEqual([{ id: 2 }, { id: 3 }])
		expect(results3).toEqual([])
	})

	it("should handle chunks that start with a comma and whitespace", async () => {
		const parser = new StreamParser()
		await collectResults(parser, '[{"id": 1}')
		const results = await collectResults(parser, ', {"id": 2}]')
		expect(results).toEqual([{ id: 2 }])
	})

	it("should correctly parse objects with nested braces and brackets", async () => {
		const parser = new StreamParser()
		const complexObject = {
			id: "abc",
			data: [1, 2, 3],
			nested: { a: { b: "c" } },
		}
		const chunk = JSON.stringify([complexObject])
		const results = await collectResults(parser, chunk)
		expect(results).toEqual([complexObject])
	})

	it("should correctly handle braces inside strings", async () => {
		const parser = new StreamParser()
		const chunk = '[{"message": "This is a {test} message."}]'
		const results = await collectResults(parser, chunk)
		expect(results).toEqual([{ message: "This is a {test} message." }])
	})

	it("should handle an empty stream and empty chunks gracefully", async () => {
		const parser = new StreamParser()
		expect(await collectResults(parser, "")).toEqual([])
		expect(await collectResults(parser, "[]")).toEqual([])
		expect(await collectResults(parser, " ")).toEqual([])
	})

	it("should parse a stream delivered character by character", async () => {
		const parser = new StreamParser()
		const stream = '[{"id":1},{"id":2}]'
		const results = await processChunks(parser, stream.split(""))
		expect(results).toEqual([{ id: 1 }, { id: 2 }])
	})
})
