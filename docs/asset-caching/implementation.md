# Asset Caching Implementation Plan

## Migration Strategy: Phased Approach

### Phase 1: Infrastructure & Abstractions
- Define the `MetadataStore` trait for asset and site indexing.
- Define the `BinaryStore` trait for physical asset storage and URL resolution.
- Implement the **SQLite** backend for `MetadataStore` (via `rusqlite`).
- Implement the **LocalFilesystem** backend for `BinaryStore`.
- Implement Dual Hashing logic (SHA-256 for manifest, SHA-384 for retrieval).
- Implement the **Late-Binding URL** logic: 
    - Write SHA-384 hashes to `.dcrr` files.
    - Resolve to full URLs via `BinaryStore::resolve_url` during playback.

### Phase 2: Profile Building & Manifests
- Implement the Cache Manifest Service.
- Start building Site/Page Asset Profiles:
    - Track frequency and size of all asset URLs seen per site in SQLite.
- Add logic to generate a prioritized manifest (Top $N$ largest/most common assets).
- Update the recording handshake to include `initial_url`.

### Phase 3: Cache-Aware Recording
- Implement `AssetReference` frames in the protocol (using SHA-256).
- Update the recorder to check the manifest before sending data.
- Implement the Server-Side Asset Fetcher for CORS-restricted assets (unauthenticated).
    - **Fetch Context**: Use the `User-Agent` from the WebSocket connection headers to impersonate the browser and avoid bot-detection by CDNs.

### Phase 4: HTTP Serving & Playback Optimization
- Implement the Asset HTTP Serving Endpoint (`/assets/{sha384}`).
- Update the player to prefer HTTP URLs over binary WebSocket data when a Retrieval Hash is available.
- Implement strict cache headers (immutable) for the HTTP endpoint.

## Design Decisions & Atomic Operations

### 1. Reliable Asset Persistence
To prevent partial or corrupt assets from entering the global cache:
- The server streams incoming `AssetData` to a **temporary file**.
- Once the full buffer is received, the server computes/verifies the hashes.
- Only after verification is the file moved to its permanent location in the `BinaryStore` (CAS) and the `MetadataStore` updated.

### 2. Connection Context
The server-side fetcher will leverage metadata from the initial WebSocket handshake (specifically the `User-Agent`) to ensure that proxied asset requests are consistent with the recording environment.
