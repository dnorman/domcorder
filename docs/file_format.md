# .dcrr File Format Specification

## Overview

The `.dcrr` (DomCorder Recording) format is a streaming binary container for HTML page recordings that supports:

- Keyframes (full HTML snapshots)
- Delta frames (DOM mutations)
- Input events (keyboard/mouse) with timestamps
- Viewport changes with timestamps
- Miscellaneous events with timestamps
- Append-only streaming format for live recording

## File Structure

```
[File Header]
[Frame 1]
[Frame 2]
[Frame 3]
...
[Frame N]
```

## File Header (32 bytes)

| Offset | Size | Type   | Field      | Description                      |
| ------ | ---- | ------ | ---------- | -------------------------------- |
| 0      | 4    | bytes  | magic      | Magic bytes: `DCRR` (0x44435252) |
| 4      | 4    | uint32 | version    | Format version (currently 1)     |
| 8      | 8    | uint64 | created_at | Unix timestamp (milliseconds)    |
| 16     | 16   | bytes  | reserved   | Reserved for future use (zeros)  |

## Frame Structure

Each frame has a common header followed by frame-specific data:

```
[Frame Header: 16 bytes]
[Frame Data: variable length]
```

### Frame Header (16 bytes)

| Offset | Size | Type   | Field      | Description                                |
| ------ | ---- | ------ | ---------- | ------------------------------------------ |
| 0      | 8    | uint64 | timestamp  | Frame timestamp (ms since recording start) |
| 8      | 1    | uint8  | frame_type | Frame type (see Frame Types)               |
| 9      | 3    | bytes  | reserved   | Reserved for alignment                     |
| 12     | 4    | uint32 | data_size  | Size of frame data in bytes                |

## Frame Types

| Value | Name     | Description               |
| ----- | -------- | ------------------------- |
| 0     | Viewport | Viewport size information |
| 1     | Keyframe | Full HTML snapshot        |
| 2     | Delta    | DOM mutation delta        |
| 3     | Input    | Keyboard/mouse event      |
| 4     | Metadata | Recording metadata        |

## Frame Data Formats

### Viewport Frame (Type 0)

```
[Width: 4 bytes][Height: 4 bytes]
```

### Keyframe Frame (Type 1)

```
[HTML Data: variable length UTF-8]
```

### Delta Frame (Type 2)

```
[Mutation Count: 4 bytes]
[Mutations: variable length]
```

Each Mutation:

```
[Type: 1 byte][Target: variable][Data: variable]
```

Mutation Types:

- 0: Element added
- 1: Element removed
- 2: Attribute changed
- 3: Text content changed

### Input Event Frame (Type 3)

```
[Event Type: 1 byte][Event Data: variable]
```

Event Types:

- 0: Key press
- 1: Key release
- 2: Mouse move
- 3: Mouse click
- 4: Mouse scroll

### Metadata Frame (Type 4)

```
[Key Length: 2 bytes][Key: UTF-8][Value Length: 4 bytes][Value: UTF-8]
```

## Reading Algorithm

1. Read file header to verify format and version
2. Read frames sequentially from offset 32 until end of file:
   - Read frame header (16 bytes)
   - Read frame data based on `data_size`
   - Parse frame data based on `frame_type`

## Seeking Algorithm (for playback)

1. Read all frames into memory index during file load
2. For timestamp T, find the latest viewport frame ≤ T
3. Find the latest keyframe ≤ T
4. Apply all delta frames from keyframe to timestamp T

## Streaming Write Algorithm

1. Write file header once at start
2. For each event:
   - Calculate timestamp relative to recording start
   - Serialize frame data
   - Write frame header + data
   - Flush to disk immediately

## Implementation Notes

- All multi-byte integers are little-endian
- UTF-8 strings are not null-terminated unless specified
- Frames are written sequentially with no gaps
- File can be read while being written (streaming)
- Reserved fields must be zero for forward compatibility
- First frame should typically be a Viewport frame
- Keyframes should be sent periodically for seeking support

## WebSocket Protocol Integration

This format maps directly to WebSocket binary messages:

- Recording: Each frame becomes a binary WebSocket message with same structure
- Playback: Server streams frames as binary messages in chronological order
- Seeking: Client requests timestamp, server sends required frames from that point

## Example Frame Sequence

```
[File Header]
[Viewport Frame: 1920x1080]
[Keyframe: Full HTML]
[Input Frame: Mouse move]
[Input Frame: Mouse click]
[Delta Frame: Element added]
[Keyframe: Full HTML] (periodic)
[Viewport Frame: 1280x720] (window resized)
[Delta Frame: Attribute changed]
...
```
