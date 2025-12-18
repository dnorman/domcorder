# Asset Caching Requirements

## Overview

This document defines the requirements for improving the efficiency of asset handling in Domcorder on both the recording and playback sides.

The three high-level goals are:
1. A server-side caching mechanism that avoids sending duplicate assets during recording, by informing the recorder of what assets are already cached.
2. Deduplication of cached assets on the server side to minimize disk usage.
3. The ability to serve assets over HTTP to enable the playback browser to cache assets.

## Problem Statement

### Problem 1: Duplicate Sending of Assets in Recording
When recording a page in Domcorder:
1. The recorder identifies all external resources (images, stylesheets, fonts, media files) referenced by the page.
2. Each asset is fetched and converted to binary data.
3. Asset data is embedded in the recording stream and sent to the server.
4. If the same site/page is recorded multiple times, the same assets are fetched and transmitted repeatedly.

This is wasteful. Frequently-used assets (logos, common stylesheets, shared fonts) are sent to the server over and over, consuming bandwidth and server storage unnecessarily.

### Problem 2: Duplicate Storage of Assets
When recording:
1. The same assets are stored in the recording stream (.dcrr file) over and over again, wasting disk space.
2. Large assets (e.g., videos or high-res images) significantly bloat the recording files.

### Problem 3: Duplicate Sending of Assets in Playback
When playing back a recording:
1. Assets are sent over the WebSocket protocol as Asset Frames.
2. When received, the player creates a blob URL from the binary data in the Asset Frame.
3. The browser then loads the asset from memory via the blob URL.

This is also wasteful. If a user plays back the same recording multiple times, the same asset is sent repeatedly via Asset Frames. The browser cannot leverage its native cache for these assets.

## Key Requirements

1. **Global Server-Side Caching**: Cache all assets seen on the server in a Content-Addressable Store (CAS). No asset data should remain in the final recording stream; it should be replaced by references.
2. **Cache-Aware Recording**: The browser recorder must know which assets the server already has cached to avoid redundant transmission. The initial manifest sent to the recorder is limited to a reasonable number of the largest and/or most common assets.
3. **Asset Usage Tracking**: The recorder must still communicate to the server that an asset is being used, even if the data itself is not sent.
4. **Per-Site/Page Asset Tracking**: Track which assets are commonly used on specific sites or pages for manifest prioritization.
5. **Asset Versioning**: Handle assets that change over time (same URL, different content) by storing them as distinct content-based versions.
6. **Historical Asset Preservation**: Maintain older versions of assets for accurate playback of historical recordings.
7. **Cross-Origin Handling**: When the browser cannot fetch tainted resources due to CORS, the server should attempt to fetch them directly. (Assumption: These requests are likely to be unauthenticated).
8. **Deduplication**: The server should only store the same asset once (content-based), regardless of how many sites/pages reference it.
9. **Asset Stability Detection**: Track asset changes over time to prioritize stable (static) assets in the cache manifest.
10. **Asset Cache Serving**: Support sending assets via URLs pointing to an HTTP server for browser caching during playback.

## Security Requirements

1. **Cache Poisoning Prevention**: Prevent malicious assets from polluting the cache (MIME validation, size limits).
2. **SSRF Protection**: Validate URLs before the server attempts to fetch assets directly.
3. **Access Control**: Ensure that cached assets are only accessible to authorized users/sessions.
4. **Manifest Probing Protection**: A user (who has access to the recorder) should not be able to retrieve assets from the server by looking at the cache manifest. This is achieved via a dual-hash (SHA-256 for manifest, SHA-384 for retrieval) system.
