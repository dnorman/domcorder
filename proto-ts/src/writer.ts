// File format constants
export const DCRR_MAGIC = new Uint8Array([0x44, 0x43, 0x52, 0x52]); // "DCRR"
export const DCRR_VERSION = 1;
export const HEADER_SIZE = 32;

export class Writer {
    private buf: Uint8Array;
    private bufLength: number = 0;
    private debug: boolean = false;
    private chunkSize: number;
    private controller: ReadableStreamDefaultController<Uint8Array>;
    private stream: ReadableStream<Uint8Array>;

    private static enc = new TextEncoder();

    private constructor(chunkSize: number = 4096) {
        this.chunkSize = chunkSize;
        this.buf = new Uint8Array(Math.max(chunkSize, 1024)); // Initial size, will grow as needed
        this.stream = new ReadableStream({
            start: (controller) => {
                this.controller = controller;
            },
        });
    }

    /** 
     * Factory method that returns [writer, stream] tuple 
     * @param chunkSize Maximum size of chunks sent to stream (buffer auto-flushes to prevent overflow)
     */
    static create(chunkSize: number = 4096): [Writer, ReadableStream<Uint8Array>] {
        const writer = new Writer(chunkSize);
        return [writer, writer.stream];
    }

    enableDebug(): Writer {
        this.debug = true;
        return this;
    }

    private byte(n: number): void {
        // Ensure buffer has space
        if (this.bufLength >= this.buf.length) {
            this.growBuffer();
        }

        this.buf[this.bufLength] = n & 0xff;
        this.bufLength++;

        if (this.debug) {
            console.log(`  byte: 0x${(n & 0xff).toString(16).padStart(2, '0')}`);
        }

        // Auto-flush if buffer reaches chunk size (prevents buffer overflow)
        if (this.bufLength >= this.chunkSize) {
            this.flush();
        }
    }

    private growBuffer(): void {
        const newSize = this.buf.length * 2;
        const newBuf = new Uint8Array(newSize);
        newBuf.set(this.buf, 0);
        this.buf = newBuf;
    }

    u32(n: number): void {
        if (this.debug) console.log(`u32: ${n} (0x${n.toString(16)})`);
        // caller ensures 0 <= n < 2**32
        this.byte(n >>> 24); this.byte(n >>> 16); this.byte(n >>> 8); this.byte(n);
    }

    u64(n: bigint): void {
        if (this.debug) console.log(`u64: ${n} (0x${n.toString(16)})`);
        // caller ensures 0n <= n < 2n**64n
        for (let i = 7; i >= 0; i--) this.byte(Number((n >> (BigInt(8 * i))) & 0xffn));
    }

    bytes(b: Uint8Array): void {
        let offset = 0;

        while (offset < b.length) {
            // Calculate how much we can write without exceeding chunk size
            const remainingChunk = this.chunkSize - this.bufLength;
            const remainingData = b.length - offset;
            const writeSize = Math.min(remainingChunk, remainingData);

            // Ensure buffer has space
            while (this.bufLength + writeSize > this.buf.length) {
                this.growBuffer();
            }

            // Write the chunk
            this.buf.set(b.subarray(offset, offset + writeSize), this.bufLength);
            this.bufLength += writeSize;
            offset += writeSize;

            // Auto-flush if we've reached chunk size
            if (this.bufLength >= this.chunkSize) {
                this.flush();
            }
        }
    }

    append(b: Uint8Array): void {
        this.bytes(b);
    }

    /** Write UTF-8 string as: u64 length (BE) + bytes (bincode style). */
    strUtf8(s: string): void {
        if (this.debug) console.log(`strUtf8: "${s}" (${s.length} chars)`);
        const bytes = Writer.enc.encode(s);
        this.u64(BigInt(bytes.length));
        this.bytes(bytes);
    }

    /** Write UTF-8 string with streaming for large strings */
    async strUtf8Streaming(s: string): Promise<void> {
        if (this.debug) console.log(`strUtf8Streaming: "${s}" (${s.length} chars)`);
        const bytes = Writer.enc.encode(s);

        // Write length prefix
        this.u64(BigInt(bytes.length));

        // If string is larger than remaining buffer space, write in chunks
        const remainingBuffer = this.chunkSize - this.bufLength;
        if (bytes.length > remainingBuffer && remainingBuffer > 0) {
            // Write what fits in current buffer
            const firstChunk = bytes.slice(0, remainingBuffer);
            this.bytes(firstChunk);
            await this.streamWait(); // This will flush

            // Write remaining bytes in chunks
            let offset = remainingBuffer;
            while (offset < bytes.length) {
                const chunkEnd = Math.min(offset + this.chunkSize, bytes.length);
                const chunk = bytes.slice(offset, chunkEnd);
                this.bytes(chunk);
                offset = chunkEnd;

                if (offset < bytes.length) {
                    await this.streamWait();
                }
            }
        } else {
            // String fits in current buffer
            this.bytes(bytes);
        }
    }

    /** Write Vec<u8>-like: u64 length (BE) + raw bytes. */
    bytesPrefixed(b: Uint8Array): void {
        this.u64(BigInt(b.length));
        this.bytes(b);
    }

    /** Write .dcrr file header (32 bytes): magic + version + timestamp + reserved */
    writeHeader(createdAt?: bigint): void {
        // Magic bytes (4 bytes): "DCRR"
        this.bytes(DCRR_MAGIC);

        // Version (4 bytes): currently 1
        this.u32(DCRR_VERSION);

        // Created timestamp (8 bytes): Unix milliseconds
        const timestamp = createdAt ?? BigInt(Date.now());
        this.u64(timestamp);

        // Reserved (16 bytes): zeros for future use
        for (let i = 0; i < 16; i++) {
            this.byte(0);
        }
    }

    /** 
     * Called at the end of every frame encode method
     * Always flushes buffer and yields control - this is when chunks become visible to stream consumers
     */
    async endFrame(): Promise<void> {
        this.flush();
        // Yield control to allow stream processing
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    /** 
     * Called by streaming encoders during recursion
     * Flushes buffer if it has reached chunk size and yields control
     * This is when chunks become visible to stream consumers
     */
    async streamWait(): Promise<void> {
        if (this.bufLength >= this.chunkSize) {
            this.flush();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }

    /** 
     * Set maximum chunk size for auto-flush
     * @param bytes Maximum size of chunks sent to stream (buffer auto-flushes to prevent overflow)
     */
    setChunkSize(bytes: number): void {
        this.chunkSize = bytes;
    }

    /** Get current buffer size */
    getBufferSize(): number {
        return this.bufLength;
    }

    /** Flush current buffer as chunk to stream */
    flush(): void {
        if (this.bufLength > 0) {
            const chunk = this.buf.slice(0, this.bufLength);
            this.controller.enqueue(chunk);
            this.bufLength = 0; // Reset buffer length
        }
    }

    /** Close the stream (flushes remaining data) */
    close(): void {
        this.flush();
        this.controller.close();
    }

    /** Legacy method for testing - returns current buffer */
    finish(): Uint8Array {
        return this.buf.slice(0, this.bufLength);
    }
}