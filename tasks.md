# Domcorder Roadmap

## Current Status

**Works**

- `captureKeyframe()` produces a self-contained HTML snapshot ("keyframe") of the current page
  - Handles stylesheets, fonts, images, canvases, and SVG
  - Snapshot can be injected into an `iframe` for faithful static rendering

**Partially-working / Untested**

- `startRecording()` sets up a `MutationObserver` but delta-encoding logic is stubbed and unverified
- No server-side collector or player exists yet

**Technical Debt & Unknowns**

- `startRecording()` mutation observer logic needs implementation and testing

---

## Project Goals

Create an "HTML video" capture & playback system that records webpage state over time, using keyframes and delta frames, with input event recording.

---

## Phase 1 - File Format & Still Image Capture

### Design `.dcrr` Binary Format

- [ ] Research existing container formats (WebM, MP4) for inspiration
- [ ] Design seekable binary container format that supports:
  - File header with magic bytes, version, metadata
  - Frame size metadata (variable during recording)
  - Keyframes (full HTML snapshots)
  - Delta frames (DOM mutations)
  - Input events (keyboard/mouse) with timecodes
  - Misc events with timecodes
  - Frame index for seeking
- [ ] Document format spec in `docs/file_format.md`
- [ ] Create TypeScript types for format structures
- [ ] Build basic reader/writer utilities

### Basic Still Image Pipeline

- [ ] Set up minimal HTTP server (Bun) with CORS handling
- [ ] Create simple server endpoint to receive and save captures
- [ ] Generate bookmarklet from TypeScript source
- [ ] Test bookmarklet injection + immediate `captureKeyframe` call
- [ ] Basic player page that loads a `.dcrr` file and displays in iframe

## Phase 2 - Basic Video Recording

### Slow Keyframe Recording (≈1 fps)

- [ ] Design WebSocket binary message protocol for recording streams
- [ ] Extend server to handle WebSocket connections and live writing to `.dcrr`
- [ ] Update bookmarklet for continuous recording mode
- [ ] Test `startRecording` with periodic keyframe capture
- [ ] Handle recording session lifecycle (start/stop/pause)

### Player Timeline

- [ ] Add basic timeline/scrubber to player
- [ ] Implement frame seeking using file index
- [ ] Test playback of multi-keyframe recordings
- [ ] Add playback controls (play/pause/speed)

## Phase 3 - Delta Frames & Input

### Delta Frame Implementation

- [ ] Research efficient DOM mutation encoding approaches:
  - Element ID tagging vs XPath references
  - Diff algorithms (Myers, patience diff)
  - Compression opportunities
- [ ] Design mutation serialization format
- [ ] Implement and test mutation serialization in `startRecording`
- [ ] Update player to handle delta frames during playback
- [ ] Performance testing: mutation processing overhead

### Input Event Recording

- [ ] Design input event schema (keyboard, mouse, scroll, resize)
- [ ] Implement event capture in bookmarklet
- [ ] Add input events to `.dcrr` format and player
- [ ] Create visual overlays for input playback (cursor, keyboard)

## Phase 4 - Optimization & Edge Cases

### Performance & Reliability

- [ ] Memory usage profiling during long recordings
- [ ] Optimize large page capture (lazy loading, selective capture)
- [ ] Handle network failures gracefully
- [ ] Add recording quality settings (keyframe interval, compression)

### Edge Case Handling

- [ ] Dynamic content (AJAX updates, infinite scroll)
- [ ] Browser compatibility testing
- [ ] Large file handling and streaming playback
- [ ] Error recovery and partial recordings

---

## Testing Strategy

Each phase should include:

- Unit tests for core utilities
- Integration tests with real web pages
- Performance benchmarks
- Cross-browser validation on representative sites

## Documentation Plan

- `docs/file_format.md` - Binary format specification
- `docs/architecture.md` - System design decisions
- `docs/performance.md` - Benchmarks and optimization notes
- `docs/compatibility.md` - Browser and site compatibility matrix

The focus is on getting a working proof of concept while building systematic understanding of the technical challenges.
