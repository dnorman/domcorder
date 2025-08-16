// File format constants
export const DCRR_MAGIC = new Uint8Array([0x44, 0x43, 0x52, 0x52]); // "DCRR"
export const DCRR_VERSION = 1;
export const HEADER_SIZE = 32;

export class Writer {
    private buf: number[] = [];
    private debug: boolean = false;
    private frameCount: number = 0;
    
    enableDebug() {
        this.debug = true;
        return this;
    }
    
    private byte(n: number) { 
        this.buf.push(n & 0xff); 
        if (this.debug) {
            console.log(`  byte: 0x${(n & 0xff).toString(16).padStart(2, '0')}`);
        }
    }

    u32(n: number) {
        if (this.debug) console.log(`u32: ${n} (0x${n.toString(16)})`);
        // caller ensures 0 <= n < 2**32
        this.byte(n >>> 24); this.byte(n >>> 16); this.byte(n >>> 8); this.byte(n);
    }

    u64(n: bigint) {
        if (this.debug) console.log(`u64: ${n} (0x${n.toString(16)})`);
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
        if (this.debug) console.log(`strUtf8: "${s}" (${s.length} chars)`);
        const bytes = Writer.enc.encode(s);
        this.u64(BigInt(bytes.length));
        this.bytes(bytes);
    }

    /** Write Vec<u8>-like: u64 length (BE) + raw bytes. */
    bytesPrefixed(b: Uint8Array) {
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

}