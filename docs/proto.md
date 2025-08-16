# DomCorder Protocol Specification

## Overview

Binary format for DOM capture and streaming. Uses bincode encoding (big-endian, fixed-length integers).

Two modes:
- **File Format**: `.dcrr` files with 32-byte header + frame stream
- **Stream Format**: Raw frame sequence (WebSocket, etc.)

## File Format (.dcrr)

```
[File Header: 32 bytes]
[Frame Stream: bincode-encoded frames]
```

### File Header (32 bytes)

| Offset | Size | Field      | Description                      |
| ------ | ---- | ---------- | -------------------------------- |
| 0      | 4    | magic      | Magic bytes: `DCRR` (0x44435252) |
| 4      | 4    | version    | Format version (currently 1)     |
| 8      | 8    | created_at | Unix timestamp (milliseconds)    |
| 16     | 16   | reserved   | Reserved (zeros)                 |

*All integers big-endian*

## Frame Stream Format

Sequential bincode-encoded frames. Each frame: `u32 variant_index + frame_data`.

## Frame Types

### Timestamp (0)
- `u32(0) + u64(timestamp_ms)`

### Keyframe (1)
- `u32(1) + string(doctype) + DomNode(document_element)`

### ViewportResized (2)
- `u32(2) + u32(width) + u32(height)`

### ScrollOffsetChanged (3)
- `u32(3) + u32(x_offset) + u32(y_offset)`

### MouseMoved (4)
- `u32(4) + u32(x) + u32(y)`

### MouseClicked (5)
- `u32(5) + u32(x) + u32(y)`

### KeyPressed (6)
- `u32(6) + string(key)`

### ElementFocused (7)
- `u32(7) + u64(element_id)`

### TextSelectionChanged (8)
- `u32(8) + u64(start_node_id) + u32(start_offset) + u64(end_node_id) + u32(end_offset)`

### DomNodeAdded (9)
- `u32(9) + u64(parent_node_id) + u32(index) + DomNode(node)`

### DomNodeRemoved (10)
- `u32(10) + u64(parent_node_id) + u32(index)`

### DomAttributeChanged (11)
- `u32(11) + u64(node_id) + string(attr_name) + string(attr_value)`

### DomAttributeRemoved (12)
- `u32(12) + u64(node_id) + string(attr_name)`

### DomTextChanged (13)
- `u32(13) + u64(node_id) + string(text)`

### DomNodeResized (14)
- `u32(14) + u64(node_id) + u32(width) + u32(height)`

### StyleSheetChanged (15)
- `u32(15)` (TODO: add fields)

## DomNode Encoding

Enum with variant index + data:

### Element (0)
- `u32(0) + string(tag_name) + u64(attr_count) + [string(name) + string(value)]* + u64(child_count) + DomNode*`

### Text (1)
- `u32(1) + string(text_content)`

### CData (2)
- `u32(2) + string(data)`

### Comment (3)
- `u32(3) + string(data)`

### Document (4)
- `u32(4) + u64(child_count) + DomNode*`

### DocType (5)
- `u32(5) + string(name) + Option<string>(public_id) + Option<string>(system_id)`

## Data Type Encoding

**String**: `u64(byte_length) + UTF-8_bytes`
**Option<T>**: `u32(0)` for None, `u32(1) + T` for Some(value)

## Cross-Language Compatibility

TypeScript and Rust implementations generate identical binary output using matching bincode configuration.