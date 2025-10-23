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

// Generate TypeScript declarations
const tscResult = Bun.spawnSync(["tsc", "--emitDeclarationOnly", "--declaration", "--outDir", "dist"]);

if (tscResult.exitCode !== 0) {
  console.error("Failed to generate TypeScript declarations:");
  console.error(tscResult.stderr.toString());
  process.exit(1);
}

console.log("✓ TypeScript declarations generated successfully");

export {};

