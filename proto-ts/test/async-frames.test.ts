// Test for async frame encoders
import { describe, test, expect } from "bun:test";
import { Writer } from "../src/writer.ts";
import { TimestampDataEnc, KeyframeDataEnc, ViewportResizedDataEnc } from "../src/frames.ts";
import { setupDOMGlobals } from "./sample-frames.ts";
import { streamObserve } from "./stream-observer.ts";
import { JSDOM } from "jsdom";
import { convertDOMDocumentToVDocument } from "../src/dom-converter.ts";

// Set up DOM polyfills
setupDOMGlobals();

describe("Async Frame Encoders", () => {
    test("should encode simple frames with endFrame", async () => {
        const [writer, stream] = Writer.create();
        const check = streamObserve(stream);

        // Encode a timestamp frame
        await new TimestampDataEnc(1234567890n).encode(writer);

        writer.close();

        // Check all data
        const analysis = await check();
        expect(analysis.chunkCount).toBeGreaterThan(0);
        expect(analysis.totalBytes).toBe(12); // u32 frame type + u64 timestamp
    });

    test("should encode keyframe with regular encode", async () => {
        const dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <head><title>Test</title></head>
            <body><div>Hello</div></body>
            </html>
        `);

        const [writer, stream] = Writer.create();
        const check = streamObserve(stream);

        // Encode keyframe (regular version)
        const vdocument = convertDOMDocumentToVDocument(dom.window.document);
        await new KeyframeDataEnc(vdocument).encode(writer);

        writer.close();

        // Check all data
        const analysis = await check();
        expect(analysis.chunkCount).toBeGreaterThan(0);
        expect(analysis.totalBytes).toBeGreaterThan(50); // Should be substantial
    });

    test("should encode keyframe with streaming version", async () => {
        const dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <head><title>Test</title></head>
            <body>
                <div>Hello</div>
                <div>World</div>
                <div>More content</div>
            </body>
            </html>
        `);

        const [writer, stream] = Writer.create(64); // Small chunks to force streaming
        const check = streamObserve(stream);

        // Encode keyframe (streaming version)
        const vdocument = convertDOMDocumentToVDocument(dom.window.document);
        await new KeyframeDataEnc(vdocument).encodeStreaming(writer);

        writer.close();

        // Check all data
        const analysis = await check();

        // Should have multiple chunks due to streaming
        expect(analysis.chunkCount).toBeGreaterThan(1);
        expect(analysis.totalBytes).toBeGreaterThan(100); // Should be substantial

        // Verify chunk sizes respect limits
        for (const chunk of analysis.chunks) {
            expect(chunk.size).toBeLessThanOrEqual(64);
        }
    });

    test("should encode viewport resized frame", async () => {
        const [writer, stream] = Writer.create();
        const check = streamObserve(stream);

        // Encode viewport resized frame
        await new ViewportResizedDataEnc(1920, 1080).encode(writer);

        writer.close();

        // Check all data
        const analysis = await check();
        expect(analysis.chunkCount).toBeGreaterThan(0);
        expect(analysis.totalBytes).toBe(12); // u32 frame type + u32 width + u32 height
    });
});