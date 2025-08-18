# Domcorder Roadmap

## Project Goals

Create an "HTML video" capture & playback system that records webpage state over time, using keyframes and delta frames, with input event recording.

## Current Architecture (2025-08-18)

### Components

1. **recorder-player/** - Core recording & playback library with PageRecorder/PagePlayer
2. **proto-ts/** - TypeScript binary protocol implementation (✅ COMPLETE - reader/writer working)
3. **proto-rs/** - Rust binary protocol implementation (✅ COMPLETE - reader/writer working)
   - FrameReader/FrameWriter for .dcrr format
   - Supports both file mode (with header) and stream mode
   - Frame enum values 0-15 (no Asset frame yet)
   - Uses bincode serialization with serde
4. **demo-app/** - Demo with bookmarklet and server (needs integration)
5. **server/** - New Rust server (empty, needs implementation)

### Integration Plan

#### Phase 1: Implement Rust Server (IMMEDIATE PRIORITY)

Using Axum framework:

1. [ ] POST route to receive frame stream
   - Parse frames using proto-rs Reader to validate
   - Write validated frames to file with DCRR header using Writer
   - Store in timestamped files in storage folder
2. [ ] GET route to list recordings (JSON response)
3. [ ] GET route to stream file back (without header)
   - Stream raw file bytes minus the 32-byte header
   - No frame parsing needed, just byte streaming

#### Phase 2: Protocol Unification

1. [ ] **DISCUSSION NEEDED**: Strategy for unifying recorder-player, proto-ts, and proto-rs protocols
   - Align FrameType enums (recorder-player 0-16 vs proto-ts/proto-rs 0-15)
   - Add Asset frame type to proto-ts and proto-rs protocols
   - Standardize node ID types (number vs string vs bigint)
   - Ensure bincode compatibility between TypeScript and Rust
2. [ ] Implement protocol changes in all three packages
3. [ ] Update tests for new unified protocol
4. [ ] Verify cross-language compatibility (TS writer → Rust reader, etc.)

#### Phase 3: Integration Tasks

1. [ ] Create async/sync bridge for PageRecorder → Writer pipeline
   - PageRecorder emits sync, Writer needs async
   - Implement queue/buffer mechanism
2. [ ] **DISCUSSION NEEDED**: DOM format strategy
   - Option A: Convert recorder-player format to DOM for proto-ts
   - Option B: Modify proto-ts to accept recorder-player format directly
3. [ ] Wire up PageRecorder with binary streaming
   - Modify bookmarklet to use PageRecorder
   - Connect FrameHandler to proto-ts Writer
   - Use HTTP streaming (fetch with ReadableStream body)

#### Phase 4: Player Integration

1. [ ] Add player UI to demo-app homepage
2. [ ] Use proto-ts Reader to parse binary stream from server
3. [ ] Feed parsed Frames to PagePlayer for playback
4. [ ] Display recordings list with click-to-play

### Key Technical Decisions

#### Decided

- **Transport**: HTTP streaming using fetch with ReadableStream body (not WebSocket)
- **Protocol Strategy**: Unify protocols rather than mapping layer
- **Asset Handling**: Will add Asset frame type when unifying protocols (separate frame)
- **Header Mode**: Use header for stored files, stream mode for live transmission

#### Needs Discussion (Action Items in Phase 2 & 3)

1. **Protocol Unification Strategy**:

   - How to align FrameType enums (recorder-player 0-16 vs proto-ts 0-15)
   - Add Asset frame type to proto-ts
   - Standardize node ID types (number vs string vs bigint)

2. **DOM Format Strategy**:
   - Option A: Convert recorder-player format to DOM for proto-ts
   - Option B: Modify proto-ts to accept recorder-player format

#### Implementation Notes

- **Chunking**: Use Writer default 4096 bytes, configurable as needed
- **Streaming Encode**: Use for large frames (keyframes), regular for small frames

## Active Development Tasks

### Immediate Priority - Rust Server Implementation

Using Axum framework:

- [ ] Set up basic Axum server with dependencies
- [ ] POST `/record` - receive and validate frame stream
  - Use proto-rs Reader to parse incoming frames
  - Write validated frames with DCRR header using Writer
  - Store as timestamped files in storage folder
- [ ] GET `/recordings` - list available recordings (JSON)
- [ ] GET `/recording/:id` - stream file without header
  - Skip first 32 bytes (DCRR header)
  - Stream raw bytes (no parsing needed)

### Player Integration

- [ ] Add player UI to demo-app
- [ ] Wire proto-ts Reader to server stream
- [ ] Connect Reader output to PagePlayer
- [ ] Add recording list/selection UI

### Recording Improvements

- [ ] Canvas change detection (monkey-patching)
- [ ] Scroll offset tracking for scrollable elements
- [ ] StyleSheet change tracking (already has watcher)
- [ ] Input event recording (mouse, keyboard, scroll)
- [ ] Viewport resize events

### Delta Frame Support

- [ ] Map recorder-player DOM operations to proto-ts frame types
- [ ] Test incremental DOM updates
- [ ] Optimize mutation batching

### Asset Management

- [ ] Asset deduplication strategy
- [ ] Resource frame implementation
- [ ] Inline vs reference decision logic

## Future Enhancements

### Performance

- [ ] WebWorker for encoding (avoid main thread blocking)
- [ ] Memory profiling for long recordings
- [ ] Streaming playback for large files
- [ ] Configurable quality settings (keyframe interval)

### Reliability

- [ ] Network failure recovery
- [ ] Partial recording handling
- [ ] Resume interrupted recordings

### Advanced Features

- [ ] Page navigation handling (SPA support)
- [ ] Multi-tab recording
- [ ] Recording metadata and cataloging
- [ ] Search and filtering for recordings

## Testing Requirements

- [ ] Unit tests for integration points
- [ ] E2E test with real web pages
- [ ] Performance benchmarks
- [ ] Cross-browser validation

## Documentation Needed

- [ ] Integration guide for recorder-player + proto-ts
- [ ] Rust server API documentation
- [ ] Player usage guide
- [ ] Architecture decision record
