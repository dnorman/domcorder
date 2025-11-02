# StyleSheetWatcher Specification

## Purpose

The StyleSheetWatcher is responsible for observing and reporting changes to stylesheets in a document. It detects both structural changes (additions, removals, reordering) and content mutations (rule insertions, deletions, replacements) to stylesheets, ensuring these changes are captured and reported in the correct order relative to DOM changes.

## Design Intent

The StyleSheetWatcher serves as a complementary component to the DomChangeDetector, focusing specifically on stylesheet-related changes that may not be fully captured by standard DOM mutation observation. While DomChangeDetector tracks structural DOM changes (node additions, removals, attribute changes), StyleSheetWatcher tracks:

1. **Stylesheet lifecycle changes**: When stylesheets are added to or removed from the document's stylesheet collection
2. **Stylesheet ordering changes**: When the order of stylesheets changes (which affects CSS cascade)
3. **Adopted stylesheet changes**: When stylesheets are adopted by Document or ShadowRoot via the `adoptedStyleSheets` API
4. **Stylesheet content mutations**: When CSS rules are programmatically inserted, deleted, or replaced within existing stylesheets

## Observing Stylesheet Collections

### Document Stylesheets (`document.styleSheets`)

The watcher must track the ordered list of stylesheets in `document.styleSheets`. This collection includes:

- Stylesheets linked via `<link rel="stylesheet">` elements
- Stylesheets from `<style>` elements
- Stylesheets from other sources that appear in the collection

**Requirements**:
- **Order preservation**: The order of stylesheets in `document.styleSheets` is critical for CSS cascade, so order must be preserved in reported changes
- **Detect additions**: When new stylesheets are added to the collection
- **Detect removals**: When stylesheets are removed from the collection
- **Detect reordering**: When stylesheets are reordered (same members, different order)
- **Detect membership changes**: When the set of stylesheets changes (additions and/or removals)

### Adopted Stylesheets (`adoptedStyleSheets`)

The watcher must track stylesheets adopted via the `adoptedStyleSheets` API on:

- The Document object
- ShadowRoot objects (optionally, on a per-root basis)

**Key Differences Between Adopted and Normal Stylesheets**:

1. **Ownership**: 
   - **Normal stylesheets**: Have an `ownerNode` (the DOM element that owns them, e.g., `<style>` or `<link>` element)
   - **Adopted stylesheets**: Have no `ownerNode` - they are programmatically associated with a Document or ShadowRoot via the `adoptedStyleSheets` property

2. **Detection**:
   - **Normal stylesheets**: Can be indirectly detected via MutationObserver watching for `<style>` or `<link>` element mutations
   - **Adopted stylesheets**: Cannot be detected via MutationObserver since there is no DOM element to observe. Must be detected via monkey-patching the `adoptedStyleSheets` setter or polling

3. **Identification**:
   - **Normal stylesheets**: Can be identified using the ID of their `ownerNode` (when available)
   - **Adopted stylesheets**: Cannot use `ownerNode` ID since they have none. Must be assigned a stable, unique identifier

4. **Lifecycle**:
   - **Normal stylesheets**: Lifecycle is tied to the DOM element - when the element is removed, the stylesheet is removed
   - **Adopted stylesheets**: Lifecycle is independent of DOM structure - they can be added/removed programmatically at any time

5. **Mutation Queuing**:
   - **Normal stylesheets**: Mutations must be queued until the `ownerNode`'s DomNodeAdded frame is emitted
   - **Adopted stylesheets**: Can be emitted immediately since they are not tied to a specific DOM node in the recording stream

**Requirements**:
- **Per-target tracking**: Each target (Document or ShadowRoot) must be tracked independently
- **Detect additions**: When new stylesheets are added to a target's `adoptedStyleSheets`
- **Detect removals**: When stylesheets are removed from a target's `adoptedStyleSheets`
- **ShadowRoot lifecycle**: Must support starting and stopping observation of specific ShadowRoots dynamically
- **Immediate emission**: Adopted stylesheet changes can be emitted immediately without queuing (they are not tied to DOM node emission)

## Observing Stylesheet Content Mutations

The watcher must optionally detect and report changes to the content of individual CSSStyleSheet objects when they are modified via CSSOM APIs:

- **Rule insertion**: When `insertRule()` is called on a stylesheet
- **Rule deletion**: When `deleteRule()` is called on a stylesheet
- **Sheet replacement**: When `replace()` or `replaceSync()` is called on a stylesheet

**Requirements**:
- **Content-level tracking**: Must capture the specific rule or content that was inserted, deleted, or replaced
- **Index preservation**: For insert and delete operations, must preserve the index at which the operation occurred
- **Optional feature**: Content mutation tracking should be configurable (not all use cases may require it)

## Detection Mechanisms

**Critical Constraint**: There is no direct DOM API to observe stylesheet changes. The DOM does not provide event listeners or observer APIs for stylesheet collections or CSSOM mutations. Therefore, the watcher must use indirect detection mechanisms, including monkey-patching of native APIs.

The watcher must support multiple detection mechanisms that can be used individually or in combination:

1. **MutationObserver**: Observe DOM mutations that may affect stylesheet collections (e.g., `<style>` or `<link>` element additions/removals). This is an indirect approach - it detects DOM changes that *may* result in stylesheet changes, but cannot directly observe the stylesheet collections themselves.
2. **Monkey-patching**: Intercept native APIs to capture changes. This is **required** for observing:
   - `adoptedStyleSheets` setter on Document and ShadowRoot (no other way to detect changes)
   - CSSOM methods (`insertRule()`, `deleteRule()`, `replace()`, `replaceSync()`) to detect content mutations
3. **Polling**: Periodically sample the stylesheet collections to detect changes. This serves as a fallback mechanism but is less efficient and may miss rapid changes.

**Requirements**:
- **Monkey-patching necessity**: Monkey-patching is not optional for adopted stylesheets or CSSOM mutations - it is the only way to detect these changes
- **Flexible configuration**: Each mechanism should be independently configurable where applicable
- **Fallback support**: Multiple mechanisms can be used simultaneously for redundancy
- **Performance consideration**: Polling should be optional and configurable in interval

## Event Types and Reporting

The watcher must emit events that describe the changes detected. Event types include:

1. **`document-style-sheets`**: Changes to `document.styleSheets`
   - Must include: current ordered list, added stylesheets, removed stylesheets, whether only order changed
2. **`adopted-style-sheets`**: Changes to `adoptedStyleSheets` on a target
   - Must include: target (Document or ShadowRoot), current list, added stylesheets, removed stylesheets
3. **`sheet-rules-insert`**: A rule was inserted into a stylesheet
   - Must include: stylesheet reference, stylesheet ID, rule text, insertion index
4. **`sheet-rules-delete`**: A rule was deleted from a stylesheet
   - Must include: stylesheet reference, stylesheet ID, deletion index
5. **`sheet-rules-replace`**: A stylesheet's content was replaced
   - Must include: stylesheet reference, stylesheet ID, new content text

**Requirements**:
- **Complete information**: Events must contain all necessary information for downstream processing
- **Stylesheet identification**: Each stylesheet must have a stable, unique identifier
- **Handler-based reporting**: Events should be reported via a configurable handler function

## Stylesheet Identification

Stylesheets must be uniquely identified for tracking and reporting purposes.

**Requirements**:
- **Non-adopted stylesheets**: Should use the ID of their `ownerNode` (the DOM element that owns the stylesheet) when available
- **Adopted stylesheets**: Must have a stable, unique identifier assigned (since they have no `ownerNode`)
- **ID stability**: IDs must remain stable for the lifetime of the stylesheet
- **ID assignment responsibility**: StyleSheetWatcher must NOT assign node IDs; it only reads existing node IDs from the NodeIdBiMap provided by DomChangeDetector

## Coordination with DomChangeDetector

The StyleSheetWatcher operates in coordination with DomChangeDetector and PageRecorder, but maintains clear separation of responsibilities.

### Separation of Concerns

- **DomChangeDetector**: Responsible for detecting DOM changes and assigning node IDs
- **StyleSheetWatcher**: Responsible for detecting stylesheet changes and reading node IDs (never assigning them)

### Causal Ordering Requirement

A critical requirement is that **DomNodeAdded frames must always precede stylesheet mutation events** for the same node. This ensures that during playback, the node exists in the target document before its stylesheet mutations are applied.

**Why Queuing is Essential**:

It is critically important that stylesheet mutation events are queued until we are certain that the recording stream contains the DomNodeAdded frame that causes the DOM node to exist. This requirement exists because:

1. **Playback correctness**: During playback, if a stylesheet mutation event is processed before the DomNodeAdded frame, the mutation will reference a node that doesn't exist yet in the target document, causing playback to fail or behave incorrectly.

2. **Race conditions**: There is a race condition between when a stylesheet mutation occurs (e.g., via `insertRule()`) and when the DomNodeAdded frame is emitted. The stylesheet mutation may happen:
   - Before the node is assigned an ID (node doesn't exist in the tracking system yet)
   - After the node is assigned an ID but before the DomNodeAdded frame is emitted (async gap)
   - After the DomNodeAdded frame is emitted (node is already in the recording stream)

3. **Stream ordering guarantee**: The recording stream must maintain causal ordering: the frame that creates a node must appear before any frames that modify that node's properties (including stylesheet mutations).

**Requirements**:
- **Queuing strategy**: Stylesheet mutations for nodes that haven't been emitted via DomNodeAdded must be queued. The queue must be maintained until we have confirmation that the DomNodeAdded frame exists in the recording stream.
- **Flush trigger**: When a DomNodeAdded frame is emitted, any queued stylesheet mutations for that node must be flushed and emitted. This confirms that the node now exists in the recording stream.
- **Async gap handling**: There is an asynchronous gap between when DomChangeDetector assigns a node ID and when the DomNodeAdded frame is actually emitted; mutations during this gap must also be queued, as the node still doesn't exist in the recording stream yet.
- **Node removal handling**: When a node is removed from the DOM, any queued mutations for that node must be discarded, as the node will never be added to the recording stream.

### Coordination Points

1. **Initial state**: All nodes present in the initial keyframe must be marked as "already emitted" so their stylesheet mutations are not queued
2. **Node emission notification**: PageRecorder must notify StyleSheetWatcher when a DomNodeAdded frame is emitted for a node
3. **Node removal notification**: PageRecorder must notify StyleSheetWatcher when a DomNodeRemoved frame is emitted for a node
4. **Pending node tracking**: PageRecorder must inform StyleSheetWatcher about nodes that have IDs but haven't been emitted yet (to handle the async gap)

## Memory Management

The watcher must manage memory efficiently, especially when tracking queued mutations.

**Requirements**:
- **Automatic cleanup**: When nodes are removed from the DOM, any tracking data for those nodes should be automatically cleaned up to prevent memory leaks
- **Weak references**: Use weak references where possible to allow garbage collection of removed nodes
- **No lingering references**: The watcher must not hold strong references to DOM nodes that have been removed

## Debouncing and Coalescing

The watcher may receive multiple rapid changes that should be reported efficiently.

**Requirements**:
- **Configurable debouncing**: Debouncing should be optional and configurable per target
- **Event coalescing**: Multiple changes to the same target within a debounce window may be coalesced into a single event
- **Per-target isolation**: Debouncing and coalescing should be isolated per target (Document, ShadowRoot)

## Edge Cases and Special Considerations

### Stylesheets Without Owner Nodes

Adopted stylesheets have no `ownerNode`, so they cannot be tracked via DOM mutations. They must be tracked via API interception or polling.

### ShadowRoot Lifecycle

ShadowRoots may be created and destroyed dynamically. The watcher must support:
- Starting observation of a ShadowRoot after it's created
- Stopping observation of a ShadowRoot when it's destroyed or no longer needed
- Handling ShadowRoots that are created and destroyed before observation begins

### Stylesheet Attachment State

Stylesheets may be in various states of attachment:
- **Attached**: The stylesheet is actively affecting the document
- **Detached**: The stylesheet exists but is not currently affecting the document

The watcher should only report mutations for attached stylesheets, as mutations to detached stylesheets are not meaningful.

### Stylesheet Cross-Origin Restrictions

Some stylesheet properties may be inaccessible due to cross-origin restrictions. The watcher should handle these cases gracefully without breaking the observation of other stylesheets.

### Rapid Successive Changes

When multiple stylesheet changes occur in rapid succession (e.g., multiple rule insertions), the watcher should capture all changes accurately, whether reported individually or coalesced.

