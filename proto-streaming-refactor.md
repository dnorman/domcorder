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

   - [ ] Incremental parsing for chunked streams
   - [ ] Handle frames split across arbitrary chunk boundaries
   - [ ] Support both file mode (header) and stream mode

2. **Enhanced Testing with Stream Observer**
   - [ ] Round-trip tests using stream observer for realistic chunk analysis
   - [ ] Memory usage validation during large frame streaming
   - [ ] Chunk boundary verification for streaming frames

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
