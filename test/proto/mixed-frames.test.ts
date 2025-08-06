import { JSDOM } from 'jsdom';
import { Writer } from "../../mmacfadden/src/protocol/writer.ts";
import { TimestampDataEnc, ViewportResizedDataEnc, KeyframeDataEnc } from "../../mmacfadden/src/protocol/frames.ts";
import { compareBinaryFile } from '../util.js';

// Set up DOM polyfill - simplest possible structure
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);

global.document = dom.window.document;
global.window = dom.window as any;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.Document = dom.window.Document;

// Test: 2 non-DOM frames + 1 DOM frame
const w = new Writer();

TimestampDataEnc.encode(w, 1722550000000); // Fixed timestamp
ViewportResizedDataEnc.encode(w, 1920, 1080); // Non-DOM frame
KeyframeDataEnc.encode(w, "<!DOCTYPE html>", document.documentElement); // DOM frame

export const streamBytes = w.finish();

console.log(`\n✅ Mixed frames test: encoded ${streamBytes.length} bytes`);
console.log("Expected: ~140 bytes (12 + 12 + ~116 for minimal DOM)");

// Compare against expected file
compareBinaryFile('mixed-frames.bin', streamBytes, 'mixed-frames');

console.log("\n🎉 Mixed frames test completed!");