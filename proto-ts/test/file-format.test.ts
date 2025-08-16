// Test for .dcrr file format (header + frame stream)
import { describe, test, expect } from "bun:test";
import { Writer, DCRR_MAGIC, DCRR_VERSION, HEADER_SIZE } from "../src/writer.ts";
import { compareBinaryFile } from "./util.js";
import { setupDOMGlobals, generateTestFrames } from "./sample-frames.ts";

// Set up DOM polyfills
setupDOMGlobals();

describe("File Format (.dcrr)", () => {
    test("should write valid file header", () => {
        const writer = new Writer();
        const testTimestamp = BigInt(1234567890123);
        
        writer.writeHeader(testTimestamp);
        const data = writer.finish();
        
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
    
    test("should write file format with header + frames", () => {
        const writer = new Writer();
        const testTimestamp = BigInt(1691234567890);
        
        // Write file header
        writer.writeHeader(testTimestamp);
        
        // Write standard test frame sequence
        generateTestFrames(writer);
        
        // Generate file data
        const fileData = writer.finish();
        
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
        
        // Compare to reference file
        compareBinaryFile("file-basic.dcrr", fileData, "file-basic");
    });
    
    test("should create deterministic header for same timestamp", () => {
        const testTimestamp = BigInt(1691234567890);
        
        const writer1 = new Writer();
        writer1.writeHeader(testTimestamp);
        const data1 = writer1.finish();
        
        const writer2 = new Writer();
        writer2.writeHeader(testTimestamp);
        const data2 = writer2.finish();
        
        expect(data1).toEqual(data2);
    });
    
});