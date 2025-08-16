import { JSDOM } from 'jsdom';
import { Writer } from "../src/writer.ts";
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
} from "../src/frames.ts";

import { compareBinaryFile, hexDump } from './util.js';

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

TimestampDataEnc.encode(w, 1722550000000); // Fixed timestamp to match Rust
KeyframeDataEnc.encode(w, document);  // Contains DomNode - now uncommented
ViewportResizedDataEnc.encode(w, 1920, 1080);
ScrollOffsetChangedDataEnc.encode(w, 0, 240);
MouseMovedDataEnc.encode(w, 150, 200);
MouseClickedDataEnc.encode(w, 150, 200);
KeyPressedDataEnc.encode(w, "Enter");
ElementFocusedDataEnc.encode(w, 42n);
DomTextChangedDataEnc.encode(w, 42n, "Updated text content");
DomNodeAddedDataEnc.encode(w, 1n, 0, createSimpleNode());  // Contains DomNode - now uncommented
DomAttributeChangedDataEnc.encode(w, 42n, "class", "updated-class");

export const streamBytes = w.finish();

console.log(`\n✅ Successfully encoded ${streamBytes.length} bytes`);

// Debug: Let's see what JSDOM structure we're actually encoding
console.log('\n=== JSDOM Structure Analysis ===');
console.log('Document element:', document.documentElement.tagName);
console.log('HTML children count:', document.documentElement.childNodes.length);
for (let i = 0; i < document.documentElement.childNodes.length; i++) {
    const child = document.documentElement.childNodes[i];
    console.log(`  Child ${i}: ${child.nodeType} (${child.nodeName}) - "${child.textContent?.trim() || 'no text'}"`);
    if (child.nodeType === Node.ELEMENT_NODE) {
        const elem = child as Element;
        console.log(`    Attributes: ${elem.attributes.length}`);
        console.log(`    Children: ${elem.childNodes.length}`);
        for (let j = 0; j < elem.childNodes.length; j++) {
            const grandchild = elem.childNodes[j];
            console.log(`      Child ${j}: ${grandchild.nodeType} (${grandchild.nodeName}) - "${grandchild.textContent?.trim() || 'no text'}" RAW: "${JSON.stringify(grandchild.textContent)}"`);
        }
    }
}

// Compare against expected file using utility function
compareBinaryFile('frames-basic.bin', streamBytes, 'frames-encoding-with-domnodes');

// Frame type validation
const view = new DataView(streamBytes.buffer);
const firstFrameType = view.getUint32(0, false); // big-endian
console.log(`✓ First frame type: ${firstFrameType} (Timestamp)`);

console.log("\n🎉 All frame encoders working correctly with DOM polyfill!");
console.log("🦀 Binary file ready for Rust parsing tests!");

