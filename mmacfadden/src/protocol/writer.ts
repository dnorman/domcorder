export class Writer {
    private buf: number[] = [];
    private byte(n: number) { this.buf.push(n & 0xff); }

    u32(n: number) {
        // caller ensures 0 <= n < 2**32
        this.byte(n >>> 24); this.byte(n >>> 16); this.byte(n >>> 8); this.byte(n);
    }

    u64(n: bigint) {
        // caller ensures 0n <= n < 2n**64n
        for (let i = 7; i >= 0; i--) this.byte(Number((n >> (BigInt(8 * i))) & 0xffn));
    }

    bytes(b: Uint8Array) { for (const x of b) this.buf.push(x); }
    append(b: Uint8Array) { this.bytes(b); }
    finish(): Uint8Array { return new Uint8Array(this.buf); }

    // bincode-compatible helpers
    private static enc = new TextEncoder();

    /** Write UTF-8 string as: u64 length (BE) + bytes (bincode style). */
    strUtf8(s: string) {
        const bytes = Writer.enc.encode(s);
        this.u64(BigInt(bytes.length));
        this.bytes(bytes);
    }

    /** Write Vec<u8>-like: u64 length (BE) + raw bytes. */
    bytesPrefixed(b: Uint8Array) {
        this.u64(BigInt(b.length));
        this.bytes(b);
    }

}

const toU64 = (v: number | bigint) => (typeof v === "bigint" ? v : BigInt(v));