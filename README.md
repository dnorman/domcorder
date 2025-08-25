# DomCorder

DomCorder captures web pages as "videos" that can be played back with full fidelity.

## Project Structure

This is a workspace containing multiple packages:

- **`demo-app/`** - Demo application showcasing DomCorder functionality
- **`proto-ts/`** - TypeScript implementation of the binary protocol  
- **`proto-rs/`** - Rust implementation of the binary protocol

## Prerequisites

- [Bun](https://bun.sh) (latest version)
- [Rust](https://rustup.rs/) (latest stable)
- Modern web browser

## Quick Start

```bash
cd domcorder
bun install

# Start development (builds injection script + starts server)
cd demo-app
bun run dev
```

Visit **http://localhost:8547** to:

1. Drag the **📸 DomCorder** button to your bookmarks bar
2. View your recordings list _(Player interface not implemented yet - files can be downloaded)_
3. Use the player to view recordings _(Coming soon)_

Activate the bookmarklet on any webpage to capture the page. The capture should show up in the recordings list.

## Development

### Testing the Protocol

```bash
# Test TypeScript protocol implementation
cd proto-ts && bun run test

# Test Rust protocol implementation  
cd proto-rs && cargo test

# Test entire workspace
bun run test:all
```

### Binary Protocol

The TypeScript and Rust packages work together to provide a cross-language binary serialization protocol for DOM structures and frame data. The TypeScript implementation generates bincode-compatible binary data that the Rust implementation can parse perfectly.


```
cargo watch -x 'run --bin domcorder-server'
```