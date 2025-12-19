//! Simple buffer reader for decoding single frames from binary data

// BufferReader interface (matches proto-ts/src/frames.ts)
interface BufferReader {
  readU32(): number;
  readU64(): bigint;
  readString(): string;
  readBytes(length: number): Uint8Array;
  readByte(): number;
  peekU32(): number;
}

/**
 * Simple buffer reader that implements BufferReader interface
 * for decoding a single frame from a Uint8Array
 */
export class SimpleBufferReader implements BufferReader {
  private buffer: Uint8Array;
  private offset: number = 0;
  private static dec = new TextDecoder();

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
  }

  readU32(): number {
    if (this.offset + 4 > this.buffer.length) {
      throw new Error("Buffer underflow reading u32");
    }
    const value = 
      (this.buffer[this.offset] << 24) |
      (this.buffer[this.offset + 1] << 16) |
      (this.buffer[this.offset + 2] << 8) |
      this.buffer[this.offset + 3];
    this.offset += 4;
    return value >>> 0; // Convert to unsigned
  }

  readU64(): bigint {
    if (this.offset + 8 > this.buffer.length) {
      throw new Error("Buffer underflow reading u64");
    }
    const high = BigInt(this.readU32());
    const low = BigInt(this.readU32());
    return (high << 32n) | low;
  }

  readString(): string {
    const length = Number(this.readU64());
    if (this.offset + length > this.buffer.length) {
      throw new Error("Buffer underflow reading string");
    }
    const bytes = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return SimpleBufferReader.dec.decode(bytes);
  }

  readBytes(length: number): Uint8Array {
    if (this.offset + length > this.buffer.length) {
      throw new Error("Buffer underflow reading bytes");
    }
    const bytes = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readByte(): number {
    if (this.offset >= this.buffer.length) {
      throw new Error("Buffer underflow reading byte");
    }
    return this.buffer[this.offset++];
  }

  peekU32(): number {
    const savedOffset = this.offset;
    const value = this.readU32();
    this.offset = savedOffset;
    return value;
  }
}

