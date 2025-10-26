import { VNode, VDocument } from "./vdom";
import { Frame, FrameType } from "./frames";

// BufferReader interface for DOM decoding
interface BufferReader {
    readU32(): number;
    readU64(): bigint;
    readString(): string;
    readBytes(length: number): Uint8Array;
    readByte(): number; // Read a single byte
}

// Header structure for .dcrr files
export interface DCRRHeader {
    magic: Uint8Array;
    version: number;
    createdAt: bigint;
}

export class Reader implements BufferReader {
    private buffer: Uint8Array;
    private bufferOffset: number = 0;
    private controller?: ReadableStreamDefaultController<Frame>;
    private stream: ReadableStream<Frame>;
    private header: DCRRHeader | null = null;
    private expectHeader: boolean;
    private headerParsed: boolean = false;
    private frameNumber: number = 0;
    private static dec = new TextDecoder();

    private constructor(inputStream: ReadableStream<Uint8Array>, expectHeader: boolean) {
        this.buffer = new Uint8Array(0);
        this.expectHeader = expectHeader;

        this.stream = new ReadableStream({
            start: (controller) => {
                this.controller = controller;
                this.startReading(inputStream);
            },
        });
    }

    /**
     * Create a Reader that consumes a byte stream and outputs a frame stream.
     * @param inputStream - Stream of byte chunks with arbitrary boundaries
     * @param expectHeader - true for file mode (32-byte header), false for stream mode
     * @returns Tuple of [Reader instance, ReadableStream<Frame>]
     */
    static create(
        inputStream: ReadableStream<Uint8Array>,
        expectHeader: boolean
    ): [Reader, ReadableStream<Frame>] {
        const reader = new Reader(inputStream, expectHeader);
        return [reader, reader.stream];
    }

    /**
     * Get the parsed header if expectHeader was true and header has been parsed.
     * @returns Header data or null if no header expected/parsed
     */
    getHeader(): DCRRHeader | null {
        return this.header;
    }

    private async startReading(inputStream: ReadableStream<Uint8Array>): Promise<void> {
        const reader = inputStream.getReader();

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    // End of input - check if we have incomplete data
                    if (this.bufferOffset < this.buffer.length) {
                        throw new Error("Unexpected end of stream: incomplete frame data");
                    }
                    this.controller?.close();
                    break;
                }

                // Append new data to buffer
                this.appendToBuffer(value);

                // Process any complete frames
                await this.processBuffer();
            }
        } catch (error) {
            console.error("Reader error:", error);
            this.controller?.error(error);
        } finally {
            reader.releaseLock();
        }
    }

    private appendToBuffer(newData: Uint8Array): void {
        // Create new buffer with combined size
        const newBuffer = new Uint8Array(this.buffer.length + newData.length);

        // Copy existing data
        newBuffer.set(this.buffer);

        // Append new data
        newBuffer.set(newData, this.buffer.length);

        this.buffer = newBuffer;
    }

    private async processBuffer(): Promise<void> {
        // First, handle header if expected and not yet parsed
        if (this.expectHeader && !this.headerParsed) {
            if (!this.tryParseHeader()) {
                return; // Not enough data yet
            }
        }

        // Process frames
        while (this.tryParseFrame()) {
            // Keep parsing frames while we have complete ones
        }
    }

    private tryParseHeader(): boolean {
        const HEADER_SIZE = 32;

        if (this.availableBytes() < HEADER_SIZE) {
            return false; // Not enough data
        }

        // If we have more than HEADER_SIZE bytes and still haven't found valid header,
        // the magic bytes must be wrong - fail immediately
        if (this.availableBytes() >= HEADER_SIZE) {
            // Parse magic bytes first
            const magic = this.buffer.slice(this.bufferOffset, this.bufferOffset + 4);
            const expectedMagic = new Uint8Array([0x44, 0x43, 0x52, 0x52]); // "DCRR"

            // Verify magic bytes - fail immediately if wrong
            if (!this.arraysEqual(magic, expectedMagic)) {
                throw new Error(`Invalid magic bytes: expected DCRR, got ${Array.from(magic).map(b => String.fromCharCode(b)).join('')}`);
            }

            // Advance past magic bytes
            this.bufferOffset += 4;

            // Parse version (u32 BE)
            const version = this.readU32();

            // Parse timestamp (u64 BE)  
            const createdAt = this.readU64();

            // Skip reserved bytes (16 bytes)
            this.bufferOffset += 16;

            this.header = { magic, version, createdAt };
            this.headerParsed = true;
            return true;
        }

        return false; // Should never reach here, but for completeness
    }

    private tryParseFrame(): boolean {
        // Need at least 4 bytes for frame type
        if (this.availableBytes() < 4) {
            return false;
        }

        const startOffset = this.bufferOffset;

        try {
            this.frameNumber++;

            // Parse frame using Frame.decode (which reads the frame type internally)
            const frame = Frame.decode(this);

            if (frame === null) {
                throw new Error("Failed to decode frame - unknown or invalid frame type");
            }

            // Emit the frame
            this.controller?.enqueue(frame);

            // Compact buffer by removing consumed bytes
            this.compactBuffer();

            return true;
        } catch (error) {
            // Restore offset and re-throw if it's a real error
            this.bufferOffset = startOffset;
            this.frameNumber--; // Decrement since we failed

            if (error instanceof Error && error.message.startsWith("Not enough data")) {
                return false; // Not enough data, wait for more
            }

            console.error(`❌ Reader: Frame ${this.frameNumber + 1} decode failed:`, error);
            throw error; // Real parsing error
        }
    }

    // Buffer reading utilities
    private availableBytes(): number {
        return this.buffer.length - this.bufferOffset;
    }

    readByte(): number {
        if (this.availableBytes() < 1) {
            throw new Error("Not enough data for byte");
        }

        const value = this.buffer[this.bufferOffset];
        this.bufferOffset += 1;
        return value;
    }

    readU32(): number {
        if (this.availableBytes() < 4) {
            throw new Error("Not enough data for u32");
        }

        const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.bufferOffset, 4);
        const value = view.getUint32(0, false); // big-endian (bincode configured)
        this.bufferOffset += 4;
        return value;
    }

    readU64(): bigint {
        if (this.availableBytes() < 8) {
            throw new Error("Not enough data for u64");
        }

        const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.bufferOffset, 8);
        const value = view.getBigUint64(0, false); // big-endian (bincode configured)
        this.bufferOffset += 8;
        return value;
    }

    readString(): string {
        // Read length prefix (u64)
        const length = Number(this.readU64());

        if (this.availableBytes() < length) {
            throw new Error("Not enough data for string");
        }

        // Read UTF-8 bytes
        const bytes = this.buffer.slice(this.bufferOffset, this.bufferOffset + length);
        this.bufferOffset += length;

        return Reader.dec.decode(bytes);
    }

    readBytes(length: number): Uint8Array {
        if (this.availableBytes() < length) {
            throw new Error("Not enough data for bytes");
        }

        const bytes = this.buffer.slice(this.bufferOffset, this.bufferOffset + length);
        this.bufferOffset += length;
        return bytes;
    }

    peekU32(): number {
        if (this.availableBytes() < 4) {
            throw new Error("Not enough data for u32");
        }

        const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.bufferOffset, 4);
        const value = view.getUint32(0, false); // big-endian (bincode configured)
        // Note: we don't increment bufferOffset since this is a peek
        return value;
    }

    private compactBuffer(): void {
        if (this.bufferOffset > 0) {
            // Shift remaining data to start of buffer
            const remaining = this.buffer.slice(this.bufferOffset);
            this.buffer = new Uint8Array(remaining.length);
            this.buffer.set(remaining);
            this.bufferOffset = 0;
        }
    }

    private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }
}