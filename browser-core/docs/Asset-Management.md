# Asset Management in Domcorder

## Overview

Assets are external resources referenced by web pages, including images, fonts, stylesheets, and other media. Domcorder's asset management system addresses the fundamental challenge of recording and replaying web content that references external resources which may be:

- Fetched asynchronously
- Dynamically loaded
- Cross-origin or access-restricted
- Ephemeral or unavailable at playback time
- Relative to the original page's base URL

## Problem Statement

Web pages don't load atomically. When recording a page, several timing challenges arise:

1. **Asynchronous Loading**: DOM mutations occur before associated assets finish loading
2. **Network Uncertainty**: Asset fetches may be slow, fail, or be cross-origin restricted during recording
3. **Playback Isolation**: Recorded pages must replay faithfully without access to original URLs (offline, sandboxed, or time-shifted)
4. **URL Context Loss**: Relative URLs lose meaning when the recording is played in a different context

### Example Scenario

Consider recording a page that dynamically adds an image:

```javascript
const img = document.createElement('img');
img.src = '/images/logo.png';  // Relative URL
document.body.appendChild(img);
```

**Challenges:**
- The DOM mutation must be recorded immediately (for responsiveness)
- The image data won't be available until the fetch completes
- At playback time, `/images/logo.png` won't resolve correctly
- The original server may be unavailable or different

## Design Principles

### 1. Non-Blocking Recording

DOM structure changes are recorded immediately without waiting for asset data. This ensures:
- Responsive recording that doesn't freeze on slow networks
- Accurate capture of DOM mutation timing
- Recording can proceed even if some assets fail to load

### 2. Asset Decoupling

Assets are identified and tracked separately from the DOM structure through a placeholder system:
- Each unique asset URL receives a stable identifier
- DOM nodes reference assets by identifier, not by URL
- Asset data is captured and transmitted independently

### 3. Deferred Resolution

Playback doesn't require all assets upfront:
- The DOM can be rendered before all asset data arrives
- Assets resolve progressively as their data becomes available
- The page remains viewable while assets load

### 4. Self-Contained Recordings

Recordings must be portable and self-contained:
- All asset data is embedded in the recording stream
- No external network access required during playback
- Recordings can be replayed in different environments

## Architecture

### Recording Side

#### Asset Identification

When the recorder encounters an asset reference:

1. **Normalize the URL**: Resolve relative URLs to absolute using the document's base URI
2. **Assign an ID**: Generate a unique, monotonically increasing integer ID for each distinct URL
3. **Reuse IDs**: Multiple references to the same URL receive the same ID
4. **Replace Reference**: Substitute the original URL with the asset placeholder format: `asset:N`

**Example:**
```
Original:  <img src="https://example.com/logo.png">
Recorded:  <img src="asset:5">
```

#### Asset Placeholder Format

The format `asset:N` (where N is a non-negative integer) serves as a placeholder that:
- Survives DOM serialization
- Is easily parseable during playback
- Works in any attribute context (src, href, style, srcset, etc.)
- Can appear in CSS content within `url()` functions

#### Frame Emission Strategy

The recording emits two types of frames for asset-containing content:

**DOM Frames** (Keyframe, DomNodeAdded, DomAttributeChanged, etc.):
- Emitted immediately when DOM changes occur
- Contain asset placeholders (`asset:N`) instead of URLs
- Do not wait for asset data

**Asset Frames**:
- Emitted asynchronously after asset data is fetched
- Contains: asset ID, original URL (metadata), MIME type, and binary data
- May arrive before, during, or after related DOM frames
- Order relative to DOM frames is not guaranteed

#### Asset Frame Structure

```
Asset Frame:
  - asset_id: integer (unique identifier)
  - url: string (original source URL for reference)
  - mime: optional string (MIME type: "image/png", "text/css", etc.)
  - buf: byte array (the actual asset content)
```

### Playback Side

#### The URL Scheme Problem

The core challenge during playback is that `asset:N` is not a valid URL scheme recognized by browsers. An `<img src="asset:5">` element cannot load because browsers don't know how to resolve the `asset:` protocol.

**Solution:** Use the browser's Blob URL API to create synthetic, in-memory URLs that reference asset data.

#### Asset Resolution States

Each asset transitions through multiple states during playback:

**1. Unknown State**
- Asset ID has been encountered in DOM but no data exists yet
- A placeholder (empty blob) URL is created to satisfy browser URL requirements
- Elements are configured with the placeholder URL
- Elements are registered as "waiting" for this asset

**2. Pending State**
- The element is in the DOM with a placeholder blob URL
- The element has registered interest in the asset
- Asset data has not yet arrived
- From the user's perspective: image/resource appears as not-loaded or broken

**3. Resolved State**
- Asset frame has arrived with the actual data
- A new blob URL is created containing the real data
- All waiting elements are updated with the new blob URL
- Old placeholder blob URL is revoked
- From the user's perspective: resource appears normally

#### Resolution Flow

**Scenario A: DOM Arrives First (Common Case)**

```
Time  Event                         State
----  ----------------------------- -------------------------
T1    DomNodeAdded frame arrives    Create empty blob URL
      <img src="asset:5">           Set img.src to blob:xxx (empty)
                                    Register img as waiting for asset:5

T2    Asset frame arrives           Create new blob URL with data
      asset_id: 5                   Update img.src to blob:yyy (with data)
      buf: [binary data]            Revoke old blob:xxx
```

**Scenario B: Asset Arrives First (Less Common)**

```
Time  Event                         State
----  ----------------------------- -------------------------
T1    Asset frame arrives           Store asset data
      asset_id: 5                   Create blob URL immediately
      buf: [binary data]            

T2    DomNodeAdded frame arrives    Set img.src to blob:yyy (with data)
      <img src="asset:5">           No pending state needed
```

#### CSS Asset Dependencies

CSS files introduce a complication: they can reference other assets:

```css
.banner {
  background: url(asset:10);  /* CSS references another asset */
  font-family: CustomFont;
}

@font-face {
  font-family: CustomFont;
  src: url(asset:11);  /* Another nested reference */
}
```

**Challenge:** A CSS file (asset:9) contains references to other assets (10, 11). When asset:9 arrives, assets 10 and 11 may not have arrived yet.

**Solution:** Multi-stage resolution:

1. CSS asset arrives → scan for nested `asset:N` references
2. Replace nested references with pending blob URLs
3. Create blob for the CSS with pending references
4. When nested assets arrive → update CSS content with resolved blob URLs
5. Create new blob for the CSS with resolved references
6. Update all elements using the CSS

This creates a dependency graph where CSS assets can be updated multiple times as their dependencies resolve.

#### Asset Lifecycle Management

**Reference Counting:**
- Track how many DOM elements/stylesheets are using each asset
- Increment when an element binds to an asset
- Decrement when an element is removed from the DOM
- When count reaches zero, the asset can be released

**Blob URL Cleanup:**
- Blob URLs must be explicitly revoked to prevent memory leaks
- Each resolved blob replaces a pending blob → revoke the old one
- When an asset is no longer referenced → revoke its blob URL
- Blobs persist in memory until revoked, even if JavaScript references are gone

**DOM Mutation Tracking:**
- Monitor element removal from the DOM tree
- Detect when elements using assets are removed
- Automatically decrement reference counts
- Handle subtree removal (recursively process children)

## Special Cases and Design Considerations

### Multiple References to Same Asset

Multiple DOM elements may reference the same asset:

```html
<img src="asset:5">
<img src="asset:5">
<div style="background: url(asset:5)"></div>
```

**Design requirement:** All elements must be updated when asset:5 arrives.

**Implications:**
- Asset manager maintains a set of all elements waiting for each asset
- When the asset arrives, all registered elements are updated in a single operation
- Reference counting tracks total usage across all elements

### Attribute Types with Asset References

Assets can appear in various attribute contexts:

- **Simple URLs:** `src`, `href`, `poster`, `data`
- **Srcset syntax:** `srcset="asset:7 1x, asset:8 2x, asset:9 3x"`
- **Inline styles:** `style="background: url(asset:2); cursor: url(asset:3), auto"`
- **CSS content:** Within `<style>` elements and adopted stylesheets

**Design requirement:** Parser must handle all these contexts correctly, respecting the syntax of each attribute type.

### Empty or Failed Assets

During recording, asset fetches may fail (404, network error, CORS restriction):

**Options:**
1. Emit asset frame with zero-length buffer
2. Emit asset frame with original URL only (no binary data)
3. Don't emit asset frame at all

**Design decision:** Emit frame with metadata but empty buffer. During playback:
- If buffer is empty, use the original URL as fallback
- This allows partial replay even if some assets weren't captured
- Browser's normal loading behavior takes over (may fail or succeed depending on environment)

### Adopted Stylesheets Lifecycle

Adopted stylesheets (`document.adoptedStyleSheets`) are not part of the DOM tree:

```javascript
const sheet = new CSSStyleSheet();
sheet.replaceSync('.foo { background: url(asset:20); }');
document.adoptedStyleSheets = [sheet];
```

**Challenge:** No DOM mutation events when these are removed.

**Design requirement:** 
- Track adopted stylesheets separately from DOM elements
- Coordinate with stylesheet watcher to detect removal
- Release asset references when stylesheets are no longer adopted

### Dynamic Asset Reference Changes

During playback, an element's asset reference might change:

```javascript
img.src = "asset:5";  // Initial
// Later...
img.src = "asset:7";  // Changed
```

**Current behavior:** Old reference (asset:5) is not released.

**Consideration:** Should the system detect and handle this?
- **Pros:** Prevents reference count inflation, better memory management
- **Cons:** Requires monitoring all attribute mutations, performance cost
- **Decision:** Deferred as a future optimization

## Design Trade-offs

### Progressive Rendering vs. Completeness

**Trade-off:** Render immediately with pending assets vs. wait for assets before rendering

**Decision:** Prioritize progressive rendering
- **Rationale:** Better perceived performance, responsive playback
- **Cost:** Some visual artifacts as assets resolve (images appear blank then pop in)
- **Mitigation:** Could add "loading" indicators or placeholders (future enhancement)

### Memory vs. Computation

**Trade-off:** Keep all assets in memory vs. re-fetch from recording stream

**Decision:** Keep assets in memory with reference counting
- **Rationale:** Recordings may be streaming, re-fetching could be expensive
- **Cost:** Higher memory usage for asset-heavy pages
- **Mitigation:** Implement LRU eviction when memory pressure is detected (future)

### Update Granularity for CSS Assets

**Trade-off:** Update CSS blob on every nested asset vs. batch updates

**Decision:** Update immediately on each nested asset arrival
- **Rationale:** Simpler implementation, progressive rendering
- **Cost:** Multiple blob creations and element updates for CSS with many assets
- **Mitigation:** Could batch updates if assets arrive within small time window (future)

### Blob URL Lifecycle

**Trade-off:** Revoke blobs aggressively vs. keep them cached

**Decision:** Revoke pending blobs immediately, keep resolved blobs while referenced
- **Rationale:** Pending blobs are useless once resolved, resolved blobs needed by DOM
- **Cost:** Cannot reuse blobs if same asset needed again later
- **Mitigation:** Could implement blob cache with LRU eviction (future)

## Constraints and Requirements

### Browser API Constraints

**Blob URL Limitations:**
- Blob URLs are same-origin only (cannot be shared across domains)
- Blob URLs must be explicitly revoked to free memory
- No browser-native way to query blob URL contents

**MutationObserver Timing:**
- Mutations are delivered asynchronously in batches
- No guarantee of immediate notification on element removal
- Must process mutation records to find deeply nested removals

### Playback Performance Requirements

**Responsiveness:**
- DOM frames must be applied without blocking (< 16ms for 60fps)
- Asset resolution updates must be efficient (avoid full DOM scans)
- CSS re-processing should not cause visible pauses

**Memory Efficiency:**
- Should handle recordings with thousands of assets
- Must not leak memory during long playback sessions
- Reference tracking should have minimal overhead

### Recording Fidelity Requirements

**Completeness:**
- All asset types must be captured (images, fonts, CSS, videos, etc.)
- Nested asset references (CSS → images) must be preserved
- Failed asset fetches should be handled gracefully

**Accuracy:**
- Asset content must be byte-identical to original
- MIME types must be preserved for correct rendering
- Asset timing relative to DOM mutations should be preserved (best effort)

## Future Enhancements

### Smart Asset Caching

Implement intelligent caching strategies:
- LRU eviction when memory limits approached
- Prioritize assets currently visible in viewport
- Pre-fetch assets likely to be needed soon

### Content-Based Deduplication

Detect duplicate assets with different URLs:
- Hash asset content during recording
- Assign same ID to identical content
- Significant space savings for redundant assets

### Streaming Protocols for Large Assets

For video or large media files:
- Support chunked/streaming delivery
- Use Media Source Extensions for video playback
- Avoid loading entire asset into memory at once

### Asset Placeholder UI

Improve visual feedback during resolution:
- Show loading spinners for pending images
- Display skeleton screens for missing assets
- Provide fallback content or error messages

## Implementation Notes

This document describes the design and specification of the asset management system. The actual implementation may vary in specific details while maintaining compatibility with this design.

Key implementation files include:
- Asset tracking and ID assignment during recording
- Asset frame encoding/decoding in the protocol layer
- Asset resolution and blob URL management during playback
- DOM element materialization with asset binding

