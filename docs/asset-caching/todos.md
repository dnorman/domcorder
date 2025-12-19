# Asset Caching TODOs

## Protocol Improvements

### AssetData Frame: Explicit Fetch Flag

**Current Behavior:**
- When an `AssetData` frame arrives with an empty buffer, the server infers that the client couldn't fetch the asset (likely due to CORS) and attempts to fetch it server-side.

**Proposed Improvement:**
- Add an explicit error/fetch flag to the `AssetData` frame instead of inferring the need to fetch from an empty buffer.
- This would make the intent clearer and distinguish between:
  - "asset is legitimately empty" (e.g., a 0-byte file)
  - "asset fetch failed, please fetch server-side" (CORS or network error)

**Benefits:**
- Clearer semantics in the protocol
- Better error handling and reporting
- Prevents false positives where legitimate empty assets trigger server-side fetches

**Location:** `server/src/storage.rs` - `process_asset_frame` method

### Optimize AssetReference MIME Type Lookup

**Current Behavior:**
- When processing `AssetReference` frames during recording, we call `get_asset_mime_type()` to fetch the MIME type from the metadata store.
- This creates latency as it requires a database query for every `AssetReference` frame.

**Proposed Optimization:**
- Use `asset_ref.mime` from the client's `AssetReference` frame if present.
- Only fall back to `get_asset_mime_type()` if the client didn't provide a MIME type.
- Consider: Is the client's MIME type trustworthy? (It comes from the original `Asset` frame, which may have been detected client-side or from HTTP headers.)

**Benefits:**
- Reduces database queries during recording (one per cached asset).
- Lowers latency for recording streams with many cached assets.
- Trade-off: Slight risk if client MIME type detection is inaccurate, but this is likely rare.

**Location:** `server/src/storage.rs` - `process_asset_reference_frame` method (lines ~537-540, ~584-587)

