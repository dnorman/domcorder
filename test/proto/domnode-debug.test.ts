import { JSDOM } from 'jsdom';
import { Writer } from "../../mmacfadden/src/protocol/writer.ts";
import { DomNode } from "../../mmacfadden/src/protocol/domnode.ts";
import { hexDump } from '../util.js';

// Set up DOM polyfill
const dom = new JSDOM(`<div class="test" id="myid">Hello World</div>`);
global.document = dom.window.document;
global.window = dom.window as any;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.Document = dom.window.Document;

// Get the div element
const divElement = dom.window.document.querySelector('div')!;

console.log('DOM structure:');
console.log(`- tagName: ${divElement.tagName}`);
console.log(`- attributes: ${Array.from(divElement.attributes).map(a => `${a.name}=${a.value}`).join(', ')}`);
console.log(`- textContent: "${divElement.textContent}"`);
console.log(`- childNodes: ${divElement.childNodes.length}`);

// Encode with TypeScript
const w = new Writer();
DomNode.encode(w, divElement);
const tsBytes = w.finish();

console.log(`\nTypeScript DomNode encoded (${tsBytes.length} bytes):`);
console.log(hexDump(tsBytes, 128));

console.log('\nExpected Rust DomNode format (114 bytes):');
console.log('0000: 00 00 00 00 00 00 00 03 64 69 76 00 00 00 00 00  |........div.....|');
console.log('0010: 00 00 02 00 00 00 00 00 00 00 0a 63 6c 61 73 73  |...........class|');
console.log('0020: 3d 74 65 73 74 00 00 00 00 00 00 00 07 69 64 3d  |=test........id=|');
console.log('0030: 6d 79 69 64 00 00 00 00 00 00 00 01 00 00 00 00  |myid............|');
console.log('0040: 00 00 00 05 23 74 65 78 74 00 00 00 00 00 00 00  |....#text.......|');
console.log('0050: 01 00 00 00 00 00 00 00 11 76 61 6c 75 65 3d 48  |.........value=H|');
console.log('0060: 65 6c 6c 6f 20 57 6f 72 6c 64 00 00 00 00 00 00  |ello World......|');
console.log('0070: 00 00                                            |..|');

// Analyze the differences
if (tsBytes.length !== 114) {
    console.log(`\n❌ Size mismatch: TypeScript=${tsBytes.length} bytes, Rust=114 bytes`);
} else {
    console.log(`\n✓ Size matches: ${tsBytes.length} bytes`);
}