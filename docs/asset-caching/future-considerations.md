# Asset Caching: Future Considerations

This document tracks complex requirements, long-term improvements, and design trade-offs that are deferred from the initial implementation.

## 1. Recording Portability & Export
**Problem**: Recordings (.dcrr files) depend on an external Asset CAS and SQLite index. Moving a recording file to another server or a local machine will result in broken assets during playback.

**Potential Solutions**:
- **Bundling Tool**: A utility that reads a .dcrr file, fetches all referenced assets from the CAS, and creates a "Self-Contained Recording" by re-inlining the binary data.
- **Remote CAS Proxy**: Allowing the player to fetch assets from the original server's HTTP endpoint even if the .dcrr file is hosted elsewhere.

## 2. Garbage Collection (GC)
**Problem**: The global CAS will grow indefinitely as every asset seen is stored.

**Potential Solutions**:
- **Reference Counting**: Track which recording IDs use which `sha384_hash`. Delete the asset from CAS when the count reaches zero.
- **LRU Eviction**: If disk space is low, delete the least recently accessed assets.

## 3. Advanced Asset Stability & Filtering
**Problem**: Highly dynamic URLs can bloat the index without providing caching benefits.

**Potential Solutions**:
- **Pattern Matching**: Identify dynamic URLs using regex (e.g., timestamps in query params).
- **TTL for Ephemeral Assets**: Purge assets that haven't been seen recently and are only referenced by old/deleted recordings.

## 4. Manifest Refresh & Late Discovery
**Problem**: In long sessions (SPAs), new large assets might be discovered that weren't in the initial "Top N" manifest.

**Potential Solutions**:
- **Query Pattern**: For any asset larger than a specific threshold not in the manifest, the recorder could send a `CheckAsset(sha256)` probe. The server would respond with `HasAsset(bool)`, allowing the recorder to skip the upload if the server already has the asset from a different site or a previous version.

## 5. Privacy & Deduplication Boundaries
**Problem**: Global deduplication allows for maximum efficiency but introduces a "Privacy Probing" risk. If a user can guess a SHA-256 hash, they can confirm if that asset exists on the server.

**Trade-off Considerations**:
- **Global vs. Site-Scoped**: Should the `resolve_hashes` check be limited to the current `site_origin`? This would prevent cross-site probing but would force the server to store multiple copies of common libraries (jQuery, etc.) if they appear on multiple sites.
- **User-Scoped Caching**: Scoping the cache to specific users or organizations to further isolate data.
- **Dual-Hash Security**: While the SHA-256 confirms existence, the SHA-384 requirement still prevents unauthorized *downloading* of the asset data.
