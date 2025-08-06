import { JSDOM } from 'jsdom';
import { Writer } from "../../mmacfadden/src/protocol/writer.ts";
import { TimestampDataEnc, KeyframeDataEnc } from "../../mmacfadden/src/protocol/frames.ts";
import { compareBinaryFile } from '../util.js';

// Set up DOM polyfill with the complex structure
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

console.log('DOM structure analysis:');
console.log(`- Document children: ${document.childNodes.length}`);
console.log(`- Document element: ${document.documentElement.tagName}`);
console.log(`- HTML children: ${document.documentElement.childNodes.length}`);

for (let i = 0; i < document.documentElement.childNodes.length; i++) {
    const child = document.documentElement.childNodes[i];
    console.log(`  - Child ${i}: ${child.nodeType} (${child.nodeName})`);
    if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        console.log(`    - Tag: ${element.tagName}`);
        console.log(`    - Attributes: ${element.attributes.length}`);
        console.log(`    - Children: ${element.childNodes.length}`);
    }
}

// Test with just Timestamp + Complex Keyframe
const w = new Writer();

TimestampDataEnc.encode(w, 1722550000000); // Fixed timestamp
KeyframeDataEnc.encode(w, document);

export const streamBytes = w.finish();

console.log(`\n✅ Complex Keyframe test: encoded ${streamBytes.length} bytes`);

// Compare against expected file
compareBinaryFile('debug-complex-keyframe.bin', streamBytes, 'debug-complex-keyframe');

console.log("\n🎉 Complex Keyframe test completed!");