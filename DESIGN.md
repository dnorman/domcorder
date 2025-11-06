# DomCorder: High-Level Design and Requirements

## Overview

DomCorder is a system for recording and replaying user interactions with web pages with high fidelity. The goal is to capture a complete representation of how a user experiences a web page, including the page structure, how it changes over time, and all user interactions, such that the experience can be faithfully replayed later.

## Core Purpose

The system aims to "record" a user's interaction with a web page. This includes:

- **Page Structure**: The initial HTML document structure and its complete DOM representation
- **Structural Changes**: How the page structure evolves over time through DOM mutations (nodes added, removed, attributes changed, text content modified)
- **User Interactions**: All user actions including:
  - Mouse pointer movement
  - Mouse clicks
  - Keyboard input and typing
  - Scrolling (both window and element-level)
  - Text selections
  - Viewport resizing
  - Element focus changes

The intent is to capture this data in a way that the user's usage of the page can be faithfully played back, looking as close to the original experience as possible.

## System Components

The DomCorder system consists of three main components:

### 1. Recorder (Browser-Side)

The recorder is a JavaScript library that runs in the source browser where the user is interacting with the page. It:

- Monitors the DOM for changes using MutationObserver and related APIs
- Tracks user interactions through event listeners
- Captures the initial page state
- Streams recording data to the server in real-time
- Handles asset discovery and fetching

### 2. Server

The server acts as a central hub that:

- Receives recording streams from recorders via WebSocket connections
- Stores recordings (either in memory for live playback or to disk for persistent storage)
- Serves recordings to players for playback
- Manages the connection between recorders and players for live sessions

### 3. Player (Browser-Side)

The player is a JavaScript library that runs in a browser (potentially different from the recorder) and:

- Receives recording data from the server (either live stream or from storage)
- Reconstructs the DOM structure based on recorded frames
- Simulates user interactions to recreate the original experience
- Manages asset resolution and rendering

## Recording and Playback Modes

The system supports two primary modes of operation:

### Live Playback

In live playback mode, the recorder streams data to the server in real-time, and the player receives and plays back the stream as it arrives. This enables:

- Real-time monitoring of a user's session
- Live debugging and support scenarios
- Immediate feedback on user interactions

The player processes frames as quickly as possible while maintaining the correct order of operations, without waiting for timestamps.

### Recorded Playback

In recorded playback mode, recordings are stored persistently (typically as files) and can be played back later. This enables:

- Reviewing past user sessions
- Debugging issues that occurred in the past
- Training and documentation purposes
- Analysis of user behavior patterns

The player respects the original timing of events, replaying interactions at approximately the same relative pace as they were recorded.

## Data Capture Approach

### Keyframes and Mutation Frames

The recording system uses a differential approach to capture page state efficiently:

**Keyframes**: The initial state of the page is captured as a complete "snapshot" called a keyframe. This includes:
- The document type declaration
- The complete DOM tree structure
- Initial viewport dimensions
- Initial scroll positions

**Mutation Frames**: After the initial keyframe, only changes to the page are recorded. These mutation frames capture:
- DOM nodes added to the tree
- DOM nodes removed from the tree
- Attribute changes on existing nodes
- Text content modifications
- Stylesheet changes
- User interaction events (mouse movements, clicks, keyboard input, etc.)
- Viewport and scroll position changes

This differential approach minimizes the amount of data that needs to be transmitted and stored while maintaining complete fidelity.

### Frame Types

The system captures various types of events as discrete frames:

- **Timestamp**: Marks the passage of time for timing playback
- **Keyframe**: Initial page state with complete DOM tree
- **ViewportResized**: Changes to browser window/viewport size
- **ScrollOffsetChanged**: Scroll position changes (window or element)
- **MouseMoved**: Mouse pointer position updates
- **MouseClicked**: Mouse click events
- **KeyPressed**: Keyboard input events
- **ElementFocused**: Focus changes on form elements
- **TextSelectionChanged**: Text selection changes
- **DomNodeAdded**: New DOM nodes added to the tree
- **DomNodeRemoved**: DOM nodes removed from the tree
- **DomAttributeChanged**: Attribute value changes
- **DomAttributeRemoved**: Attribute removals
- **DomTextChanged**: Text node content changes
- **StyleSheetChanged**: Stylesheet modifications
- **Asset**: External resource data (images, fonts, stylesheets, etc.)

## Asset Management Challenge

### The Problem

Web pages often reference external resources such as:
- Images (via `src` attributes)
- Stylesheets (via `<link>` tags or `@import`)
- Fonts (via `@font-face` in CSS)
- Videos and other media
- Scripts and other assets

When recording a page, these resources are typically loaded from URLs that may:
- Not be accessible during playback (different network, offline environment)
- No longer exist (resources deleted, domains expired)
- Be behind authentication or CORS restrictions
- Have relative URLs that don't resolve correctly in the playback context

Additionally, resources may load asynchronously, meaning the DOM structure may be recorded before the associated assets finish loading.

### The Solution

The system addresses this challenge through a comprehensive asset management approach:

**Asset Identification**: When the recorder encounters an asset reference (e.g., `<img src="/logo.png">`), it:
1. Normalizes the URL to an absolute URL
2. Assigns a unique integer ID to each distinct asset URL
3. Replaces the original URL in the DOM with a placeholder format: `asset:N` (where N is the asset ID)

**Asset Capture**: The recorder asynchronously fetches the actual asset data:
- This happens independently of DOM structure recording
- Asset data is captured as binary content with MIME type information
- Asset frames are emitted as separate frames in the stream
- The order of asset frames relative to DOM frames is not guaranteed

**Asset Resolution During Playback**: The player maintains an asset manager that:
- Tracks which assets have been received and which are still pending
- Creates browser Blob URLs for asset data as it arrives
- Updates DOM elements to use the Blob URLs instead of the `asset:N` placeholders
- Handles cases where DOM elements arrive before their assets (using placeholder blobs)
- Handles nested asset references (e.g., CSS files that reference images)

This approach ensures that recordings are self-contained and can be played back in any environment without requiring access to the original external resources.

## Communication Protocol

### Binary WebSocket Protocol

The system uses a binary WebSocket protocol for efficient data transmission. The protocol is designed to:

- Support streaming of frames as they are generated
- Handle arbitrary chunk boundaries (frames can span multiple network packets)
- Minimize bandwidth usage through efficient binary encoding
- Maintain compatibility between TypeScript (browser) and Rust (server) implementations

### Protocol Characteristics

**Encoding Format**: Uses bincode serialization (big-endian, fixed-length integers) for cross-language compatibility

**Streaming Architecture**: 
- Frames are encoded and sent incrementally as they are generated
- Large frames (like assets) can be split across multiple chunks
- The protocol handles buffering and reassembly of partial frames

**Frame Structure**: Each frame consists of:
- Frame type identifier (u32)
- Frame-specific data (variable length)
- No explicit length prefix (frames are parsed to determine boundaries)

**File Format**: Recordings can be stored as `.dcrr` files with:
- A 32-byte header containing magic bytes, version, and creation timestamp
- A stream of frames following the same binary format

## Design Principles

### Non-Blocking Recording

The recorder does not wait for asset loading or other asynchronous operations before recording DOM changes. This ensures:
- Responsive recording that doesn't freeze on slow networks
- Accurate capture of DOM mutation timing
- Recording can proceed even if some assets fail to load

### Progressive Playback

The player can begin rendering the page structure before all assets arrive:
- DOM structure is rendered immediately when keyframes and mutation frames arrive
- Assets resolve progressively as their data becomes available
- The page remains viewable while assets load in the background

### Self-Contained Recordings

Recordings must be portable and self-contained:
- All asset data is embedded in the recording stream
- No external network access required during playback
- Recordings can be replayed in different environments (different networks, offline, etc.)

### Fidelity Preservation

The system prioritizes faithful reproduction of the original experience:
- DOM structure is captured exactly as it appears
- User interactions are replayed with accurate timing
- Visual appearance is preserved through asset capture and CSS handling
- Scroll positions, viewport sizes, and cursor positions are accurately reproduced

## Key Challenges and Solutions

### Timing Accuracy

**Challenge**: Maintain accurate timing between events during playback, especially for recorded sessions.

**Solution**: Timestamp frames mark the passage of time, allowing the player to schedule operations at the correct relative times. For live playback, frames are processed immediately while preserving order.

### Large DOM Trees

**Challenge**: Efficiently capture and transmit large, complex DOM structures.

**Solution**: The keyframe captures the initial state, then only incremental changes are recorded. The binary protocol efficiently encodes DOM structures, and the streaming architecture allows processing without buffering entire trees in memory.

### Dynamic Content

**Challenge**: Capture content that is dynamically generated or modified by JavaScript.

**Solution**: MutationObserver and related APIs monitor all DOM changes. Stylesheet modifications are tracked through CSSOM monitoring. Canvas and other dynamic visual content can be tracked through specialized trackers.

### CSS and Stylesheet Handling

**Challenge**: Stylesheets can be inline, external, or adopted, and can reference other assets.

**Solution**: The system tracks all stylesheet types and captures their content. Asset references within CSS are identified and resolved. Adopted stylesheets (not part of the DOM) are tracked separately.

### Cross-Browser Compatibility

**Challenge**: Ensure recordings work across different browsers and browser versions.

**Solution**: The system uses standard web APIs and focuses on DOM structure and events rather than browser-specific internals. The binary protocol is language-agnostic.

## Use Cases

DomCorder is designed to support various use cases:

- **User Session Replay**: Record and review user sessions for debugging, support, or analysis
- **Live Monitoring**: Real-time monitoring of user interactions for support or debugging
- **Testing and QA**: Record user interactions for test case generation or regression testing
- **Training and Documentation**: Create interactive demonstrations of web applications
- **Accessibility Testing**: Replay sessions to understand how users interact with pages
- **Performance Analysis**: Analyze timing of user interactions relative to page changes

## Future Considerations

While the current design focuses on the core recording and playback functionality, there are areas for future enhancement:

- **Content Deduplication**: Detect and share identical assets across multiple recordings
- **Compression**: Apply compression to reduce storage and bandwidth requirements
- **Selective Recording**: Record only specific portions of pages or interactions
- **Privacy Controls**: Mechanisms to exclude sensitive data from recordings
- **Performance Optimization**: Optimize playback for very large or long-running recordings
- **Multi-Page Sessions**: Support for recording navigation across multiple pages

