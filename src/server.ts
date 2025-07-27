// DomCorder Server - Serves injection script and handles recordings
import { serve } from "bun";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const PORT = 8547;
const RECORDINGS_DIR = "./recordings";

// Ensure recordings directory exists
if (!existsSync(RECORDINGS_DIR)) {
    mkdirSync(RECORDINGS_DIR);
}

const server = serve({
    port: PORT,

    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;

        // CORS headers for all responses
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Action",
        };

        // Handle preflight requests
        if (req.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // Serve the pre-built injection script
        if (path === "/inject.js") {
            const scriptPath = join(import.meta.dir, "../dist/inject.js");
            const file = Bun.file(scriptPath);

            if (await file.exists()) {
                return new Response(file, {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/javascript",
                        "Cache-Control": "no-cache", // Always get fresh version during development
                    },
                });
            } else {
                return new Response("Injection script not built. Run: bun run build", {
                    status: 404,
                    headers: corsHeaders
                });
            }
        }

        // Handle .dcrr file uploads
        if (path === "/upload" && req.method === "POST") {
            try {
                const action = req.headers.get("X-Action") || "unknown";
                const data = await req.arrayBuffer();
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                const filename = `${action}-${timestamp}.dcrr`;
                const filepath = join(RECORDINGS_DIR, filename);

                await Bun.write(filepath, data);

                console.log(`Saved ${action} recording: ${filename} (${data.byteLength} bytes)`);

                return new Response(JSON.stringify({
                    success: true,
                    filename,
                    size: data.byteLength
                }), {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                });
            } catch (error) {
                console.error("Upload failed:", error);
                return new Response(JSON.stringify({
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                }), {
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                });
            }
        }

        // List recordings
        if (path === "/recordings" && req.method === "GET") {
            try {
                const recordings = [];
                for await (const entry of new Bun.Glob("*.dcrr").scan(RECORDINGS_DIR)) {
                    const filepath = join(RECORDINGS_DIR, entry);
                    const stat = await Bun.file(filepath).stat();
                    recordings.push({
                        filename: entry,
                        size: stat.size,
                        created: stat.mtime,
                    });
                }

                recordings.sort((a, b) => b.created.getTime() - a.created.getTime());

                return new Response(JSON.stringify(recordings), {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                });
            } catch (error) {
                console.error("Failed to list recordings:", error);
                return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                });
            }
        }

        // Serve a specific recording file
        if (path.startsWith("/recording/")) {
            const filename = path.substring("/recording/".length);
            const filepath = join(RECORDINGS_DIR, filename);

            if (existsSync(filepath)) {
                const file = Bun.file(filepath);
                return new Response(file, {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/octet-stream",
                        "Content-Disposition": `attachment; filename="${filename}"`,
                    },
                });
            } else {
                return new Response("Recording not found", {
                    status: 404,
                    headers: corsHeaders
                });
            }
        }

        // Serve the player page
        if (path === "/player") {
            const playerPath = join(import.meta.dir, "player.html");
            const file = Bun.file(playerPath);

            if (await file.exists()) {
                return new Response(file, {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "text/html; charset=utf-8",
                    },
                });
            } else {
                return new Response("Player not found", {
                    status: 404,
                    headers: corsHeaders
                });
            }
        }

        // Simple status/info page
        if (path === "/" || path === "/status") {
            const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>DomCorder Server</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
        .bookmarklet { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .bookmarklet a { 
            display: inline-block; 
            background: #007acc; 
            color: white; 
            padding: 8px 16px; 
            text-decoration: none; 
            border-radius: 4px;
            font-weight: bold;
        }
        .recordings { margin-top: 30px; }
        .recording { padding: 10px; border: 1px solid #ddd; margin: 5px 0; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>DomCorder Server</h1>
    <p>Server running on port ${PORT}</p>
    
    <div class="bookmarklet">
        <h3>Bookmarklet</h3>
        <p>Drag this to your bookmarks bar:</p>
        <a href="javascript:(function(){const s=document.createElement('script');s.src='http://localhost:${PORT}/inject.js?t='+Date.now();document.head.appendChild(s);})()">&#128248; DomCorder</a>
    </div>
    
    <div class="recordings">
        <h3>Recent Recordings</h3>
        <p><a href="/player" style="color: #007acc; text-decoration: none;">🎬 Open Player</a></p>
        <div id="recordings-list">Loading...</div>
    </div>
    
    <script>
        fetch('/recordings')
            .then(r => r.json())
            .then(recordings => {
                const list = document.getElementById('recordings-list');
                if (recordings.length === 0) {
                    list.innerHTML = '<p>No recordings yet</p>';
                } else {
                    list.innerHTML = recordings.map(r => 
                        \`<div class="recording">
                            <strong>\${r.filename}</strong> - 
                            \${(r.size / 1024).toFixed(1)} KB - 
                            \${new Date(r.created).toLocaleString()}
                            <a href="/recording/\${r.filename}" style="margin-left: 10px;">Download</a>
                        </div>\`
                    ).join('');
                }
            })
            .catch(err => {
                document.getElementById('recordings-list').innerHTML = '<p>Error loading recordings</p>';
            });
    </script>
</body>
</html>`;

            return new Response(html, {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "text/html; charset=utf-8",
                },
            });
        }

        return new Response("Not Found", {
            status: 404,
            headers: corsHeaders
        });
    },

    error(error) {
        console.error("Server error:", error);
        return new Response("Internal Server Error", { status: 500 });
    },
});

console.log(`DomCorder server running on http://localhost:${PORT}`);
console.log(`Recordings will be saved to: ${RECORDINGS_DIR}`);
console.log(`Visit http://localhost:${PORT} for the bookmarklet and recordings`); 