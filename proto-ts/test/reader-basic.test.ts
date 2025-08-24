// Basic Reader tests
import { describe, test, expect } from "bun:test";
import { Writer } from "../src/writer.ts";
import { Reader } from "../src/reader.ts";
import { Timestamp, ViewportResized, KeyPressed, FrameType, Frame } from "../src/frames.ts";
import { streamObserve, frameStreamObserve } from "./stream-observer.ts";

describe("Reader Basic Functionality", () => {
    test("should read simple timestamp frame", async () => {
        // Create a timestamp frame with Writer
        const [writer, writerStream] = Writer.create();
        await new Timestamp(1234567890n).encode(writer);
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
        expect(frame).toBeInstanceOf(Timestamp);
        expect((frame as Timestamp).timestamp).toBe(1234567890n);
    });

    test("should read multiple simple frames", async () => {
        // Create multiple frames with Writer
        const [writer, writerStream] = Writer.create();
        await new Timestamp(1000n).encode(writer);
        await new ViewportResized(1920, 1080).encode(writer);
        await new KeyPressed("Enter", false, false, false, false).encode(writer);
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
        expect(frames[0].data).toBeInstanceOf(Timestamp);
        expect((frames[0].data as Timestamp).timestamp).toBe(1000n);

        // Check viewport frame
        expect(frames[1].data).toBeInstanceOf(ViewportResized);
        expect((frames[1].data as ViewportResized).width).toBe(1920);
        expect((frames[1].data as ViewportResized).height).toBe(1080);

        // Check key pressed frame
        expect(frames[2].data).toBeInstanceOf(KeyPressed);
        expect((frames[2].data as KeyPressed).code).toBe("Enter");
    });

    test("should handle file mode with header", async () => {
        // Create file with header using Writer
        const [writer, writerStream] = Writer.create();
        const testTimestamp = BigInt(1691234567890);

        writer.writeHeader(testTimestamp);
        await new Timestamp(5000n).encode(writer);
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
        expect(frames[0].data).toBeInstanceOf(Timestamp);
        expect((frames[0].data as Timestamp).timestamp).toBe(5000n);
    });
});