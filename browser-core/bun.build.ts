#!/usr/bin/env bun
/// <reference types="bun" />

// Build script to create three separate bundles:
// 1. Full bundle (everything)
// 2. Recorder bundle (recorder + common)
// 3. Player bundle (player + common)

const builds = [
  {
    entrypoint: "src/index.ts",
    outfile: "dist/index.js",
    name: "full"
  },
  {
    entrypoint: "src/recorder.ts",
    outfile: "dist/recorder.js",
    name: "recorder"
  },
  {
    entrypoint: "src/player.ts",
    outfile: "dist/player.js",
    name: "player"
  }
];

console.log("Building browser-core bundles...\n");

for (const { entrypoint, outfile, name } of builds) {
  console.log(`Building ${name} bundle: ${outfile}`);
  
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: "dist",
    target: "browser",
    format: "esm",
    minify: false,
    splitting: false,
    naming: {
      entry: outfile.replace("dist/", "")
    }
  });

  if (!result.success) {
    console.error(`Failed to build ${name} bundle:`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  
  console.log(`✓ ${name} bundle built successfully`);
}

console.log("\nAll bundles built successfully!");
console.log("\nGenerating TypeScript declarations...");

// Use rollup to bundle TypeScript declarations
const rollupResult = Bun.spawnSync([
  "bunx",
  "rollup",
  "-c",
  "rollup.dts.config.js"
]);

if (rollupResult.exitCode !== 0) {
  console.error("Failed to generate TypeScript declarations:");
  console.error(rollupResult.stderr.toString());
  process.exit(1);
}

console.log("✓ TypeScript declarations generated successfully");

// Clean up the old subdirectories that are no longer needed
console.log("\nCleaning up old type definition directories...");
const fs = await import("fs");
const dirsToRemove = ["dist/recorder", "dist/player", "dist/common"];

for (const dir of dirsToRemove) {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
    console.log(`✓ Removed ${dir}`);
  } catch (error) {
    // Directory might not exist, that's okay
  }
}

console.log("\n✓ Build complete!");

export {};

