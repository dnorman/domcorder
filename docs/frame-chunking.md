# Frame Chunking Architecture

## Overview

Frame chunking is the mechanism by which DomCorder encodes and decodes frames in a streaming fashion, allowing for efficient transmission over WebSocket connections and file I/O operations. The system handles arbitrary chunk boundaries, ensuring that frames can be split across multiple network packets or file reads while maintaining correctness.

## Architecture Components

### TypeScript Side

The TypeScript implementation provides high-level wrappers around the core Writer/Reader protocol:

#### FrameChunkWriter

**Location**: `browser-core/src/recorder/FrameChunkWriter.ts`

The `FrameChunkWriter` class wraps the low-level `Writer` to provide a convenient interface for encoding frames and receiving chunks as they're produced.

**Key Features:**
- Accepts `Frame` objects via `write(frame)` method
- Automatically encodes frames using the `Writer`
- Reads chunks from the Writer's internal stream as they become available
- Passes chunks to a handler interface for processing (send over network, write to file, etc.)

**Usage Pattern:**
```typescript
const writer = new FrameChunkWriter({
  next: (chunk: Uint8Array) => {
    // Send chunk over WebSocket or write to file
  },
  error: (error: Error) => {
    // Handle encoding errors
  },
  done: () => {
    // Stream completed
  }
});

await writer.write(new Timestamp(BigInt(Date.now())));
await writer.write(new Keyframe(vDocument, width, height));
```

**Internal Flow:**
1. `FrameChunkWriter` creates a `Writer` instance (via factory or custom factory)
2. Writer encodes frames to an internal buffer
3. When buffer reaches chunk size or frame ends, Writer flushes to a `ReadableStream<Uint8Array>`
4. `FrameChunkWriter.start()` reads from this stream and calls `handler.next(chunk)`

#### FrameChunkReader

**Location**: `browser-core/src/player/FrameChunkReader.ts`

The `FrameChunkReader` class handles incoming byte chunks and reconstructs complete frames from them.

**Key Features:**
- Accepts arbitrary byte chunks via `read(chunk: Uint8Array)` method
- Buffers incomplete frames internally
- Parses complete frames using the `Reader` protocol
- Passes complete `Frame` objects to a handler interface

**Usage Pattern:**
```typescript
const reader = new FrameChunkReader({
  next: (frame: Frame) => {
    // Process complete frame (render, update state, etc.)
  },
  error: (error: Error) => {
    // Handle parsing errors
  },
  done: () => {
    // Stream completed
  }
});

await reader.whenReady();
reader.read(chunk1); // May be partial frame
reader.read(chunk2); // Completes frame, triggers handler.next()
```

**Internal Flow:**
1. `FrameChunkReader` creates a `ReadableStream<Uint8Array>` for incoming chunks
2. Reader instance consumes this stream and parses frames
3. Reader buffers incomplete data until full frames can be parsed
4. Complete frames are emitted to `handler.next(frame)`

### Core Protocol: Writer/Reader

The actual encoding/decoding is handled by the `Writer` and `Reader` classes, which implement the binary protocol.

#### TypeScript Writer

**Location**: `proto-ts/src/writer.ts`

The `Writer` class encodes frames into a binary format compatible with Rust's bincode serialization.

**Key Features:**
- **Chunk-based streaming**: Emits data in configurable chunk sizes (default 4KB for Writer, 512KB for FrameChunkWriter)
- **Auto-flush**: Automatically flushes buffer when it reaches chunk size
- **Frame boundaries**: `endFrame()` ensures frame boundaries are respected
- **Yield points**: `streamWait()` allows yielding during large frame encoding
- **Factory pattern**: `Writer.create(chunkSize)` returns `[Writer, ReadableStream<Uint8Array>]`

**Chunking Strategy:**
- Maintains an internal buffer (`Uint8Array`)
- When buffer reaches `chunkSize`, it flushes to the stream
- `endFrame()` always flushes, ensuring frame boundaries are visible to consumers
- Large data (strings, byte arrays) can span multiple chunks

**Example:**
```typescript
const [writer, stream] = Writer.create(512 * 1024); // 512KB chunks

// Stream consumer reads chunks as they're produced
const reader = stream.getReader();
const { value: chunk1 } = await reader.read(); // First chunk

// Encoding continues...
await frame.encode(writer); // May produce multiple chunks

// Frame boundaries are guaranteed at endFrame()
```

#### TypeScript Reader

**Location**: `proto-ts/src/reader.ts`

The `Reader` class parses incoming byte chunks and reconstructs complete frames.

**Key Features:**
- **Deterministic boundaries**: Uses frame length prefixes to avoid redundant parsing attempts
- **Internal buffering**: Maintains buffer of incomplete data
- **Efficient parsing**: Reads exactly the bytes needed for each frame
- **Header support**: Can parse optional 32-byte file header
- **Factory pattern**: `Reader.create(stream, expectHeader)` returns `[Reader, ReadableStream<Frame>]`

**Parsing Strategy:**
- Accumulates incoming chunks in an internal buffer
- When buffer has at least 4 bytes, reads the **frame length** (u32)
- Waits until buffer has `length` additional bytes
- Calls `Frame.decode()` to parse the complete frame once
- Removes consumed bytes from buffer after successful parse

**Frame Decoding:**
- Each frame type has a static `decode()` method
- Decoders read frame type (u32), then frame-specific data
- Variable-length data (strings, arrays) use length prefixes
- DOM nodes use recursive decoding with child counts

#### Rust Writer

**Location**: `proto-rs/src/writer.rs`

The Rust `FrameWriter` provides a simpler, synchronous interface for encoding frames.

**Key Features:**
- Writes directly to a `Write` trait (file, network socket, etc.)
- Uses bincode serialization with big-endian encoding
- Optional file header support (32-byte DCRR header)
- No explicit chunking - relies on underlying `Write` implementation

**Usage:**
```rust
let mut writer = FrameWriter::new(file);
writer.write_header(&FileHeader::new())?;
writer.write_frame(&frame)?;
writer.flush()?;
```

#### Rust Reader

**Location**: `proto-rs/src/reader.rs`

The Rust `FrameReader` implements async streaming frame parsing.

**Key Features:**
- Reads from `AsyncRead` trait (file, network stream, etc.)
- Buffers incomplete frames (4KB chunks)
- Uses frame length prefixes for O(n) parsing complexity
- Efficiently handles large frames (like Asset frames)

**Parsing Strategy:**
- Maintains internal buffer of accumulated data
- On each read, checks if at least 4 bytes (the length prefix) are available
- Peeks at the length, then waits until the entire frame data is buffered
- Deserializes exactly once using `bincode`
- Continues until stream ends or an error occurs

## Data Flow

### Recording (TypeScript → Network/File)

```
Browser Event → Frame Object
    ↓
FrameChunkWriter.write(frame)
    ↓
Writer.encode(frame) → Internal Buffer
    ↓ (when chunk size reached or endFrame())
ReadableStream<Uint8Array> emits chunk
    ↓
FrameChunkWriter.start() reads chunk
    ↓
handler.next(chunk) → WebSocket/File
```

### Playback (Network/File → TypeScript)

```
WebSocket/File → byte chunks
    ↓
FrameChunkReader.read(chunk)
    ↓
ReadableStream<Uint8Array> → Reader
    ↓
Reader buffers chunks, attempts Frame.decode()
    ↓ (when complete frame parsed)
ReadableStream<Frame> emits frame
    ↓
FrameChunkReader.start() reads frame
    ↓
handler.next(frame) → Render/State Update
```

## Chunking Details

### Why Chunking?

1. **Memory efficiency**: Large frames (like Asset frames with images) don't need to be fully buffered in memory
2. **Streaming**: Allows sending data over WebSocket as it's being encoded
3. **Responsiveness**: Smaller chunks allow for better interleaving with other operations

### Chunk Size Considerations

- **Defaults**: 
  - `Writer.create()`: 4KB
  - `FrameChunkWriter`: 512KB (overrides Writer default for better network efficiency)
- **Trade-offs**:
  - Smaller chunks: More overhead, better streaming granularity
  - Larger chunks: Less overhead, but larger memory footprint
- **Frame boundaries**: Always respected - `endFrame()` flushes regardless of buffer size

### Frame Boundary Handling

Frames can span multiple chunks, but the protocol ensures:

1. **Writer side**: `endFrame()` always flushes, making frame boundaries visible
2. **Reader side**: Frames are buffered until complete before parsing
3. **No partial frames**: Readers never emit incomplete frames

### Example: Large Asset Frame

```
Asset Frame (2MB image):
  [Frame Type: 4 bytes] [Asset ID: 4 bytes] [URL: variable] [MIME: variable] [Data: 2MB]

Chunking:
  Chunk 1: [Frame Type][Asset ID][URL...] (512KB)
  Chunk 2: [...URL...][MIME...][Data...] (512KB)
  Chunk 3: [...Data...] (512KB)
  Chunk 4: [...Data...] (512KB)
  Chunk 5: [...Data...] (remaining bytes)

Reader buffers all chunks, then parses complete frame.
```

## Protocol Format

### Binary Encoding

- **Format**: bincode (Rust serialization format)
- **Endianness**: Big-endian
- **Frame structure**: Length-prefixed
  1. Frame length (u32, big-endian) - *Total bytes in the frame, excluding this prefix*
  2. Frame data (variable length)
- **Frame type**: u32 (first 4 bytes of frame data)

### Frame Encoding Pattern

All frames follow this pattern:
1. Frame length (u32, big-endian)
2. Frame type (u32, big-endian)
3. Frame-specific data (variable length)
4. Frame boundary (implied by `endFrame()` call and length prefix)

### String Encoding

Strings are encoded as:
1. Length prefix (u64, big-endian)
2. UTF-8 bytes (variable length)

### Array Encoding

Arrays/vectors are encoded as:
1. Length prefix (u64, big-endian)
2. Elements (variable length, depends on element type)

## Error Handling

### Writer Errors

- Encoding errors: Thrown synchronously during `write()`
- Stream errors: Propagated to `handler.error()`

### Reader Errors

- Parsing errors: Thrown when data is malformed
- Incomplete data: Buffer until complete (no error)
- Unexpected EOF: Error if stream ends mid-frame

### Error Recovery

- **No recovery**: Errors are fatal, stream is closed
- **Fail-fast**: Invalid data causes immediate error
- **No frame skipping**: Must process frames in order

## Testing

The protocol includes comprehensive tests:
- Round-trip tests: Writer → Reader with various chunk sizes
- Fragmentation tests: Extreme cases (1-byte chunks)
- Error handling: Incomplete streams, corrupted data
- Binary compatibility: TypeScript ↔ Rust

## Related Files

- `proto-ts/src/writer.ts` - TypeScript Writer implementation
- `proto-ts/src/reader.ts` - TypeScript Reader implementation
- `proto-ts/src/frames.ts` - Frame type definitions and encoding
- `proto-rs/src/writer.rs` - Rust Writer implementation
- `proto-rs/src/reader.rs` - Rust Reader implementation
- `browser-core/src/recorder/FrameChunkWriter.ts` - High-level Writer wrapper
- `browser-core/src/player/FrameChunkReader.ts` - High-level Reader wrapper

