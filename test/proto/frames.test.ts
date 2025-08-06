import { JSDOM } from 'jsdom';
import { Writer } from "../../mmacfadden/src/protocol/writer.ts";
import {
    TimestampDataEnc,
    KeyframeDataEnc,
    ViewportResizedDataEnc,
    ScrollOffsetChangedDataEnc,
    MouseMovedDataEnc,
    MouseClickedDataEnc,
    KeyPressedDataEnc,
    ElementFocusedDataEnc,
    DomTextChangedDataEnc,
    DomNodeAddedDataEnc,
    DomAttributeChangedDataEnc
} from "../../mmacfadden/src/protocol/frames.ts";

import { compareBinaryFile, hexDump } from '../util.js';

// Set up DOM polyfill
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Test Document</title>
</head>
<body class="app">
    <div id="root">
        <h1>Hello World</h1>
        <p>This is a test paragraph.</p>
        <button onclick="alert('clicked')">Click me</button>
    </div>
</body>
</html>
`);

global.document = dom.window.document;
global.window = dom.window as any;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.Document = dom.window.Document;

// Create a simple node for testing DomNodeAdded
function createSimpleNode(): Element {
    const span = document.createElement('span');
    span.className = 'new-element';
    span.textContent = 'New content';
    return span;
}

// Test the encoding with realistic data
const w = new Writer();

TimestampDataEnc.encode(w, Date.now());
KeyframeDataEnc.encode(w, document);
ViewportResizedDataEnc.encode(w, 1920, 1080);
ScrollOffsetChangedDataEnc.encode(w, 0, 240);
MouseMovedDataEnc.encode(w, 150, 200);
MouseClickedDataEnc.encode(w, 150, 200);
KeyPressedDataEnc.encode(w, "Enter");
ElementFocusedDataEnc.encode(w, 42n);
DomTextChangedDataEnc.encode(w, 42n, "Updated text content");
DomNodeAddedDataEnc.encode(w, 1n, 0, createSimpleNode());
DomAttributeChangedDataEnc.encode(w, 42n, "class", "updated-class");

export const streamBytes = w.finish();

console.log(`\n✅ Successfully encoded ${streamBytes.length} bytes`);

// Compare against expected file using utility function
compareBinaryFile('frames-basic.bin', streamBytes, 'frames-encoding');

// Frame type validation
const view = new DataView(streamBytes.buffer);
const firstFrameType = view.getUint32(0, false); // big-endian
console.log(`✓ First frame type: ${firstFrameType} (Timestamp)`);

console.log("\n🎉 All frame encoders working correctly with DOM polyfill!");
console.log("🦀 Binary file ready for Rust parsing tests!");

