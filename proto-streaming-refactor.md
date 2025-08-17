# Protocol Streaming Refactor

## Overview

Refactor the DomCorder protocol readers and writers to support streaming over WebSocket connections while maintaining file I/O compatibility.

**Scope**: Reader/writer implementations and unit tests only. WebSocket, HTTP, DOM detection, and playback logic are OUT OF SCOPE.

## Architecture

### Data Flow

1. **Browser Recorder** → WebSocket/POST → **Server** → File
2. **File** → **Server** → WebSocket/GET → **Browser Player**

### Key Design Decisions

- **Single Writer class** - Always streaming, no modes or configuration
- **All encode methods async** - Yield at frame boundaries minimum
- **Two encoding patterns**:
  - `encode()` - Writes entire frame, yields at boundary only
  - `encodeStreaming()` - Can yield during frame writing (DOM recursion)
- **Factory pattern** - `Writer.create()` returns `[writer, stream]` tuple
- **Explicit yield points** - `endFrame()` and `streamWait()`

## Current Implementation Status

The TypeScript Writer is now fully implemented with:

- Factory pattern `Writer.create()` returning `[writer, stream]` tuple
- Async frame encoders with `encode()` and `encodeStreaming()` variants
- Proper yield points via `endFrame()` and `streamWait()`
- String streaming for large strings via `strUtf8Streaming()`
- Full test coverage with binary compatibility verification

## Progress Update

### ✅ Completed (Phase 1 + Improvements)

1. **✅ Consolidated Writer class** - Single Writer with factory pattern `Writer.create()`
2. **✅ Yield methods** - `endFrame()` and `streamWait()` for proper streaming
3. **✅ String streaming** - `strUtf8Streaming()` for large strings with chunking
4. **✅ All frame encoders async** - Regular `encode()` and `encodeStreaming()` variants
5. **✅ DOM streaming** - `DomNode.encodeStreaming()` with yield points during recursion
6. **✅ Buffer optimization** - Replaced `number[]` with `Uint8Array` for better memory efficiency
7. **✅ Chunk size enforcement** - Auto-flush prevents chunks from exceeding `chunkSize`
8. **✅ Stream observer utility** - Eager background consumption with detailed chunk analysis
9. **✅ All tests modernized** - Replaced manual chunk reading boilerplate with stream observer
10. **✅ Deterministic behavior** - Confirmed consistent results across multiple test runs
11. **✅ Binary compatibility** - Generated output matches expected reference files
12. **✅ Clean codebase** - Removed old StreamingWriter and duplicate test files

### 🔄 Next Steps (Phase 2)

1. **Implement TypeScript Reader**

   **Design Decisions (Confirmed):**

   - ✅ Factory pattern matching Writer: `Reader.create(inputStream, expectHeader)`
   - ✅ Output raw `Frame` type from `protocol.ts`
   - ✅ Explicit header mode via factory parameter
   - ✅ Fail-fast error handling (throw on corruption)
   - ✅ No buffer size limits (trust input data)

   **API Design:**

   ```typescript
   // File mode (with 32-byte header)
   const [reader, frameStream] = Reader.create(byteStream, true);

   // Stream mode (no header)
   const [reader, frameStream] = Reader.create(byteStream, false);

   // Output: ReadableStream<Frame> where Frame matches protocol.ts exactly
   ```

   **Technical Requirements:**

   - Accept `ReadableStream<Uint8Array>` with arbitrary chunk boundaries
   - Output stream of complete `Frame` objects (no partial frames)
   - Buffer incomplete frames internally until fully received
   - Parse variable-length data correctly (strings, DOM nodes)
   - Frames are NOT length-prefixed (must parse to determine size)

   **Implementation Tasks:**

   - [ ] Core Reader class with factory pattern
   - [ ] Internal buffer management for partial frames
   - [ ] Frame type detection (u32) and routing to specific decoders
   - [ ] Decode all frame types to match `protocol.ts` types exactly
   - [ ] String decoding (u64 length + UTF-8 bytes)
   - [ ] DOM node recursive decoding with child counts
   - [ ] Header parsing when `expectHeader = true`
   - [ ] Throw immediately on malformed data or unexpected EOF

2. **Testing Strategy (Writer → Reader Focus)**
   - [ ] Round-trip tests: Writer output → Reader input
   - [ ] Various chunk sizes (1 byte to 64KB)
   - [ ] Memory validation: ensure frames are released after emission
   - [ ] Error handling: incomplete streams, corrupted data

## Implementation Decisions

1. **✅ Buffer Strategy**: Use `Uint8Array` with growth strategy for better memory efficiency
2. **✅ Stream Consumer Pattern**: Build array of `Uint8Array[]` (one per delivery) with drain/check functionality:
   ```typescript
   let check = streamObserve(stream); // or reader
   // do encoding work
   let chunks = check(); // drain accumulated chunks, analyze count/size
   // do more work
   let moreChunks = check(); // drain remaining chunks
   ```
3. **✅ Chunk Determinism**: Use `await check()` for deterministic testing when needed
4. **✅ Additional Coverage**: Add streamWait negative test (no flush when under threshold)

## Key Implementation Notes

- **Yielding**: Use `setTimeout(resolve, 0)` for now, can optimize later
- **Error handling**: Throw exceptions that close the stream
- **String streaming**: Only for strings larger than remaining buffer
- **Chunk size**: Constructor param with setter method, default 4KB
- **Frame boundaries**: Always explicit via `endFrame()`

## Reader Implementation Details

### Factory Pattern (Confirmed)

```typescript
export class Reader {
  static create(
    inputStream: ReadableStream<Uint8Array>,
    expectHeader: boolean
  ): [Reader, ReadableStream<Frame>] {
    // Returns tuple matching Writer pattern
    // Reader instance for control/header access
    // ReadableStream<Frame> for consuming frames
  }

  // Access header if it was parsed (expectHeader = true)
  getHeader(): { magic: Uint8Array; version: number; createdAt: bigint } | null;
}
```

### Frame Output (Confirmed)

- Output `Frame` type from `protocol.ts` exactly
- No higher-level conversions or DOM node reconstruction
- Frame types remain as numbers for efficiency
- Complete frames only - no partial emission

### Buffer Management (Confirmed)

- Internal `Uint8Array` buffer with dynamic growth
- No maximum buffer size limits
- Append incoming chunks, parse when data sufficient
- Shift consumed bytes after successful frame parse
- Throw immediately on unexpected EOF (incomplete frame at stream end)

### Error Handling (Confirmed)

- Fail fast: throw and close stream on any corruption
- No error recovery or frame skipping
- Malformed data = immediate exception
- Trust input data integrity

### Decoding Strategy

- Single-pass parsing (no pre-measurement)
- Route by frame type to specific decoders
- Each decoder consumes bytes and returns typed data
- String decoding: read u64 length, then UTF-8 bytes
- DOM recursion: read node type, attributes, child count, recurse
- All decoding eager (not lazy) - return fully parsed frames
