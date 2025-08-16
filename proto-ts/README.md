# @domcorder/proto-ts

TypeScript implementation of the domcorder binary protocol for serializing DOM structures and frame data.

## Overview

This package provides TypeScript classes and utilities for encoding DOM structures and frame data into bincode-compatible binary format that can be parsed by the Rust implementation (`proto-rs`).

## Usage

```typescript
import { Writer, DomNode, TimestampDataEnc, KeyframeDataEnc } from '@domcorder/proto-ts';

// Create a writer
const w = new Writer();

// Encode a timestamp frame
TimestampDataEnc.encode(w, Date.now());

// Encode a keyframe with DOM structure
KeyframeDataEnc.encode(w, document);

// Get the binary data
const binaryData = w.finish();
```

## Key Features

- **Cross-language compatibility**: Generates bincode-compatible binary data
- **Complete DOM serialization**: Handles all DOM node types including elements, text, comments, etc.
- **Frame-based protocol**: Supports various frame types for timestamps, keyframes, input events, etc.
- **TypeScript type safety**: Fully typed API

## Testing

```bash
bun run test
```

This will run the test suite that generates binary data and validates it against the Rust implementation.

## Binary Compatibility

The generated binary data is fully compatible with the Rust `proto-rs` implementation and follows the bincode serialization format with big-endian encoding.