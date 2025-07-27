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

- [x] Research existing container formats (WebM, MP4) for inspiration
- [x] Design streaming append-only binary container format that supports:
  - File header with magic bytes, version, metadata
  - Viewport frames (variable during recording)
  - Keyframes (full HTML snapshots)
  - Delta frames (DOM mutations)
  - Input events (keyboard/mouse) with timecodes
  - Misc events with timecodes
  - Sequential frame structure for streaming
- [x] Document format spec in `docs/file_format.md`
- [x] Create TypeScript types for format structures
- [x] Build basic reader/writer utilities with seeking support

### Basic Still Image Pipeline

- [x] Set up minimal HTTP server (Bun) with CORS handling
- [x] Create simple server endpoint to receive and save captures
- [x] Generate bookmarklet from TypeScript source with build watcher
- [x] Test bookmarklet injection + immediate `captureKeyframe` call
- [ ] Add player interface to main page that loads `.dcrr` files from server and displays in iframe
- [ ] Update GETTING_STARTED.md to remove "not implemented yet" note once player works

## Phase 2 - Basic Video Recording

### Slow Keyframe Recording (≈1 fps)

- [ ] Design WebSocket binary message protocol for recording streams
- [ ] Extend server to handle WebSocket connections and live writing to `.dcrr`
- [ ] Update bookmarklet for continuous recording mode
- [ ] Test `startRecording` with periodic keyframe capture
- [ ] Handle recording session lifecycle (start/stop/pause)

### Player Timeline

- [ ] Add basic timeline/scrubber to player interface
- [ ] Implement frame seeking using file index
- [ ] Test playback of multi-keyframe recordings
- [ ] Add playback controls (play/pause/speed)

## Phase 3 - Delta Frames & Input

### Resource Frame Design

- [ ] Design "Resource" frame type for static assets (images, fonts, etc.)
  - Research addressing schemes: content-addressed vs ID-based vs offset-based
  - Define how keyframes/deltas reference resources (URLs, hashes, IDs)
  - Consider deduplication strategies for repeated resources
  - Plan streaming implications (when to send resources vs references)
- [ ] Update `.dcrr` format specification with Resource frame type
- [ ] Implement Resource frame encoding/decoding in format utilities

### Delta Frame Implementation

- [ ] Research efficient DOM mutation encoding approaches:
  - Element ID tagging vs XPath references
  - Diff algorithms (Myers, patience diff)
  - Compression opportunities
- [ ] Design mutation serialization format
- [ ] Implement and test mutation serialization in `startRecording`
- [ ] Update player interface to handle delta frames during playback
- [ ] Performance testing: mutation processing overhead

### Input Event Recording

- [ ] Design input event schema (keyboard, mouse, scroll, resize)
- [ ] Implement event capture in bookmarklet
- [ ] Add input events to `.dcrr` format and player interface
- [ ] Create visual overlays for input playback (cursor, keyboard)

## Phase 4 - Cataloging & Real-time Updates

### Ankurah Integration

- [ ] Design recording metadata schema for cataloging
- [ ] Integrate Ankurah for recording management
- [ ] Add real-time recording list updates
- [ ] Add search and filtering to recordings interface

## Phase 5 - Optimization & Edge Cases

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
