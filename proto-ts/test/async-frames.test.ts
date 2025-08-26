// Test for async frame encoders
import { describe, test, expect } from "bun:test";
import { Writer } from "../src/writer.ts";
import { Timestamp, Keyframe, ViewportResized } from "../src/frames.ts";

import { streamObserve } from "./stream-observer.ts";
import { testVDocument } from "./sample-frames.ts";


describe("Async Frame Encoders", () => {
    test("should encode simple frames with endFrame", async () => {
        const [writer, stream] = Writer.create();
        const check = streamObserve(stream);

        // Encode a timestamp frame
        await new Timestamp(1234567890n).encode(writer);

        writer.close();

        // Check all data
        const analysis = await check();
        expect(analysis.chunkCount).toBeGreaterThan(0);
        expect(analysis.totalBytes).toBe(12); // u32 frame type + u64 timestamp
    });

    test("should encode keyframe with regular encode", async () => {
        const [writer, stream] = Writer.create();
        const check = streamObserve(stream);

        // Encode keyframe (regular version)
        await new Keyframe(testVDocument, 0, 1920, 1080).encode(writer);

        writer.close();

        // Check all data
        const analysis = await check();
        expect(analysis.chunkCount).toBeGreaterThan(0);
        expect(analysis.totalBytes).toBeGreaterThan(50); // Should be substantial
    });

    test("should encode viewport resized frame", async () => {
        const [writer, stream] = Writer.create();
        const check = streamObserve(stream);

        // Encode viewport resized frame
        await new ViewportResized(1920, 1080).encode(writer);

        writer.close();

        // Check all data
        const analysis = await check();
        expect(analysis.chunkCount).toBeGreaterThan(0);
        expect(analysis.totalBytes).toBe(12); // u32 frame type + u32 width + u32 height
    });
});