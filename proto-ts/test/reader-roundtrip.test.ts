// Comprehensive Writer → Reader round-trip tests
import { describe, test, expect } from "bun:test";
import { Writer } from "../src/writer.ts";
import { Reader } from "../src/reader.ts";
import { TimestampDataEnc, ViewportResizedDataEnc, KeyPressedDataEnc, MouseMovedDataEnc, FrameType, Frame } from "../src/frames.ts";
import { streamObserve, frameStreamObserve } from "./stream-observer.ts";

describe("Writer → Reader Round-trip Tests", () => {

    async function generateTestFrames(writer: Writer): Promise<void> {
        // Generate a variety of frame types
        await new TimestampDataEnc(1000n).encode(writer);
        await new ViewportResizedDataEnc(1920, 1080).encode(writer);
        await new MouseMovedDataEnc(100, 200).encode(writer);
        await new KeyPressedDataEnc("a").encode(writer);
        await new KeyPressedDataEnc("Enter").encode(writer);
        await new TimestampDataEnc(2000n).encode(writer);
        await new KeyPressedDataEnc("This is a longer string to test string handling").encode(writer);
    }

    async function createByteStreamWithChunks(data: Uint8Array, chunkSize: number): Promise<ReadableStream<Uint8Array>> {
        return new ReadableStream({
            start(controller) {
                let offset = 0;
                while (offset < data.length) {
                    const chunkEnd = Math.min(offset + chunkSize, data.length);
                    const chunk = data.slice(offset, chunkEnd);
                    controller.enqueue(chunk);
                    offset = chunkEnd;
                }
                controller.close();
            }
        });
    }

    test("should handle perfect round-trip with single chunk", async () => {
        // Generate frames with Writer
        const [writer, writerStream] = Writer.create();
        await generateTestFrames(writer);
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

        // Create single-chunk stream
        const byteStream = await createByteStreamWithChunks(frameBytes, frameBytes.length);

        // Read with Reader
        const [reader, frameStream] = Reader.create(byteStream, false);
        const readerCheck = frameStreamObserve<Frame>(frameStream);
        const frames = (await readerCheck()).chunks;

        // Verify frame count and types
        expect(frames).toHaveLength(7);
        expect(frames[0].data).toBeInstanceOf(TimestampDataEnc);
        expect(frames[1].data).toBeInstanceOf(ViewportResizedDataEnc);
        expect(frames[2].data).toBeInstanceOf(MouseMovedDataEnc);
        expect(frames[3].data).toBeInstanceOf(KeyPressedDataEnc);
        expect(frames[4].data).toBeInstanceOf(KeyPressedDataEnc);
        expect(frames[5].data).toBeInstanceOf(TimestampDataEnc);
        expect(frames[6].data).toBeInstanceOf(KeyPressedDataEnc);

        // Verify frame data
        expect((frames[0].data as TimestampDataEnc).timestamp).toBe(1000n);
        expect((frames[1].data as ViewportResizedDataEnc).width).toBe(1920);
        expect((frames[1].data as ViewportResizedDataEnc).height).toBe(1080);
        expect((frames[2].data as MouseMovedDataEnc).x).toBe(100);
        expect((frames[2].data as MouseMovedDataEnc).y).toBe(200);
        expect((frames[3].data as KeyPressedDataEnc).key).toBe("a");
        expect((frames[4].data as KeyPressedDataEnc).key).toBe("Enter");
        expect((frames[5].data as TimestampDataEnc).timestamp).toBe(2000n);
        expect((frames[6].data as KeyPressedDataEnc).key).toBe("This is a longer string to test string handling");
    });

    test("should handle 1-byte chunks (extreme fragmentation)", async () => {
        // Generate frames
        const [writer, writerStream] = Writer.create();
        await new TimestampDataEnc(12345n).encode(writer);
        await new KeyPressedDataEnc("test").encode(writer);
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

        // Create 1-byte chunks
        const byteStream = await createByteStreamWithChunks(frameBytes, 1);

        // Read with Reader
        const [reader, frameStream] = Reader.create(byteStream, false);
        const readerCheck = frameStreamObserve<Frame>(frameStream);
        const frames = (await readerCheck()).chunks;

        expect(frames).toHaveLength(2);
        expect(frames[0].data).toBeInstanceOf(TimestampDataEnc);
        expect((frames[0].data as TimestampDataEnc).timestamp).toBe(12345n);
        expect(frames[1].data).toBeInstanceOf(KeyPressedDataEnc);
        expect((frames[1].data as KeyPressedDataEnc).key).toBe("test");
    });

    test("should handle various chunk sizes", async () => {
        const chunkSizes = [1, 3, 7, 16, 64, 256];

        for (const chunkSize of chunkSizes) {
            // Generate frames
            const [writer, writerStream] = Writer.create();
            await new ViewportResizedDataEnc(800, 600).encode(writer);
            await new KeyPressedDataEnc(`chunk-size-${chunkSize}`).encode(writer);
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

            // Create chunked stream
            const byteStream = await createByteStreamWithChunks(frameBytes, chunkSize);

            // Read with Reader
            const [reader, frameStream] = Reader.create(byteStream, false);
            const readerCheck = frameStreamObserve<Frame>(frameStream);
            const frames = (await readerCheck()).chunks;

            expect(frames).toHaveLength(2);
            expect(frames[0].data).toBeInstanceOf(ViewportResizedDataEnc);
            expect((frames[0].data as ViewportResizedDataEnc).width).toBe(800);
            expect((frames[0].data as ViewportResizedDataEnc).height).toBe(600);
            expect(frames[1].data).toBeInstanceOf(KeyPressedDataEnc);
            expect((frames[1].data as KeyPressedDataEnc).key).toBe(`chunk-size-${chunkSize}`);
        }
    });

    test("should handle file mode round-trip", async () => {
        // Generate file with header
        const [writer, writerStream] = Writer.create();
        const testTimestamp = BigInt(1691234567890);

        writer.writeHeader(testTimestamp);
        await new TimestampDataEnc(9999n).encode(writer);
        await new ViewportResizedDataEnc(1024, 768).encode(writer);
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

        // Test with various chunk sizes
        const chunkSizes = [1, 8, 32, 128];

        for (const chunkSize of chunkSizes) {
            const byteStream = await createByteStreamWithChunks(fileBytes, chunkSize);

            // Read with header expected
            const [reader, frameStream] = Reader.create(byteStream, true);
            const readerCheck = frameStreamObserve<Frame>(frameStream);
            const frames = (await readerCheck()).chunks;

            // Check header
            const header = reader.getHeader();
            expect(header).not.toBeNull();
            expect(header!.version).toBe(1);
            expect(header!.createdAt).toBe(testTimestamp);

            // Check frames
            expect(frames).toHaveLength(2);
            expect(frames[0].data).toBeInstanceOf(TimestampDataEnc);
            expect((frames[0].data as TimestampDataEnc).timestamp).toBe(9999n);
            expect(frames[1].data).toBeInstanceOf(ViewportResizedDataEnc);
            expect((frames[1].data as ViewportResizedDataEnc).width).toBe(1024);
            expect((frames[1].data as ViewportResizedDataEnc).height).toBe(768);
        }
    });
});