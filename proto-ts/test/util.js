import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";

/**
 * Compare a buffer against an expected binary file, with optional blessing mode
 *
 * @param {string} filename - Path to the expected file (relative to test directory)
 * @param {Uint8Array} actualBuffer - The buffer to compare
 * @param {string} testName - Name of the test (used for blessing)
 * @returns {boolean} - True if comparison passes, false otherwise
 */
export function compareBinaryFile(filename, actualBuffer, testName) {
  // Get project root by going up from this util.js file location
  const currentDir = dirname(fileURLToPath(import.meta.url));  // .../proto-ts/test/
  const protoTsDir = dirname(currentDir);  // .../proto-ts/
  const projectRoot = dirname(protoTsDir);  // .../ (project root)
  const expectedFile = join(projectRoot, ".sample_data", "proto", filename);
  const shouldUpdate = process.env.PROTO_TEST_UPDATE === testName || process.env.PROTO_TEST_UPDATE === "true" || process.env.PROTO_TEST_UPDATE === "all";

  console.log(`\n🔍 Comparing binary file: ${testName}`);
  console.log(`   Expected file: ${filename}`);
  console.log(`   Actual size: ${actualBuffer.length} bytes`);

  let comparisonResult = false;

  if (existsSync(expectedFile)) {
    // Read expected file and compare
    const expectedBuffer = readFileSync(expectedFile);
    console.log(`   Expected size: ${expectedBuffer.length} bytes`);

    if (expectedBuffer.length === actualBuffer.length) {
      console.log("✓ File size matches");

      let matches = true;
      let firstMismatch = -1;

      for (let i = 0; i < actualBuffer.length; i++) {
        if (expectedBuffer[i] !== actualBuffer[i]) {
          matches = false;
          firstMismatch = i;
          break;
        }
      }

      if (matches) {
        console.log("✓ All bytes match - comparison passes!");
        comparisonResult = true;
      } else {
        console.log(
          `✗ Byte mismatch at position ${firstMismatch}: expected ${expectedBuffer[firstMismatch]}, got ${actualBuffer[firstMismatch]}`
        );
        console.log(`   Hex context around position ${firstMismatch}:`);

        // Show hex context around the mismatch
        const start = Math.max(0, firstMismatch - 8);
        const end = Math.min(actualBuffer.length, firstMismatch + 8);

        const expectedHex = Array.from(expectedBuffer.slice(start, end))
          .map((b, i) =>
            start + i === firstMismatch
              ? `[${b.toString(16).padStart(2, "0")}]`
              : b.toString(16).padStart(2, "0")
          )
          .join(" ");
        const actualHex = Array.from(actualBuffer.slice(start, end))
          .map((b, i) =>
            start + i === firstMismatch
              ? `[${b.toString(16).padStart(2, "0")}]`
              : b.toString(16).padStart(2, "0")
          )
          .join(" ");

        console.log(`   Expected: ${expectedHex}`);
        console.log(`   Actual:   ${actualHex}`);
        comparisonResult = false;
      }
    } else {
      console.log(
        `✗ File size mismatch: expected ${expectedBuffer.length}, got ${actualBuffer.length}`
      );
      comparisonResult = false;
    }
  } else {
    console.log("📝 No expected file found");
    comparisonResult = false;
  }

  // Handle blessing mode
  if (shouldUpdate) {
    // Ensure directory exists
    const dir = dirname(expectedFile);
    mkdirSync(dir, { recursive: true });

    writeFileSync(expectedFile, actualBuffer);
    console.log(
      `✨ Updated expected file (${actualBuffer.length} bytes)`
    );
    console.log(`   File: ${expectedFile}`);

    // In bless mode, we consider the test as passing since we just updated the expected result
    return true;
  } else if (!comparisonResult) {
    console.log(`\n💡 To update expected file, run:`);
    console.log(`   PROTO_TEST_UPDATE=${testName} bun run your_test_file.test.ts`);
    throw new Error(`Test failed - binary output doesn't match expected`);
  }

  return comparisonResult;
}

/**
 * Helper to show hex dump of a buffer for debugging
 *
 * @param {Uint8Array} buffer - Buffer to dump
 * @param {number} maxBytes - Maximum bytes to show (default: 64)
 * @returns {string} - Hex dump string
 */
export function hexDump(buffer, maxBytes = 64) {
  const bytes = buffer.slice(0, maxBytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}
