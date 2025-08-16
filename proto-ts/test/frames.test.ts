import { Writer } from "../src/writer.ts";
import { compareBinaryFile } from './util.js';
import { setupDOMGlobals, generateTestFrames } from "./sample-frames.ts";

// Set up DOM polyfills
setupDOMGlobals();

// Generate the standard test frame sequence
const w = new Writer();
generateTestFrames(w);
export const streamBytes = w.finish();

console.log(`\nGenerated ${streamBytes.length} bytes total`);

// Compare against expected file using utility function
compareBinaryFile('frames-basic.bin', streamBytes, 'frames-basic');

