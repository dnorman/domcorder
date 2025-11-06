# Asset Playback and Recording Optimization

## Overview

This document describes the architectural design for improving the efficiency of asset handling in the Domcoreder on both the recording and playback sides.

The two high level improvements are:

1. A server side caching mechanism that avoids sending duplicate assets during recording.
2. An ability to serve assets over HTTP to enable the playback browser to cache assets.



## Problem Statement

**Problem 1: Duplicate Sending of Assets in Recording**: 
When recording a page in Domcorder:
1. The recorder identifies all external resources (images, stylesheets, fonts, media files) referenced by the page
2. Each asset is fetched and converted to binary data
3. Asset data is embedded in the recording stream and sent to the server
4. If the same site / page is recorded multiple times, the same assets are fetched and transmitted repeatedly.

This is wasteful. Frequently-used assets (logos, common stylesheets, shared fonts) are sent to the server over and over, consuming bandwidth and server storage unnecessarily.

**Problem 2: Duplicate Sending of Assets in Playback**:
When playing back a recording:
1. Assets are sent over the web socket protocol as Asset Frames.  
2. When received, the player creates a blob url from the binary data in the Asset Frame and that URL is inserted into the page.
3. The browser then loads the asset from the, already in memory, asset from the Blob URL.

This is also wasteful.  If a user plays back the same recording multiple times in a row, the same asset is sent to them over and over again via the web socket Asset Frames. Moreover if a user commonly watches several recordings of the same site, they are repeated sent the full set of assets that site uses.  The browser has no ability to "cache" these assets.  This also consumes unclear bandwidth on the playback.


## Key Requirements

1. **Server-Side Caching**: Cache assets on the server to avoid redundant storage
2. **Cache-Aware Recording**: Browser recorder must know which assets the server already has cached in order to avoid sending.
3. **Asset Usage**: The browser must still communicate to the server in the recording stream that an asset is being used in the page, it just may be able to avoid sending the asset, if the server has it cached.
4. **Per-Site/Page Asset Tracking**: Track which assets are commonly used on specific sites / pages
5. **Asset Versioning**: Handle assets that change over time (same URL, different content)
6. **Historical Asset Preservation**: Maintain older versions of assets for accurate playback of historical recordings
7. **Cross-Origin Handling**: When browser cannot fetch tainted resources, server should fetch them directly, if possible.
8. **Deduplication**: The server should only store the same asset once, regardless of how many sites / pages might reference it.
9. **Asset Stability Detection**: Certain assets that have a stable URL may not be appropriate to cache, if they are dynamically generated.  Ideally, the server will be able to detect static vs. dynamic assets, and only cache static assets.
10. **Asset Cache Serving**: When sending asset frames add the ability to choose between 1) sending the asset within the frame as a binary payload, or 2) send a URL that points back to an HTTP server where the asset can be served.

## Design Principles

### 1. Content-Based Asset Identity

Assets should be identified by their content hash, not just their URL. This enables:
- Deduplication of identical assets with different URLs
- Detection of asset changes (same URL, different content)
- Accurate version tracking across time

### 2. Dual Identity System

While content hash is the primary identifier, we maintain URL-based tracking for:
- Understanding which URLs map to which content versions
- Efficient cache lookups when the recorder knows the URL
- Tracking asset evolution over time


### 3. Proactive Cache Communication

The server should proactively inform the recorder about cached assets:
- Before recording starts, provide a cache manifest for the site / page
- During recording, acknowledge which assets are already cached
- Minimize unnecessary asset transmission


### 4. Asset Stability

Many assets like images, fonts, stylesheets, etc. are fairly static for a web site and do not change.  These assets are highly cacheable.  Other assets, may be dynamically generated based on various criteria.  For example, an image URL that shows an icon for the current weather.  The URL is the same, but the image is dynamically generated.  These assets should not be cached.

- The server must accumulate confidence that an asset is stable before caching it.
- The goal is to avoid accumulating a large amount of one off cached versions of things.
- We should consider if an LRU cache approach could work here.
  - If an element is cached the first time, and then never seen again, we might be able to purge it. Since it WAS in the original recording stream, we won't lose data.


### 5. Cache Longevity and Recording Archival
How long do we keep cached assets and how do we deal with archival.  When recordings are self contained, with all assets inline, then archiving the recording becomes easy. That recording's file can easily be moved to cold storage.  If the recordings reference items in the cache, that complicates two things:

1. How do we archive the recordings themselves?  Or how would we "send" the recording in a self contained way?  This may involve parsing the recording and re-inlining the assets.
2. It is likely that current recordings and hot cache items will need to be in hot storage.  Overtime, past recordings may be archived off, or even pruned out of the system.  How do we know when items in the cache can also be moved to cold storage.  That is to say, when all recordings that reference a subset of caches items has been moved to cold storage, or purged, how do we know that we can migrate them out of the active cache?  Do we need to track which recordings use which cached items?


### 6. Serving Assets over HTTP

On the playback side, if we serve assets (perhaps using their content hash) over HTTP, and we appropriately use cache related headers, then upon playback if a recording needs an asset that they have already received by watching another recording, the browser has a chance to leverage the browser cache, to avoid having to send that over the wire.

Additionally, if we augment asset frames to allow specifying an Asset URL instead of embedding the content in the frame, then the asset frames (and the Dom Nodes) will arrive much quicker.  Browsers are already optimized to render the DOM, and then fetch assets in parallel.  So we can take advantage of this parallel loading.


### 7. Backward Compatibility

Backwards compatibility is explicitly not a goal


## Architectural Components

### Conceptual Components

1. **Asset Cache Store**: Persistent storage for cached assets with metadata
2. **Cache Index**: Fast lookup structure mapping URLs and content hashes to cached assets
3. **Asset Version Tracker**: Tracks multiple versions of assets over time, at the minimum we should be able to tell what the most recently seen version is.
4. **Cache Manifest Service**: Generates cache manifests for sites / pages
5. **Server-Side Asset Fetcher**: Fetches assets when browser cannot (cross-origin)
6. **Recorder Cache Integration**: Client-side logic to check cache before fetching
7. **Asset HTTP Serving Endpoint**: The server will server stable asset URLs for cached assets.
8. **Asset Frames**: Asset frames would support binary embedding, vs reference by URL..

### Information Architecture

The system needs to track several types of information:

- **Asset Identity**: Each asset needs a stable identity based on content
- **URL Mapping**: Track which URLs map to which asset content
- **Version History**: Maintain multiple versions of assets that share the same URL
- **Usage Patterns**: Track which assets are commonly used on specific sites / pages
- **Recording Relationships**: Link recordings to the specific asset versions they used

## Strategic Approaches

### Asset Identification Strategy

**Content Hashing Approach**: Use cryptographic hash functions to identify assets by their content. This provides:
- Deterministic identification: same content always produces same hash
- Change detection: different content produces different hash
- Deduplication: identical assets with different URLs share the same hash

**Trade-offs**:
- Hash collision risk: extremely low with modern hash functions
- Computation cost: minimal overhead for one-time hash computation
- Storage efficiency: enables content-addressable storage

### Cache Storage Strategy

**Content-Addressable Storage**: Store assets by their content hash rather than URL. This provides:
- Automatic deduplication: identical content stored once regardless of URL
- Integrity verification: hash serves as both identifier and integrity check
- Version independence: different versions naturally stored separately

**Hybrid Indexing**: Maintain separate indexes for:
- URL-to-hash mapping: track which URLs map to which content hashes
- Hash-to-metadata mapping: track asset metadata (MIME type, size, timestamps)
- Version history: track all versions seen for each URL

**Trade-offs**:
- Storage efficiency vs. lookup complexity: content-addressable storage is efficient but requires hash-based lookups
- URL context preservation: maintaining URL-to-hash mapping preserves context while enabling deduplication

### Asset Versioning Strategy

**Version Detection**: When the same URL is seen with different content:
- Compare content hash with latest known version for that URL
- If hash differs, treat as new version
- Store both versions to support historical playback

**Version Selection for Playback**:
- New recordings: use latest version of each asset
- Historical recordings: use version that existed at recording time
- Version resolution: link recordings to specific asset versions through metadata

**Trade-offs**:
- Storage growth: preserving all versions increases storage requirements
- Playback accuracy: version preservation ensures accurate historical playback
- Version management: need strategy for managing version growth over time

### Site / Page Asset Profile Strategy

**Frequency Tracking**: Build profiles of which assets are commonly used on each site / page:
- Track asset frequency across multiple recordings of the same site / page
- Order assets by usage frequency
- Use profiles to pre-populate cache manifests

**Profile Building**:
- Initial recording: all assets are new, build initial profile
- Subsequent recordings: increment frequency for recurring assets, add new assets
- Profile decay: remove assets not seen in recent recordings

**Trade-offs**:
- Profile accuracy vs. storage: more detailed profiles provide better cache hints but require more storage
- Profile freshness: balance between stable profiles and keeping up with site / page changes
- Site / page identification: need stable way to identify sites / pages across recordings

### Cache Communication Strategy

**Pre-Recording Manifest**: Before recording starts:
- Recorder requests cache manifest for the site / page
- Server generates manifest based on site / page asset profile and current cache state
- Manifest includes: cached assets, their content hashes, version information

**During Recording**:
- Recorder checks manifest before fetching each asset
- For cached assets: send reference instead of full data
- For new assets: fetch and send as usual
- For cross-origin failures: request server to fetch

**Trade-offs**:
- Manifest size: detailed manifests provide better cache hints but require more bandwidth
- Manifest freshness: stale manifests may cause unnecessary fetches
- Cache verification: recorder may need to verify cached assets haven't changed

### Cross-Origin Asset Handling Strategy

**Browser Limitations**: When browser cannot fetch cross-origin assets:
- Browser restrictions prevent access to tainted resources
- CORS policies may block asset fetches
- Server-to-server requests bypass browser restrictions

**Server-Side Fetching**: When recorder cannot fetch an asset:
- Recorder requests server to fetch the asset
- Server uses its own HTTP client to fetch the asset
- Server checks cache before fetching
- Server returns fetch result or cached asset to recorder

**Trade-offs**:
- Server load: server fetching increases server load
- Network access: server needs network access to source URLs
- Rate limiting: need to respect source server's rate limits
- Error handling: server must handle fetch failures gracefully

## System Interactions

### Recording Initiation Flow

1. **Recorder requests cache manifest**: Recorder identifies the site / page and requests manifest from server
2. **Server generates manifest**: Server builds manifest based on site / page asset profile and current cache
3. **Recorder receives manifest**: Recorder now knows which assets server has cached
4. **Recording begins**: Recorder proceeds with recording, checking manifest for each asset

### Asset Discovery and Transmission Flow

**Current Flow (Uncached)**:
- Recorder discovers asset URL
- Recorder fetches asset
- Recorder sends asset data to server
- Server stores asset

**New Flow (Cache-Aware)**:
- Recorder discovers asset URL
- Recorder checks cache manifest
- If cached: Recorder sends asset reference (URL + expected hash) to server
- Server verifies it has the asset and confirms
- If not cached: Recorder fetches asset and sends data as before
- If cross-origin failure: Recorder requests server to fetch

### Cache Update Flow

1. **Asset arrives at server**: Either from recorder or server fetch
2. **Compute content hash**: Server computes hash of asset content
3. **Check existing cache**: Look up by hash and by URL
4. **Store if new**: If hash not seen before, store asset
5. **Update indexes**: Update URL-to-hash mapping, version history, site / page profiles
6. **Update cache manifest**: If site / page profile exists, update with new asset

### Playback Flow

1. **Recording playback starts**: Player begins processing recording frames
2. **Asset reference encountered**: Player sees asset reference in recording
3. **Asset lookup**: Player requests asset from server using reference
4. **Version resolution**: Server resolves asset version based on recording metadata
5. **Asset delivery**: Server delivers correct version of asset to player

## Design Decisions and Trade-offs

### Hash Verification Strategy

**Option 1: Recorder Verifies Hash**
- Recorder fetches asset and computes hash before sending reference
- **Pros**: Detects changes early, avoids unnecessary transmission
- **Cons**: Requires fetching asset anyway (defeats purpose of caching)

**Option 2: Server Verifies Hash**
- Recorder trusts manifest and sends reference immediately
- Server verifies it has the asset when reference arrives
- **Pros**: Recorder doesn't need to fetch asset
- **Cons**: Server may discover asset changed after recorder sends reference

**Option 3: Hybrid Approach**
- Recorder can optionally verify for critical assets
- Server always verifies on receipt
- **Pros**: Balance between efficiency and accuracy
- **Cons**: More complex logic

### Cache Eviction Strategy

When cache storage is limited, need to decide what to evict:

**Eviction Criteria**:
- **Never evict**: Assets referenced by existing recordings
- **High priority to keep**: Frequently-used assets, recent assets, small assets
- **Low priority**: Old, rarely-used assets, large assets

**Eviction Policies**:
- **LRU (Least Recently Used)**: Evict assets not accessed recently
- **Frequency-Based**: Keep frequently-used assets regardless of recency
- **Size-Aware**: Consider asset size in eviction decisions
- **Version-Aware**: Keep at least one version of each URL

**Trade-offs**:
- Storage efficiency vs. cache hit rate: aggressive eviction saves space but reduces cache effectiveness
- Version preservation vs. storage growth: keeping all versions ensures playback accuracy but increases storage

### Site / Page Identification Strategy

Sites / pages need to be identified consistently across recordings:

**Option 1: Full URL**
- Use complete URL including query parameters and fragments
- **Pros**: Precise identification
- **Cons**: Fragile, query params change frequently

**Option 2: Normalized URL**
- Use domain + path, normalize query parameters
- **Pros**: More stable than full URL
- **Cons**: May group unrelated pages together

**Option 3: Custom Site / Page Identifier**
- Allow explicit site / page identifier configuration
- **Pros**: Most flexible, most stable
- **Cons**: Requires manual configuration, may not be available

**Trade-offs**:
- Stability vs. precision: stable identifiers may group too many sites / pages, precise identifiers may fragment too much
- Automatic vs. manual: automatic identification is easier but less reliable

## Open Questions

### Architecture Questions

1. **Cache Scope**: Should asset caching be:
   - Per-server instance? (simpler, isolated)
   - Global across all servers? (requires distributed cache, more complex)

2. **Historical Playback**: How to link recordings to asset versions?
   - Store mapping in recording metadata? (explicit, requires metadata storage)
   - Infer from recording timestamp? (automatic, may be inaccurate)
   - Explicit version tracking in recording format? (requires format changes)

3. **Cache Invalidation**: How to handle cache invalidation?
   - Time-based expiration? (automatic, may evict too early)
   - Manual invalidation? (precise, requires manual intervention)
   - Version-based (automatic, relies on hash changes)

### Strategy Questions

1. **Manifest Generation**: When should cache manifests be generated?
   - On-demand when recorder requests? (fresh, adds latency)
   - Pre-generated periodically? (fast, may be stale)
   - Hybrid: pre-generate with on-demand refresh? (balance)

2. **Asset Deduplication**: Should deduplication happen:
   - Only within same site / page? (simpler, less effective)
   - Across all sites / pages? (more effective, requires global cache)
   - Within same domain? (middle ground)

3. **Version Retention**: How long should old versions be kept?
   - Forever? (accurate playback, unlimited storage growth)
   - Until no recordings reference them? (efficient, requires reference tracking)
   - Time-based expiration? (automatic, may break old recordings)

### Operational Questions

1. **Cache Unavailability**: What happens when cache is unavailable or fails?
   - Should recorder fall back to uncached behavior? (graceful degradation)
   - Should recording fail if cache unavailable? (strict mode)
   - Should server continue without cache? (permissive mode)

2. **Asset Discovery Timing**: How to handle assets discovered after manifest is sent?
   - Assets may be dynamically loaded during recording
   - Assets may be discovered in CSS content that hasn't been parsed yet
   - Should recorder send periodic manifest refresh requests?
   - Should server push updated manifest mid-recording?

3. **Dynamic Content**: How to handle sites / pages that change significantly between recordings?
   - Single Page Applications (SPAs) with dynamic routes
   - Pages with user-specific content
   - Pages that change based on time/date
   - Should these be considered "the same site / page" for caching purposes?

4. **Manifest Size**: How to handle sites / pages with hundreds or thousands of assets?
   - Large manifests increase bandwidth and latency
   - Should manifests be paginated or streamed?
   - Should manifests only include high-probability assets?
   - Should there be a manifest size limit?

5. **Concurrent Recordings**: How to handle multiple recorders recording the same site / page simultaneously?
   - Cache consistency: multiple recorders may see different asset states
   - Cache updates: how to handle concurrent cache writes
   - Manifest staleness: manifest may be invalidated while recording
   - Should each recorder get its own manifest snapshot?

6. **Asset Dependencies**: How to handle asset dependencies (CSS referencing images, fonts)?
   - Nested assets may not be known when parent asset is processed
   - CSS parsing reveals asset dependencies
   - Should manifest include known dependencies?
   - How to handle dependency discovery during recording?

7. **HTTP Conditional Requests**: Should we leverage HTTP conditional requests (ETags, If-Modified-Since)?
   - Could reduce bandwidth even when cache is empty
   - Provides server-side change detection
   - Requires recorder to maintain ETag state
   - Adds complexity to recorder logic

8. **Redirects and URL Changes**: How to handle HTTP redirects and URL changes?
   - Asset URL may redirect to different URL
   - Which URL should be used for cache lookup?
   - Should redirects be followed and cached?
   - How to link original URL to final URL in cache?

9. **Data URIs and Inline Assets**: Should inline assets (data URIs, inline styles) be cached?
   - Data URIs are already embedded in HTML/CSS
   - Inline styles may contain asset references
   - Caching could deduplicate repeated inline assets
   - Adds complexity for minimal benefit in many cases

10. **Recording Session Interruptions**: What happens if recording is interrupted?
    - Partial asset transmission may have occurred
    - Cache state may be inconsistent
    - Should partial assets be kept or discarded?
    - How to handle resume scenarios?

## Design Challenges

### Concurrency and Race Conditions

**Challenge**: Multiple recorders may be recording simultaneously, and assets may be discovered and cached concurrently.

**Issues**:
- Two recorders may discover the same new asset and both try to cache it
- Cache manifest may become stale while a recorder is using it
- Asset version may change between manifest generation and asset discovery
- Cache eviction may occur while a recorder is referencing an asset

**Considerations**:
- Need atomic cache operations to prevent race conditions
- Manifest snapshots may need version numbers or timestamps
- Cache locks or optimistic concurrency control may be necessary
- Need to handle "cache miss" scenarios gracefully when race conditions occur

### Timing and Synchronization

**Challenge**: Assets are discovered asynchronously during recording, but manifest is generated before recording starts.

**Issues**:
- Assets discovered during recording won't be in the initial manifest
- Assets may be discovered in CSS that hasn't been parsed yet
- Dynamic asset loading (lazy loading, on-demand) may occur after manifest is sent
- Asset dependencies may not be known upfront

**Considerations**:
- Manifest may need to be updated or refreshed during recording
- Recorder may need to fall back to uncached behavior for late-discovered assets
- Server may need to push manifest updates mid-recording
- Need strategy for handling assets not in manifest

### Cache Consistency

**Challenge**: Ensuring cache consistency across multiple recorders and recording sessions.

**Issues**:
- Cache may be updated while a recorder is using a manifest
- Asset versions may change between recordings
- Cache eviction may remove assets still referenced by active recordings
- Multiple servers may have different cache states in distributed systems

**Considerations**:
- Need cache versioning or timestamping
- Manifest should include version information
- Need to detect and handle cache inconsistencies
- May need distributed cache coordination for multi-server deployments

### Partial Failures and Recovery

**Challenge**: Handling partial failures in asset fetching, caching, or transmission.

**Issues**:
- Recorder may fail mid-recording, leaving partial cache state
- Server fetch may fail for cross-origin assets
- Network interruption may cause incomplete asset transmission
- Cache write may fail while asset is being stored

**Considerations**:
- Need idempotent cache operations
- Should handle graceful degradation when cache operations fail
- May need retry logic for failed fetches
- Should clean up partial state on failures

### Asset Change Detection

**Challenge**: Detecting when an asset has changed even though the URL is the same.

**Issues**:
- Asset may change between manifest generation and recorder checking it
- Asset may change during recording session
- HTTP ETags may not be available or reliable
- Content hash verification requires fetching the asset (defeating cache purpose)

**Considerations**:
- Need to balance cache efficiency with change detection accuracy
- May need periodic re-validation of cached assets
- HTTP conditional requests may help but add complexity
- Server-side change detection may be necessary

### Large Scale Considerations

**Challenge**: System must scale to handle many sites / pages, many assets, and many recordings.

**Issues**:
- Cache storage may grow unbounded over time
- Site / page asset profiles may become very large
- Manifest generation may become slow for sites / pages with many assets
- Cache lookups may become slow as cache grows

**Considerations**:
- Need efficient cache lookup structures
- May need cache partitioning or sharding
- Profile size limits or pruning may be necessary
- May need distributed caching for scale

### Backwards Compatibility

**Challenge**: System must work with existing recordings and support gradual migration.

**Issues**:
- Existing recordings don't have cache information
- Old recordings may reference assets that have been evicted
- Recording format may need to support both cached and uncached modes
- Players must handle both cached and uncached recordings

**Considerations**:
- Need graceful fallback when cache information is missing
- Recording format should be extensible for cache metadata
- Players should handle missing assets gracefully
- Migration should be transparent to users

### Edge Cases and Special Scenarios

**Challenge**: Handling unusual or edge case scenarios that may not be common but must be handled correctly.

**Issues**:
- Assets with extremely long URLs
- Assets with unusual MIME types
- Assets that change frequently (every request)
- Assets that require authentication
- Assets behind firewalls or VPNs
- Assets that are no longer available at source URL
- Hash collisions (extremely rare but theoretically possible)

**Considerations**:
- Need to handle all edge cases gracefully
- Should have fallback mechanisms for unusual scenarios
- Should log and monitor edge cases for improvement
- May need special handling for certain asset types

### Protocol and Format Evolution

**Challenge**: Design must accommodate future changes and protocol evolution.

**Issues**:
- Recording format may need to change to support caching
- Protocol versioning may be necessary
- Cache manifest format may evolve
- Need to support multiple protocol versions simultaneously

**Considerations**:
- Design should be extensible
- Version negotiation may be necessary
- Should support gradual protocol upgrades
- Need to maintain compatibility across versions

## Security Considerations

### Cache Security

1. **Cache Poisoning**: Prevent malicious assets from polluting cache
   - Validate asset MIME types
   - Size limits on cached assets
   - Rate limiting on asset fetches

2. **Sensitive Data**: Assets may contain sensitive information
   - Consider encryption at rest
   - Access control for cache
   - Audit logging of cache access

3. **URL Validation**: Validate URLs before fetching
   - Prevent SSRF attacks
   - Whitelist allowed domains? (optional)
   - Validate URL format

### Cross-Origin Fetching Security

1. **Server-to-Server Requests**: Server-to-server requests bypass CORS
   - Be respectful of source servers
   - Implement rate limiting
   - Respect robots.txt? (optional)

2. **Authentication**: Some assets may require authentication
   - Handle authentication headers carefully
   - Don't expose credentials in logs
   - Consider per-asset authentication

## Performance Considerations

### Cache Performance

1. **Lookup Performance**: Fast cache lookups are critical
   - Maintain in-memory indexes for hot paths
   - Use efficient data structures for lookups
   - Consider distributed caching for scalability

2. **Storage Efficiency**: Large assets require efficient storage
   - Consider compression for text assets (CSS, JS)
   - Streaming for large assets
   - CDN integration for future scalability

3. **Network Efficiency**: Minimize round trips
   - Batch cache manifest requests
   - Pipeline asset reference acknowledgments
   - Compress cache manifest responses

### System Performance

1. **Memory Usage**: Cache metadata should be memory-efficient
   - Use compact data structures
   - Paginate cache manifest responses for large pages
   - Lazy-load asset metadata

2. **Concurrency**: System must handle concurrent recordings
   - Cache updates must be thread-safe
   - Manifest generation should be efficient
   - Asset fetching should be rate-limited

## Future Enhancements

### Advanced Caching Strategies

1. **Predictive Caching**: Pre-fetch assets likely to be needed
   - Based on site / page asset profiles
   - Based on user navigation patterns
   - Pre-populate cache before recording starts

2. **Asset Compression**: Compress assets before caching
   - Especially text assets (CSS, JS)
   - Consider image optimization
   - Balance compression ratio vs. CPU cost

3. **CDN Integration**: Use CDN for cached assets
   - Reduce server load
   - Improve global performance
   - Edge caching for distributed systems

### Analytics and Optimization

1. **Usage Analytics**: Track asset usage patterns
   - Most frequently used assets
   - Asset change frequency
   - Cache hit rates
   - Bandwidth savings

2. **Multi-Tenancy**: Support multiple organizations/projects
   - Isolated caches per tenant
   - Shared common assets (e.g., CDN assets)
   - Per-tenant cache policies

## Migration Strategy

### Phased Approach

**Phase 1: Infrastructure** (No behavior change)
- Implement cache storage infrastructure
- Implement content hashing
- Add cache manifest generation (not yet used by recorders)
- Add asset version tracking

**Phase 2: Optional Cache Usage**
- Add cache manifest request to recorder (optional)
- Recorder can use cache manifest if available
- Server caches all assets but doesn't skip transmission yet
- Build site / page asset profiles

**Phase 3: Cache-Aware Recording**
- Recorder checks cache before fetching
- Asset reference frames implemented
- Server skips storage for cached assets
- Cross-origin asset fetching implemented

**Phase 4: Optimization**
- Cache eviction policies
- Cache warming (pre-populate based on site / page profiles)
- Performance monitoring and tuning

## References

- [Existing Asset Management Documentation](../browser-core/docs/Asset-Management.md)
- [Domcorder Design Document](./DESIGN.md)
- HTTP ETag specification: RFC 7232
- Content-Addressable Storage patterns
