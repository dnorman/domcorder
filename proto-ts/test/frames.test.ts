import { Writer } from "../src/writer.ts";
import { compareBinaryFile } from './util.js';
import { setupDOMGlobals, generateTestFrames } from "./sample-frames.ts";
import { streamObserve } from "./stream-observer.ts";

// Set up DOM polyfills
setupDOMGlobals();

// Generate the standard test frame sequence
async function generateFrameData(): Promise<Uint8Array> {
    const [writer, stream] = Writer.create();
    const check = streamObserve(stream);

    // Generate frames
    await generateTestFrames(writer);
    writer.close();

    // Get all data using stream observer
    const analysis = await check();

    // Combine chunks into single array
    const result = new Uint8Array(analysis.totalBytes);
    let offset = 0;
    for (const chunkInfo of analysis.chunks) {
        result.set(chunkInfo.data, offset);
        offset += chunkInfo.data.length;
    }

    return result;
}

const streamBytes = await generateFrameData();
export { streamBytes };

console.log(`\nGenerated ${streamBytes.length} bytes total`);

// Compare against expected file using utility function
compareBinaryFile('frames-basic.bin', streamBytes, 'frames-basic');

