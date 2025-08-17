// Test for consolidated Writer class
import { describe, test, expect } from "bun:test";
import { Writer } from "../src/writer.ts";
import { streamObserve } from "./stream-observer.ts";

describe("Consolidated Writer", () => {
    test("should create writer and stream via factory", () => {
        const [writer, stream] = Writer.create();

        expect(writer).toBeDefined();
        expect(stream).toBeInstanceOf(ReadableStream);
    });

    test("should write basic data and stream it", async () => {
        const [writer, stream] = Writer.create(8); // Small chunks
        const check = streamObserve(stream);

        // Write some data
        writer.u32(42);
        writer.u32(100);

        // End frame should flush
        await writer.endFrame();

        // Check the chunk
        const analysis = await check();
        expect(analysis.chunkCount).toBe(1);
        expect(analysis.totalBytes).toBe(8); // Two u32s
        expect(analysis.chunks[0].size).toBe(8);

        writer.close();
    });

    test("should auto-flush when buffer reaches chunk size", async () => {
        const [writer, stream] = Writer.create(4); // Very small chunks
        const check = streamObserve(stream);

        // Write 4 bytes - should auto-flush immediately
        writer.u32(42);

        // Auto-flush makes chunk visible immediately
        const analysis = await check();
        expect(analysis.chunkCount).toBe(1);
        expect(analysis.chunks[0].size).toBe(4);

        writer.close();
    });

    test("should handle string streaming for large strings", async () => {
        const [writer, stream] = Writer.create(16); // Small chunks
        const check = streamObserve(stream);

        // Create a large string that will exceed buffer
        const largeString = "x".repeat(50);

        // Write with streaming
        await writer.strUtf8Streaming(largeString);
        await writer.endFrame();

        writer.close();

        // Check all chunks
        const analysis = await check();

        // Should have multiple chunks
        expect(analysis.chunkCount).toBeGreaterThan(1);
        expect(analysis.totalBytes).toBeGreaterThan(50); // String bytes + length prefix

        // Verify no chunk exceeds our limit
        for (const chunk of analysis.chunks) {
            expect(chunk.size).toBeLessThanOrEqual(16);
        }
    });

    test("should NOT flush when streamWait called under threshold", async () => {
        const [writer, stream] = Writer.create(16); // 16 byte threshold
        const check = streamObserve(stream);

        // Write some data but stay under threshold
        writer.u32(42); // 4 bytes
        writer.u32(100); // 4 more bytes = 8 total, under 16 byte threshold

        expect(writer.getBufferSize()).toBe(8);

        // streamWait should NOT flush since we're under threshold
        await writer.streamWait();

        // Buffer should still contain the data
        expect(writer.getBufferSize()).toBe(8);

        // No chunks should be visible yet
        let analysis = await check();
        expect(analysis.chunkCount).toBe(0);

        // Force flush with endFrame
        await writer.endFrame();

        // Now we should get the data
        analysis = await check();
        expect(analysis.chunkCount).toBe(1);
        expect(analysis.chunks[0].size).toBe(8);

        writer.close();
    });
});