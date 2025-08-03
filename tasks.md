# Domcorder Roadmap

## Project Goals

Create an "HTML video" capture & playback system that records webpage state over time, using keyframes and delta frames, with input event recording.

## punchlist

- [~] Change detection
  - [x] DOM Change detector (responsible for detecing changes that would be visible in outerHTML / detectable by MutationObserver)
    - [x] interval vdom diff module
  - [ ] recording canvas changes (monkey-patching?)
  - [ ] recording scrolloffsets for scrollable elements (scroll event binding?)
  - [ ] stylesheet changes (event binding?)
  - [ ] mouse / keyboard / scrolloffset (references dom elements)
  - [ ] viewport size
  - [ ] maybe don't bother - but, zoom level (not sure if possible)
- [~] JS change operation in-memory format

- [ ] Transformation/inlining engine - transform the dom structure to be replayable (incrementally)

  - Note: reasons we transform/inline things:

    - content is not actually represented in the dom - eg canvas state
    - cases where the player may not be able to access resources (css files, images, etc) which might require a login to access, or maybe ephemeral, or maybe not available due to network connectivity, etc. (we want to fully and centrally capture the resources necessary to replay the recording with visual fidelity)

  - [x] POC keyframe generator - captureKeyframe function (and associated functions)
  - [ ] rename captureKeyframe to transformSubtree (or something like that - and created a new captureKeyframe function that calls transformSubtree on the entire document)
  - [ ] update transformSubtree to:
    - [ ] background resource fetching without yielding the transformSubtree recursion
    - [ ] initial output format - sufficient for feeding local player iframe (used during developemnt)
    - [ ] update initial output format to be the direct binary serialization

- [ ] POC player component

  - [ ] in the same page as the recorder for development purposes
  - [ ] consumes the initial output format and plays it back in an iframe in the same page as the recording
  - [ ] update player to consume the direct binary serialization

- [ ] Binary serialization and deserialization schema

  - [ ] change operations
  - [ ] change content
  - [ ] viewport size events
  - [ ] packet/frame containing N operations and events

- Optimization
  - [ ] webworkers for resource fetching / encoding? (probably needs to own the websocket connection to avoid double copying)

## Pending discssion points

- [ ] Strawman set of rust structs for the protocol
- [ ] Page navigation - stitching together of multiple recordings AND non-pageload navigations

#### TODO evaluate below here - pending review:

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
- Canvas content changes not detected by MutationObserver (requires separate strategy)

---

## Phase 1 - File Format & Still Image Capture ✅

**Completed:**

- Binary `.dcrr` format design with streaming support for keyframes, deltas, input events
- Format specification documented in `docs/file_format.md`
- TypeScript types and reader/writer utilities with seeking
- HTTP server setup with CORS, capture endpoints, bookmarklet generation and testing

**Remaining:**

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

### Change Detection Infrastructure

- [ ] **DOM Diff Calculation Module**: Implement efficient DOM diffing system
  - Research diff algorithms (Myers, patience diff) for DOM trees
  - Element ID tagging vs XPath references for node identification
  - Compression opportunities for mutation data
- [ ] **Canvas Change Detection Strategy**: Handle canvas content changes (MutationObserver blind spot)
  - Monkey-patch Canvas API methods (`drawImage`, `fillRect`, `strokeText`, etc.)
  - Implement canvas content hashing for change detection
  - Add canvas-specific delta encoding (image diffs or full snapshots)
- [ ] **Interval Diff Calculation Module**: Periodic change detection fallback
  - Implement scheduled DOM tree comparison for missed changes
  - Handle dynamic content not caught by MutationObserver
  - Configurable interval timing and scope

### Resource Frame Design

- [ ] Design "Resource" frame type for static assets (images, fonts, etc.)
  - Research addressing schemes: content-addressed vs ID-based vs offset-based
  - Define how keyframes/deltas reference resources (URLs, hashes, IDs)
  - Consider deduplication strategies for repeated resources
  - Plan streaming implications (when to send resources vs references)
- [ ] Update `.dcrr` format specification with Resource frame type
- [ ] Implement Resource frame encoding/decoding in format utilities

### Delta Frame Implementation

- [ ] Design mutation serialization format using diff calculation module
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
