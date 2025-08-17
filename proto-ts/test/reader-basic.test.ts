// Basic Reader tests
import { describe, test, expect } from "bun:test";
import { Writer } from "../src/writer.ts";
import { Reader } from "../src/reader.ts";
import { TimestampDataEnc, ViewportResizedDataEnc, KeyPressedDataEnc } from "../src/frames.ts";
import { FrameType, Frame, TimestampData, ViewportResizedData, KeyPressedData } from "../src/protocol.ts";
import { streamObserve, frameStreamObserve } from "./stream-observer.ts";

describe("Reader Basic Functionality", () => {
    test("should read simple timestamp frame", async () => {
        // Create a timestamp frame with Writer
        const [writer, writerStream] = Writer.create();
        await TimestampDataEnc.encode(writer, 1234567890n);
        writer.close();

        // Consume writer output
        const writerCheck = streamObserve(writerStream);
        const writerAnalysis = await writerCheck();

        // Combine writer chunks into single stream
        const frameBytes = new Uint8Array(writerAnalysis.totalBytes);
        let offset = 0;
        for (const chunk of writerAnalysis.chunks) {
            frameBytes.set(chunk.data, offset);
            offset += chunk.data.length;
        }

        // Create readable stream from bytes
        const byteStream = new ReadableStream({
            start(controller) {
                controller.enqueue(frameBytes);
                controller.close();
            }
        });

        // Read with Reader (no header expected)
        const [reader, frameStream] = Reader.create(byteStream, false);

        // Collect frames
        const readerCheck = frameStreamObserve<Frame>(frameStream);
        const frames = (await readerCheck()).chunks;

        expect(frames).toHaveLength(1);
        const frame = frames[0].data;
        expect(frame.frameType).toBe(FrameType.Timestamp);
        expect((frame.data as TimestampData).timestamp).toBe(1234567890);
    });

    test("should read multiple simple frames", async () => {
        // Create multiple frames with Writer
        const [writer, writerStream] = Writer.create();
        await TimestampDataEnc.encode(writer, 1000n);
        await ViewportResizedDataEnc.encode(writer, 1920, 1080);
        await KeyPressedDataEnc.encode(writer, "Enter");
        writer.close();

        // Get writer output
        const writerCheck = streamObserve(writerStream);
        const writerAnalysis = await writerCheck();

        const frameBytes = new Uint8Array(writerAnalysis.totalBytes);
        let offset = 0;
        for (const chunk of writerAnalysis.chunks) {
            frameBytes.set(chunk.data, offset);
            offset += chunk.data.length;
        }

        // Create byte stream
        const byteStream = new ReadableStream({
            start(controller) {
                controller.enqueue(frameBytes);
                controller.close();
            }
        });

        // Read frames
        const [reader, frameStream] = Reader.create(byteStream, false);
        const readerCheck = frameStreamObserve<Frame>(frameStream);
        const frames = (await readerCheck()).chunks;

        expect(frames).toHaveLength(3);

        // Check timestamp frame
        expect(frames[0].data.frameType).toBe(FrameType.Timestamp);
        expect((frames[0].data.data as TimestampData).timestamp).toBe(1000);

        // Check viewport frame
        expect(frames[1].data.frameType).toBe(FrameType.ViewportResized);
        expect((frames[1].data.data as ViewportResizedData).width).toBe(1920);
        expect((frames[1].data.data as ViewportResizedData).height).toBe(1080);

        // Check key pressed frame
        expect(frames[2].data.frameType).toBe(FrameType.KeyPressed);
        expect((frames[2].data.data as KeyPressedData).key).toBe("Enter");
    });

    test("should handle file mode with header", async () => {
        // Create file with header using Writer
        const [writer, writerStream] = Writer.create();
        const testTimestamp = BigInt(1691234567890);

        writer.writeHeader(testTimestamp);
        await TimestampDataEnc.encode(writer, 5000n);
        writer.close();

        // Get writer output
        const writerCheck = streamObserve(writerStream);
        const writerAnalysis = await writerCheck();

        const fileBytes = new Uint8Array(writerAnalysis.totalBytes);
        let offset = 0;
        for (const chunk of writerAnalysis.chunks) {
            fileBytes.set(chunk.data, offset);
            offset += chunk.data.length;
        }

        // Create byte stream
        const byteStream = new ReadableStream({
            start(controller) {
                controller.enqueue(fileBytes);
                controller.close();
            }
        });

        // Read with header expected
        const [reader, frameStream] = Reader.create(byteStream, true);

        // Wait for frames to be processed (this will trigger header parsing)
        const readerCheck = frameStreamObserve<Frame>(frameStream);
        const frames = (await readerCheck()).chunks;

        // Now check header was parsed
        const header = reader.getHeader();
        expect(header).not.toBeNull();
        expect(header!.version).toBe(1);
        expect(header!.createdAt).toBe(testTimestamp);

        expect(frames).toHaveLength(1);
        expect(frames[0].data.frameType).toBe(FrameType.Timestamp);
        expect((frames[0].data.data as TimestampData).timestamp).toBe(5000);
    });
});