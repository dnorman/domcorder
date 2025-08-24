// Reader error handling tests
import { describe, test, expect } from "bun:test";
import { Reader } from "../src/reader.ts";
import { frameStreamObserve } from "./stream-observer.ts";
import { Frame } from "../src/frames.ts";

describe("Reader Error Handling", () => {
    test("should fail immediately on invalid magic bytes when expecting header", async () => {
        // Create stream with invalid magic bytes
        const invalidHeader = new Uint8Array([
            // Invalid magic: "XXXX" instead of "DCRR"
            0x58, 0x58, 0x58, 0x58,
            // Version (u32 BE)
            0x00, 0x00, 0x00, 0x01,
            // Timestamp (u64 BE)
            0x00, 0x00, 0x01, 0x8A, 0x6E, 0x26, 0x94, 0x00,
            // Reserved (16 bytes)
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ]);

        const byteStream = new ReadableStream({
            start(controller) {
                controller.enqueue(invalidHeader);
                controller.close();
            }
        });

        // Should throw immediately when header is parsed
        const [reader, frameStream] = Reader.create(byteStream, true);

        await expect(async () => {
            const streamReader = frameStream.getReader();
            await streamReader.read();
        }).toThrow("Invalid magic bytes: expected DCRR, got XXXX");
    });

    test("should fail on truncated stream when expecting more data", async () => {
        // Create stream that ends abruptly in middle of frame
        const truncatedData = new Uint8Array([
            // Frame type: Timestamp (u32 BE)
            0x00, 0x00, 0x00, 0x00,
            // Partial timestamp data (only 4 bytes instead of 8)
            0x00, 0x00, 0x00, 0x01
        ]);

        const byteStream = new ReadableStream({
            start(controller) {
                controller.enqueue(truncatedData);
                controller.close();
            }
        });

        const [reader, frameStream] = Reader.create(byteStream, false);

        await expect(async () => {
            const streamReader = frameStream.getReader();
            await streamReader.read();
        }).toThrow("Unexpected end of stream: incomplete frame data");
    });

    test("should fail on invalid frame type", async () => {
        // Create stream with invalid frame type
        const invalidFrame = new Uint8Array([
            // Invalid frame type: 999 (doesn't exist)
            0x00, 0x00, 0x03, 0xE7
        ]);

        const byteStream = new ReadableStream({
            start(controller) {
                controller.enqueue(invalidFrame);
                controller.close();
            }
        });

        const [reader, frameStream] = Reader.create(byteStream, false);

        await expect(async () => {
            const streamReader = frameStream.getReader();
            await streamReader.read();
        }).toThrow("Failed to decode frame - unknown or invalid frame type");
    });

    test("should fail on string with invalid length", async () => {
        // Create KeyPressed frame with string length that exceeds available data
        const invalidString = new Uint8Array([
            // Frame type: KeyPressed
            0x00, 0x00, 0x00, 0x06,
            // String length: claims 1000 bytes but we only have 4
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xE8,
            // Only 4 bytes of actual data
            0x74, 0x65, 0x73, 0x74
        ]);

        const byteStream = new ReadableStream({
            start(controller) {
                controller.enqueue(invalidString);
                controller.close();
            }
        });

        const [reader, frameStream] = Reader.create(byteStream, false);

        await expect(async () => {
            const streamReader = frameStream.getReader();
            await streamReader.read();
        }).toThrow("Unexpected end of stream: incomplete frame data");
    });
});