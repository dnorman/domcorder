// Build script for DomCorder injection script
import { watch } from "fs";
import { join } from "path";

const SRC_DIR = "./src";
const DIST_DIR = "./dist";
const ENTRY_POINT = join(SRC_DIR, "capture/bookmarklet.ts");
const OUTPUT_FILE = join(DIST_DIR, "inject.js");

async function build() {
    console.log("Building injection script...");

    try {
        const result = await Bun.build({
            entrypoints: [ENTRY_POINT],
            outdir: DIST_DIR,
            naming: "inject.js",
            target: "browser",
            minify: process.env.NODE_ENV === "production",
            sourcemap: process.env.NODE_ENV !== "production" ? "external" : "none",
        });

        if (!result.success) {
            console.error("Build failed:");
            for (const log of result.logs) {
                console.error(log);
            }
            return false;
        }

        console.log(`✅ Built injection script: ${OUTPUT_FILE}`);
        return true;
    } catch (error) {
        console.error("Build error:", error);
        return false;
    }
}

async function watchMode() {
    console.log("👀 Watching for changes...");

    // Initial build
    await build();

    // Watch source files
    const watcher = watch(SRC_DIR, { recursive: true }, async (eventType, filename) => {
        if (filename && (filename.endsWith('.ts') || filename.endsWith('.js'))) {
            console.log(`📝 ${filename} changed, rebuilding...`);
            await build();
        }
    });

    // Handle cleanup
    process.on('SIGINT', () => {
        console.log('\n👋 Stopping watcher...');
        watcher.close();
        process.exit(0);
    });
}

// CLI handling
const args = process.argv.slice(2);

if (args.includes('--watch') || args.includes('-w')) {
    watchMode();
} else {
    build().then(success => {
        process.exit(success ? 0 : 1);
    });
} 