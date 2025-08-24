// Test for stream observer utility
import { describe, test, expect } from "bun:test";
import { Writer } from "../src/writer.ts";
import { streamObserve, StreamObserver } from "./stream-observer.ts";
import { Timestamp, Keyframe } from "../src/frames.ts";
import { testVDocument } from "./sample-frames.ts";

// Set up DOM polyfills

describe("Stream Observer Utility", () => {
    test("should observe chunks only after yield points", async () => {
        const [writer, stream] = Writer.create(16); // Large enough to hold both u32s
        const check = streamObserve(stream);

        // Initially no chunks
        let analysis = await check();
        expect(analysis.chunkCount).toBe(0);
        expect(analysis.totalBytes).toBe(0);

        // Write data without yielding
        writer.u32(42);  // 4 bytes
        writer.u32(100); // 4 more bytes = 8 total, under 16 byte chunk size

        // No auto-flush yet because under chunk size
        analysis = await check();
        expect(analysis.chunkCount).toBe(0);

        // Now yield - but streamWait won't flush because buffer (8 bytes) < chunk size (16 bytes)
        await writer.streamWait();

        // Still no chunks because streamWait didn't flush
        analysis = await check();
        expect(analysis.chunkCount).toBe(0);

        // Force flush with endFrame
        await writer.endFrame();

        analysis = await check();
        expect(analysis.chunkCount).toBe(1);
        expect(analysis.totalBytes).toBe(8);
        expect(analysis.chunks[0].size).toBe(8);

        writer.close();
    });

    test("should respect chunk size limits with auto-flush", async () => {
        const [writer, stream] = Writer.create(4); // Very small chunks
        const check = streamObserve(stream);

        // Write data that exceeds chunk size - should auto-flush
        writer.u32(1); // 4 bytes - exactly chunk size, should auto-flush

        // Auto-flush happened, chunk is visible immediately
        let analysis = await check();
        expect(analysis.chunkCount).toBe(1);
        expect(analysis.chunks[0].size).toBe(4);

        // Write more data
        writer.u32(2); // 4 bytes - should auto-flush again

        // Second auto-flush happened, another chunk visible
        analysis = await check();
        expect(analysis.chunkCount).toBe(1);
        expect(analysis.chunks[0].size).toBe(4);

        // Total so far should be 2 chunks, 8 bytes
        // (Note: check() drains chunks each time, so we see 1 chunk per call)

        writer.close();
    });

    test("should work with frame encoding", async () => {
        const [writer, stream] = Writer.create(16); // Small chunks to force multiple
        const check = streamObserve(stream);

        // Encode a timestamp frame
        await new Timestamp(1234567890n).encode(writer);

        let analysis = await check();
        expect(analysis.chunkCount).toBe(1);
        expect(analysis.totalBytes).toBe(12); // u32 frame type + u64 timestamp

        // Encode a keyframe with test DOM
        await new Keyframe(testVDocument, 0, 1920, 1080).encode(writer);

        analysis = await check();
        expect(analysis.chunkCount).toBeGreaterThan(0);
        expect(analysis.totalBytes).toBeGreaterThan(50); // Should be substantial

        writer.close();
    });

    test("should support streaming frame encoding analysis", async () => {
        const [writer, stream] = Writer.create(32); // Small chunks to force streaming
        const check = streamObserve(stream);

        // Use streaming encoding
        await new Keyframe(testVDocument, 0, 1920, 1080).encodeStreaming(writer);

        const analysis = await check();

        // Streaming should produce multiple chunks
        expect(analysis.chunkCount).toBeGreaterThan(1);
        expect(analysis.totalBytes).toBeGreaterThan(100);

        // Log the analysis for debugging
        console.log(`Streaming analysis: ${analysis.chunkCount} chunks, ${analysis.totalBytes} bytes`);
        console.log(`Chunk sizes: ${analysis.chunks.map(c => c.size).join(', ')}`);

        writer.close();
    });
});