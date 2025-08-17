# Protocol Streaming Refactor

## Overview

Refactor the DomCorder protocol readers and writers to support streaming over WebSocket connections while maintaining file I/O compatibility.

**Scope**: This refactor focuses ONLY on the reader/writer implementations and their unit tests. The following are OUT OF SCOPE:

- WebSocket implementation
- HTTP POST/GET implementation
- Browser recorder logic (DOM change detection)
- Browser player logic (iframe manipulation)
- Server business logic (validation/filtering)

## Architecture

### Data Flow

1. **Browser Recorder** → WebSocket OR POST → **Server** → File
2. **File** → **Server** → WebSocket OR GET → **Browser Player**

### Key Components

#### Browser Recorder (TypeScript Writer)

- Some frames recursively encode DOM trees
- Streams bytes as generated. Whole-frames are buffered only for synchronous encode methods. Async methods stream as they generate
- Not all encode methods require an async version (only those with recursive/large data)
- Outputs `ReadableStream<Uint8Array>`
- WebSocket OR POST layer handles chunking for transport

#### Server (Rust)

- Receives `Stream<Item = Bytes>` from WebSocket (arbitrary chunk boundaries)
- `FrameReader` reassembles byte stream into Frames
- Validates/filters frames
- `FrameWriter` writes complete frames to disk

#### Browser Player (TypeScript Reader)

- Receives `ReadableStream<Uint8Array>` from server
- Reassembles byte stream into frames
- Applies frames to iframe for playback

## Implementation Plan

### Phase 1: TypeScript Writer Refactor

#### 1.1 Dual Encode Functions

Create async versions ONLY for frames with recursive/large data:

**Frames needing async versions:**

- [ ] `KeyframeDataEnc` - recursively encodes DOM trees
- [ ] `DomNodeAddedDataEnc` - includes DomNode which can be recursive

**Frames keeping sync-only:**

- [ ] `TimestampDataEnc` - simple u64
- [ ] `ViewportResizedDataEnc` - two u32s
- [ ] `ScrollOffsetChangedDataEnc` - two u32s
- [ ] `MouseMovedDataEnc` - two u32s
- [ ] `MouseClickedDataEnc` - two u32s
- [ ] `KeyPressedDataEnc` - single string
- [ ] `ElementFocusedDataEnc` - single u64
- [ ] `DomTextChangedDataEnc` - u64 + string
- [ ] `DomAttributeChangedDataEnc` - u64 + two strings

Example:

```typescript
// Sync - buffers entire frame
KeyframeDataEnc.encode(writer: Writer, document: Document): void

// Async - streams during DOM recursion
KeyframeDataEnc.encodeAsync(writer: StreamingWriter, document: Document): Promise<void>
```

#### 1.2 StreamingWriter Class

**Implementation checklist:**

- [ ] Create `StreamingWriter` class that extends/wraps `Writer`
- [ ] Implement `getReadableStream(): ReadableStream<Uint8Array>`
- [ ] Add `flush()` method to push current buffer as chunk
- [ ] Add `setChunkSize(bytes: number)` for configuring auto-flush threshold
- [ ] Optional `frameAligned` flag to buffer until frame complete
- [ ] Implement auto-flush when buffer reaches chunk size

**Key details:**

```typescript
class StreamingWriter {
  private controller?: ReadableStreamDefaultController<Uint8Array>;
  private buffer: number[] = [];
  private chunkSize: number = 4096; // Default 4KB chunks
  private frameAligned: boolean = false;

  getReadableStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }

  // Flush current buffer as chunk
  flush(): void {
    if (this.buffer.length > 0) {
      this.controller?.enqueue(new Uint8Array(this.buffer));
      this.buffer = [];
    }
  }
}
```

### Phase 2: TypeScript Reader Implementation

#### 2.1 Reader Class

**Implementation checklist:**

- [ ] Create `Reader` class with mode flag (file vs stream)
- [ ] Implement `readHeader()` for file mode
- [ ] Maintain internal buffer for accumulating partial frames
- [ ] Implement async iterator: `async *readFrames(): AsyncIterator<Frame>`
- [ ] Handle frames split across chunks
- [ ] Implement backpressure via `ReadableStreamDefaultReader`

**Backpressure interface mockup:**

```typescript
class Reader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer: Uint8Array = new Uint8Array(0);
  private isFileMode: boolean;

  constructor(stream: ReadableStream<Uint8Array>, isFileMode: boolean = false) {
    this.reader = stream.getReader();
    this.isFileMode = isFileMode;
  }

  async *readFrames(): AsyncIterator<Frame> {
    // Backpressure is automatic - we only read from stream when needed
    while (true) {
      // Read chunk only when we need more data
      const { done, value } = await this.reader.read();
      if (done) break;

      // Append to buffer and try to parse frames
      this.buffer = this.appendBuffers(this.buffer, value);

      // Parse complete frames from buffer
      while (this.hasCompleteFrame()) {
        yield this.parseNextFrame();
      }
    }
  }

  // Caller controls pace by how fast they consume frames
  async processFrames() {
    for await (const frame of this.readFrames()) {
      // Natural backpressure - next chunk won't be read until this frame is processed
      await this.handleFrame(frame);
    }
  }
}
```

#### 2.2 Frame Parsing

**Implementation checklist:**

- [ ] Implement `peekFrameType(): number` to read variant index
- [ ] Implement `peekFrameSize(): number` for buffer management
- [ ] Parse each frame type according to protocol spec
- [ ] Handle variable-length frames (Keyframe, DomNodeAdded)
- [ ] Validate frame structure and fail stream on corruption
- [ ] Efficient buffer management (avoid excessive copying)

### Phase 3: Rust Reader Refactor

#### 3.1 Async Stream Support

**Implementation checklist:**

- [ ] Create `StreamingFrameReader` that accepts `Stream<Item = Bytes>`
- [ ] Implement `Stream<Item = Frame>` output
- [ ] Handle frames split across chunks
- [ ] Support both file mode (with header) and stream mode
- [ ] Leverage bincode's `deserialize_from` for streaming

**Key implementation:**

```rust
use futures::{Stream, StreamExt};
use bytes::{Bytes, BytesMut};

pub struct StreamingFrameReader<S> {
    input: S,
    buffer: BytesMut,
    file_mode: bool,
    header_read: bool,
}

impl<S> StreamingFrameReader<S>
where
    S: Stream<Item = Bytes> + Unpin
{
    pub async fn read_frames(mut self) -> impl Stream<Item = Result<Frame, Error>> {
        // Return a stream that yields frames as they're parsed
        async_stream::stream! {
            while let Some(chunk) = self.input.next().await {
                self.buffer.extend_from_slice(&chunk);

                // Parse complete frames from buffer
                while let Some(frame) = self.try_parse_frame()? {
                    yield Ok(frame);
                }
            }
        }
    }
}
```

#### 3.2 Buffer Management

**Implementation checklist:**

- [ ] Use `bytes::BytesMut` for efficient buffer management
- [ ] Implement dynamic buffer growth for large frames
- [ ] Minimize memory copies when parsing
- [ ] Clear consumed bytes from buffer after parsing

### Phase 4: Rust Writer Refactor

#### 4.1 Stream Output

**Implementation checklist:**

- [ ] Keep current `Write` trait implementation for sync file I/O
- [ ] Add `AsyncWrite` support for async file I/O
- [ ] Ensure frames are written atomically
- [ ] No changes to frame encoding (bincode handles it)

**Note:** The current implementation is already suitable for streaming - it writes frames immediately without internal buffering.

### Phase 5: Testing

#### 5.1 Round-trip Tests

**Test matrix checklist:**

- [ ] TS Writer (sync) → TS Reader
- [ ] TS Writer (async) → TS Reader
- [ ] TS Writer (sync) → Rust Reader
- [ ] TS Writer (async) → Rust Reader
- [ ] Rust Writer → TS Reader
- [ ] Rust Writer → Rust Reader

**Test implementation:**

- [ ] Create shared test frames in both TS and Rust
- [ ] Write frames to in-memory buffers
- [ ] Read back and compare frame equality
- [ ] Test both file mode (with header) and stream mode

#### 5.2 Streaming Tests

**Chunking test checklist:**

- [ ] Test with 512B chunks (smaller than most frames)
- [ ] Test with 1KB chunks (may split frames)
- [ ] Test with 4KB chunks (larger than most frames)
- [ ] Test with 1-byte chunks (stress test)
- [ ] Test frames split at various boundaries

**Large frame tests:**

- [ ] Generate Keyframe with 1000+ DOM nodes
- [ ] Test streaming during DOM recursion
- [ ] Verify memory usage stays bounded
- [ ] Test async writer doesn't buffer entire frame

#### 5.3 File I/O Tests

**File format checklist:**

- [ ] Test .dcrr file with header + frames
- [ ] Test raw frame stream without header
- [ ] Verify reader correctly detects file vs stream mode
- [ ] Test header validation and error handling
- [ ] Ensure backward compatibility with existing .dcrr files

**Note:** The reader must detect mode by attempting to read header - if magic bytes match, it's file mode.

## Success Criteria

1. **No Whole-Frame Buffering Required**: Browser can start sending bytes before DOM recursion completes ✓
2. **Chunk-Agnostic**: Readers handle arbitrary chunk boundaries ✓
3. **Cross-Language Compatibility**: All reader/writer combinations work ✓
4. **Performance**: Minimal memory usage during streaming ✓
5. **File Compatibility**: Existing .dcrr file format unchanged ✓

## Technical Analysis

### Frame Size Information

The protocol does NOT include total frame size upfront. Each frame starts with:

1. `u32` variant index (frame type)
2. Frame-specific data with embedded lengths:
   - Strings: `u64` length prefix + UTF-8 bytes
   - Vectors: `u64` count + elements
   - Fixed-size types: Direct encoding

This means the TypeScript Reader must parse incrementally, checking buffer sufficiency at each step.

### Async Encoding Approaches

**Option 1: Async Generators**

```typescript
async *encodeAsync(writer: StreamingWriter, doc: Document) {
  writer.u32(FrameType.Keyframe);
  writer.strUtf8(doctype);
  yield writer.flushIfNeeded(); // Returns Uint8Array if buffer > threshold

  for (const child of doc.children) {
    yield* this.encodeNodeAsync(writer, child);
  }
}
```

**Pros:** Clean syntax, natural composition, built-in iteration protocol
**Cons:** Requires consumer to iterate, may be less familiar to some developers

**Option 2: Direct ReadableStream**

```typescript
encodeAsync(doc: Document): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const writer = new StreamingWriter(controller);
      writer.u32(FrameType.Keyframe);
      // ... encoding logic with controller.enqueue()
    }
  });
}
```

**Pros:** Direct stream API, familiar browser pattern
**Cons:** More boilerplate, harder to compose

**Recommendation:** Use async generators internally with a ReadableStream wrapper for flexibility.

### Parser Strategy for TypeScript Reader

Given no upfront frame size, two approaches:

**Option 1: Incremental Parsing (Recommended)**

- Check buffer size before each read operation
- Return "need more data" when insufficient
- Resume parsing from saved state

**Option 2: Try-Parse with Retry**

- Attempt full parse, catch buffer underrun
- Save position and wait for more data
- Retry when new chunk arrives

**Recommendation:** Incremental parsing for predictability and better error messages.

## Resolved Questions

1. **Async encode approach**: Use async generators internally with ReadableStream wrapper
2. **Default chunk size**: 4KB (typical network/file I/O size)
3. **Backpressure handling**: Natural backpressure via async iteration (see mockup in Phase 2)
4. **Corrupted streams**: Fail the entire stream on corruption
5. **Frame size**: No upfront size - must parse incrementally
6. **Parser strategy**: Incremental parsing with state tracking

## Testing Priority

1. **Phase 1: Synchronous Round-trip**

   - [ ] TS Writer (sync) → memory buffer → TS Reader
   - [ ] Verify frame equality
   - [ ] Test with sample frames from existing tests

2. **Phase 2: Async Writer Round-trip**

   - [ ] TS Writer (async) → memory buffer → TS Reader
   - [ ] Verify streaming doesn't buffer entire frame
   - [ ] Test memory usage stays bounded

3. **Phase 3: Chunked Streaming**
   - [ ] Test with various chunk sizes
   - [ ] Verify frames split across chunks work correctly
   - [ ] Test edge cases (chunk boundaries at critical points)

## Next Steps

1. ✅ Review and finalize this plan
2. Start with TypeScript Writer refactor (Phase 1)
   - [ ] Implement StreamingWriter class
   - [ ] Add async encode methods for Keyframe and DomNodeAdded
   - [ ] Write synchronous round-trip test
3. Implement TypeScript Reader (Phase 2)
   - [ ] Implement Reader class with incremental parsing
   - [ ] Add frame parsing logic with state tracking
   - [ ] Write async round-trip test
4. Update Rust implementation (Phases 3-4)
   - [ ] Add StreamingFrameReader
   - [ ] Update tests for async streaming
5. Comprehensive testing (Phase 5)
   - [ ] Cross-language round-trip tests
   - [ ] Chunking stress tests
   - [ ] File I/O compatibility tests
