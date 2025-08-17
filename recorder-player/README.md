# DOM Diff Utilities

A TypeScript library for computing incremental diffs between DOM trees and applying them efficiently. Designed for real-time UI synchronization and change tracking.

## Features

- **Incremental DOM Diffing**: Computes minimal diff operations that can be applied sequentially
- **JSON-Serializable**: All diff operations are serializable for network transmission
- **Path-Based Navigation**: Uses array-based paths to precisely locate DOM nodes
- **Real-time Monitoring**: Includes utilities for continuous DOM change detection
- **TypeScript Support**: Full type safety with comprehensive type definitions

## Installation

```bash
bun install
```

## Demo
```
bun run dev
```

Then visit: http://localhost:3000


## Quick Start

```typescript
import { diffDom, applyDomDiff, startIncrementalDomDiff } from './src';

// Compute diff between two DOM trees
const oldElement = document.getElementById('old');
const newElement = document.getElementById('new');
const diffOps = diffDom(oldElement, newElement);

// Apply diff operations to update a DOM tree
applyDomDiff(targetElement, diffOps);

// Start monitoring DOM changes
const stopMonitoring = startIncrementalDomDiff(
  rootElement,
  (ops) => {
    console.log('DOM changed:', ops);
    // Send ops over network, apply to remote DOM, etc.
  },
  1000 // Check every 1000ms
);

// Stop monitoring when done
stopMonitoring.stop();
```

## API Reference

### Core Types

```typescript
type Path = number[]; // Array of child indices to navigate DOM tree

type SerializedNode = 
  | { type: 'text'; text: string }
  | { type: 'element'; tag: string; attributes: Record<string, string>; children: SerializedNode[] };

type DiffOperation =
  | { op: 'insert'; path: Path; node: SerializedNode; index: number }
  | { op: 'remove'; path: Path; index: number }
  | { op: 'replace'; path: Path; index: number; node: SerializedNode }
  | { op: 'updateAttribute'; path: Path; index: number; name: string; value: string }
  | { op: 'removeAttribute'; path: Path; index: number; name: string }
  | { op: 'updateText'; path: Path; value: string };
```

### Functions

#### `diffDom(oldNode: Node, newNode: Node, path?: Path): DiffOp[]`

Computes incremental diff operations to transform `oldNode` into `newNode`.

- **Parameters:**
  - `oldNode`: Source DOM node
  - `newNode`: Target DOM node
  - `path`: Optional path to current node (used internally for recursion)
- **Returns:** Array of diff operations to apply sequentially

#### `applyDomDiff(root: Element, ops: DiffOp[]): void`

Applies a list of diff operations to a DOM root element.

- **Parameters:**
  - `root`: The DOM element to apply operations to
  - `ops`: Array of diff operations to apply

#### `startIncrementalDomDiff(root: Element, onDiff: (ops: DiffOp[]) => void, intervalMs?: number): { stop: () => void }`

Starts monitoring a DOM element for changes and calls the callback with diff operations.

- **Parameters:**
  - `root`: DOM element to monitor
  - `onDiff`: Callback function called with diff operations when changes are detected
  - `intervalMs`: Polling interval in milliseconds (default: 1000)
- **Returns:** Object with `stop()` method to halt monitoring

#### `nodeToSerialized(node: Node): SerializedNode`

Converts a DOM node to a JSON-serializable representation.

## Path System

The path system uses arrays of numbers to navigate the DOM tree:

```typescript
// Example: [0, 2, 1] means:
// - Start at root
// - Go to first child (index 0)
// - Go to third child of that node (index 2)
// - Go to second child of that node (index 1)
```

## Usage Examples

### Basic Diff and Apply

```typescript
// Create two different DOM structures
const oldDiv = document.createElement('div');
oldDiv.innerHTML = '<span>Hello</span><b>World</b>';

const newDiv = document.createElement('div');
newDiv.innerHTML = '<span>Hello</span><i>Universe</i>';

// Compute diff
const ops = diffDom(oldDiv, newDiv);
console.log(ops);
// Output: [
//   { op: 'remove', path: [1], index: 1 },
//   { op: 'insert', path: [], node: { type: 'element', tag: 'i', attributes: {}, children: [{ type: 'text', text: 'Universe' }] }, index: 1 }
// ]

// Apply diff
applyDomDiff(oldDiv, ops);
// oldDiv now matches newDiv
```

### Real-time Monitoring

```typescript
// Monitor a live DOM element
const container = document.getElementById('dynamic-content');
const stopMonitoring = startIncrementalDomDiff(
  container,
  (ops) => {
    // Send changes to server or apply to remote DOM
    fetch('/api/dom-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ops)
    });
  },
  500 // Check every 500ms
);

// Later, stop monitoring
stopMonitoring.stop();
```

### Custom Serialization

```typescript
// Convert DOM to JSON for storage/transmission
const element = document.getElementById('my-element');
const serialized = nodeToSerialized(element);
console.log(JSON.stringify(serialized, null, 2));
```

## Testing

Run the test suite:

```bash
npx ts-node test/domDiff.test.ts
```

## Architecture

The library is designed around these principles:

1. **Incremental Operations**: Each diff operation is computed based on the state after applying previous operations
2. **Serializable Output**: All operations can be JSON-serialized for network transmission
3. **Path-Based Navigation**: Precise DOM navigation using array-based paths
4. **Minimal Diffs**: Only the necessary changes are computed and applied


