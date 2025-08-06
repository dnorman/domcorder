import { JSDOM } from 'jsdom';
import { Writer } from "../../mmacfadden/src/protocol/writer.ts";
import { TimestampDataEnc, KeyframeDataEnc } from "../../mmacfadden/src/protocol/frames.ts";
import { compareBinaryFile, hexDump } from '../util.js';

// Set up DOM polyfill - simple structure like Rust test
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

// Test with just Timestamp + simple Keyframe
const w = new Writer();

TimestampDataEnc.encode(w, 1722550000000); // Fixed timestamp for consistency
KeyframeDataEnc.encode(w, "<!DOCTYPE html>", document.documentElement);

export const streamBytes = w.finish();

console.log(`\n✅ Simple Keyframe test: encoded ${streamBytes.length} bytes`);
console.log("Expected: ~140 bytes (12 + 128)");

// Compare against expected file
compareBinaryFile('simple-keyframe.bin', streamBytes, 'simple-keyframe');

console.log("\n🎉 Simple Keyframe test completed!");