import { JSDOM } from 'jsdom';
import { Writer } from "../../mmacfadden/src/protocol/writer.ts";
import { KeyframeDataEnc } from "../../mmacfadden/src/protocol/frames.ts";
import { hexDump } from '../util.js';

// Set up DOM polyfill - create a simple HTML structure like the Rust test
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<head></head>
<body class="app"></body>
</html>
`);

global.document = dom.window.document;
global.window = dom.window as any;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.Document = dom.window.Document;

console.log('DOM structure:');
console.log(`- documentElement.tagName: ${document.documentElement.tagName}`);
console.log(`- documentElement.attributes: ${Array.from(document.documentElement.attributes).map(a => `${a.name}=${a.value}`).join(', ')}`);
console.log(`- documentElement.children: ${document.documentElement.children.length}`);
for (let i = 0; i < document.documentElement.children.length; i++) {
    const child = document.documentElement.children[i];
    console.log(`  - ${child.tagName}: attributes=${Array.from(child.attributes).map(a => `${a.name}=${a.value}`).join(', ')}`);
}

// Encode just the Keyframe
const w = new Writer();
KeyframeDataEnc.encode(w, "<!DOCTYPE html>", document.documentElement);
const tsBytes = w.finish();

console.log(`\nTypeScript Keyframe encoded (${tsBytes.length} bytes):`);
console.log(hexDump(tsBytes, 200));

console.log('\nExpected Rust Keyframe format (128 bytes):');
console.log('0000: 00 00 00 01 00 00 00 00 00 00 00 0f 3c 21 44 4f  |............<!DO|');
console.log('0010: 43 54 59 50 45 20 68 74 6d 6c 3e 00 00 00 00 00  |CTYPE html>.....|');
console.log('0020: 00 00 04 68 74 6d 6c 00 00 00 00 00 00 00 00 00  |...html.........|');
console.log('... (truncated for brevity)');

console.log(`\n${tsBytes.length === 128 ? '✓' : '❌'} Size comparison: TypeScript=${tsBytes.length} bytes, Rust=128 bytes`);

// Show first 32 bytes for comparison
console.log('\nFirst 32 bytes comparison:');
console.log('TypeScript:', Array.from(tsBytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('Rust:      00 00 00 01 00 00 00 00 00 00 00 0f 3c 21 44 4f 43 54 59 50 45 20 68 74 6d 6c 3e 00 00 00 00');