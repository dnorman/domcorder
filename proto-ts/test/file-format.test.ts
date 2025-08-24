// Test for .dcrr file format (header + frame stream)
import { describe, test, expect } from "bun:test";
import { Writer, DCRR_MAGIC, DCRR_VERSION, HEADER_SIZE } from "../src/writer.ts";
import { compareBinaryFile } from "./util.js";
import { generateTestFrames } from "./sample-frames.ts";
import { streamObserve } from "./stream-observer.ts";

// Set up DOM polyfills

describe("File Format (.dcrr)", () => {
    test("should write valid file header", async () => {
        const [writer, stream] = Writer.create();
        const check = streamObserve(stream);
        const testTimestamp = BigInt(1234567890123);

        writer.writeHeader(testTimestamp);
        writer.close();

        // Get header data
        const analysis = await check();
        expect(analysis.totalBytes).toBe(HEADER_SIZE);

        // Combine all chunks into single array for analysis
        const totalSize = analysis.totalBytes;
        const data = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunkInfo of analysis.chunks) {
            data.set(chunkInfo.data, offset);
            offset += chunkInfo.data.length;
        }

        expect(data.length).toBe(HEADER_SIZE);

        // Verify magic bytes
        expect(data.slice(0, 4)).toEqual(DCRR_MAGIC);

        // Verify version
        const view = new DataView(data.buffer, data.byteOffset);
        expect(view.getUint32(4, false)).toBe(DCRR_VERSION); // big-endian

        // Verify timestamp
        expect(view.getBigUint64(8, false)).toBe(testTimestamp); // big-endian

        // Verify reserved bytes are zero
        for (let i = 16; i < 32; i++) {
            expect(data[i]).toBe(0);
        }
    });

    test("should write file format with header + frames", async () => {
        const [writer, stream] = Writer.create();
        const check = streamObserve(stream);
        const testTimestamp = BigInt(1691234567890);

        // Write file header
        writer.writeHeader(testTimestamp);

        // Write standard test frame sequence
        await generateTestFrames(writer);

        writer.close();

        // Get all data
        const analysis = await check();

        // Combine chunks into single array
        const fileData = new Uint8Array(analysis.totalBytes);
        let offset = 0;
        for (const chunkInfo of analysis.chunks) {
            fileData.set(chunkInfo.data, offset);
            offset += chunkInfo.data.length;
        }

        // Verify file structure
        expect(fileData.length).toBeGreaterThan(HEADER_SIZE);

        // Header should match
        expect(fileData.slice(0, 4)).toEqual(DCRR_MAGIC);

        // Frame data should start after header
        const frameData = fileData.slice(HEADER_SIZE);
        expect(frameData.length).toBeGreaterThan(0);

        // Should be able to identify first frame type (Timestamp = 0)
        const frameTypeView = new DataView(frameData.buffer, frameData.byteOffset);
        expect(frameTypeView.getUint32(0, false)).toBe(0); // Timestamp frame type

        console.log(`✅ Generated .dcrr file format: ${fileData.length} bytes (${HEADER_SIZE} header + ${frameData.length} frames)`);
        console.log(`📊 Stream analysis: ${analysis.chunkCount} chunks, avg size: ${analysis.averageChunkSize.toFixed(1)} bytes`);

        // Compare to reference file
        compareBinaryFile("file-basic.dcrr", fileData, "file-basic");
    });

    test("should create deterministic header for same timestamp", async () => {
        const testTimestamp = BigInt(1691234567890);

        // Create first writer
        const [writer1, stream1] = Writer.create();
        const check1 = streamObserve(stream1);
        writer1.writeHeader(testTimestamp);
        writer1.close();

        const analysis1 = await check1();
        const data1 = new Uint8Array(analysis1.totalBytes);
        let offset1 = 0;
        for (const chunkInfo of analysis1.chunks) {
            data1.set(chunkInfo.data, offset1);
            offset1 += chunkInfo.data.length;
        }

        // Create second writer
        const [writer2, stream2] = Writer.create();
        const check2 = streamObserve(stream2);
        writer2.writeHeader(testTimestamp);
        writer2.close();

        const analysis2 = await check2();
        const data2 = new Uint8Array(analysis2.totalBytes);
        let offset2 = 0;
        for (const chunkInfo of analysis2.chunks) {
            data2.set(chunkInfo.data, offset2);
            offset2 += chunkInfo.data.length;
        }

        expect(data1).toEqual(data2);
    });

});