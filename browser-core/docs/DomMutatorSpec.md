# Dom Mutator Specification

The purpose of the Dom Mutator is to consume the ordered stream of operations emitted by a DomChangeDetector and apply those operations to a target document, maintaining synchronization between the source document (monitored by the DomChangeDetector) and the target document.

## Goal

- The DomMutator receives an ordered sequence of operations from a DomChangeDetector.
- It applies these operations to a target document that initially matches the source document.
- After applying all operations in order, the target document should match the current state of the source document.
- The DomMutator relies on node IDs (as defined in the DomChangeDetector specification) to identify and locate nodes in the target document.

## Core Responsibilities

1. **Operation Application**: Process each operation type (`insert`, `remove`, `updateAttribute`, `removeAttribute`, `updateText`) and apply it to the target DOM.
2. **Node ID Mapping**: Maintain a bidirectional mapping between node IDs and DOM nodes in the target document.
3. **Node Tree Management**: Track the insertion and removal of nodes, ensuring the node ID map accurately reflects the current state of the target document.
4. **Error Handling**: Gracefully handle cases where operations cannot be applied due to ordering issues, missing nodes, or other errors.

## Operations

The DomMutator must handle the following operation types, as defined by the DomChangeDetector specification:

### insert Operation

**Structure**: `{ op: 'insert'; parentId: number; index: number; node: Node }`

**Behavior**:
- Locate the parent node using `parentId` via the node ID map.
- Validate that the `index` is within valid bounds:
  - If `index` equals `parent.childNodes.length`, this indicates inserting at the end (append), which is valid.
  - If `index` is greater than `parent.childNodes.length`, this is an error condition (synchronization issue).
  - If `index` is negative, this is an error condition.
- Insert the provided `node` into the parent's child list at the specified `index` position using `parent.insertBefore(node, parent.childNodes[index] || null)`.
- After insertion, adopt all nodes in the inserted subtree into the node ID map. This includes:
  - The inserted node itself (if it has a node ID)
  - All descendant nodes (if they have node IDs)
- The inserted node and its subtree should already have node IDs assigned (from the DomChangeDetector), and these IDs must be preserved.

**Preconditions**:
- The parent node identified by `parentId` must exist in the target document and node ID map.
- The node to be inserted must have a node ID already assigned.
- The `index` must be a valid position (0 <= index <= parent.childNodes.length).

**Error Handling**:
- If the parent node does not exist, this is an error condition (likely an ordering issue).
- If the node to be inserted lacks a node ID, this is an error condition.
- If the index is out of bounds (index < 0 or index > parent.childNodes.length), this is an error condition indicating a synchronization issue between source and target documents.

### remove Operation

**Structure**: `{ op: 'remove'; nodeId: number }`

**Behavior**:
- Locate the node to remove using `nodeId` via the node ID map.
- If the node exists and has a parent, remove it from its parent using `parentNode.removeChild()`.
- Remove the node and all nodes in its subtree from the node ID map.
- Clear the node ID property from all removed nodes.

**Preconditions**:
- The node identified by `nodeId` should exist in the target document and node ID map.
- The node should have a parent node (unless it's the root node or already detached).

**Error Handling**:
- If the node does not exist in the node ID map, this indicates an ordering issue (the node was never added or was already removed). Log the error but continue processing. Do not throw an exception.
- If the node exists but has no parent (already detached), still remove it from the node ID map. This may occur if:
  - The node was already removed by a previous operation
  - The node is the document root
  - The operation sequence contains redundant removals

### updateAttribute Operation

**Structure**: `{ op: 'updateAttribute'; nodeId: number; name: string; value: string }`

**Behavior**:
- Locate the node using `nodeId` via the node ID map.
- Verify the node is an Element node (nodeType === Node.ELEMENT_NODE).
- Call `element.setAttribute(name, value)` to update the attribute.

**Preconditions**:
- The node identified by `nodeId` must exist in the target document.
- The node must be an Element node.

**Error Handling**:
- If the node does not exist, this is an error condition.
- If the node is not an Element, silently skip the operation (attributes can only exist on Element nodes).

### removeAttribute Operation

**Structure**: `{ op: 'removeAttribute'; nodeId: number; name: string }`

**Behavior**:
- Locate the node using `nodeId` via the node ID map.
- Verify the node is an Element node (nodeType === Node.ELEMENT_NODE).
- Call `element.removeAttribute(name)` to remove the attribute.

**Preconditions**:
- The node identified by `nodeId` must exist in the target document.
- The node must be an Element node.

**Error Handling**:
- If the node does not exist, this is an error condition.
- If the node is not an Element, silently skip the operation.
- If the attribute does not exist, `removeAttribute()` is idempotent and safe to call.

### updateText Operation

**Structure**: `{ op: 'updateText'; nodeId: number; ops: StringMutationOperation[] }`

**Behavior**:
- Locate the node using `nodeId` via the node ID map.
- Verify the node is a CharacterData node (Text, Comment, or CDATASection node).
- Get the current `textContent` of the node.
- Apply the sequence of `StringMutationOperation`s to transform the current text content to the target text content.
- Set the node's `textContent` to the resulting value.

**Preconditions**:
- The node identified by `nodeId` must exist in the target document.
- The node must be a CharacterData node (Text, Comment, or CDATASection).

**Error Handling**:
- If the node does not exist, this is an error condition.
- If the node is not a CharacterData node, this is an error condition.
- The string mutation operations must be applied in order. If an operation cannot be applied (e.g., index out of bounds), this indicates a synchronization issue.

## Node ID Map Management

The DomMutator maintains a `NodeIdBiMap` that provides bidirectional mapping between node IDs and DOM nodes.

### Node ID Map Lifecycle

1. **Initialization**: The node ID map is initialized with the target document's initial state. All nodes in the target document should already have node IDs assigned, matching the source document.

2. **Insertion**: When a node is inserted:
   - The node and its subtree already have node IDs (assigned by the DomChangeDetector during detection).
   - The DomMutator adopts these nodes into the node ID map using `adoptNodesFromSubTree()`.
   - All nodes in the subtree are recursively added to the map.

3. **Removal**: When a node is removed:
   - The node and its entire subtree are removed from the node ID map using `removeNodesInSubtree()`.
   - The node ID property is cleared from all removed nodes.
   - These node IDs must not be reused for new nodes.

### Node ID Lookup

- The DomMutator uses `getNodeById(nodeId)` to locate nodes in the target document.
- If a node ID is not found, this indicates:
  - An ordering issue (operation arrives before the node is inserted)
  - The node was already removed
  - A synchronization error

## Operation Ordering

### Causal Ordering Guarantee

The DomMutator expects operations to arrive in causal order (as guaranteed by the DomChangeDetector). This means:

- Operations that depend on a node existing must arrive after the operation that adds that node.
- Operations on a node must arrive before the operation that removes that node.
- The order of operations must respect these causal dependencies.

### Sequential Processing

- The DomMutator processes operations sequentially in the order they are provided.
- Operations are applied one at a time as they arrive in the stream.

### Idempotency Considerations

- `removeAttribute` is naturally idempotent (calling it when the attribute doesn't exist has no effect).
- Other operations are not idempotent and must be applied exactly once in the correct order.

## Error Handling Philosophy

The DomMutator should be resilient to minor ordering issues while detecting and reporting more serious synchronization problems:

1. **Non-Fatal Errors** (log and continue):
   - Attempt to remove a node that doesn't exist in the node ID map
   - Attempt to remove a node that's already detached from the DOM
   - These may occur due to redundant operations or minor ordering issues

2. **Silent Skipping** (appropriate for certain cases):
   - Attempt to update/remove an attribute on a non-Element node
   - These operations simply don't apply to the node type

3. **Fatal Errors** (should be logged as errors, but implementation may choose whether to throw):
   - Attempt to insert a node into a parent that doesn't exist
   - Attempt to update an attribute on a node that doesn't exist
   - Attempt to update text on a node that doesn't exist
   - These indicate serious synchronization issues

The specification does not mandate throwing exceptions for errors. Implementations may choose to log errors and continue processing, or may choose to halt processing on certain error conditions.

## Edge Cases and Special Considerations

### Initial State Synchronization

- The target document must initially be an accurate clone of the source document.
- All nodes in the target document must have node IDs assigned that match the source document.
- The node ID map must be initialized with all nodes from the target document.
- If the initial states do not match, subsequent operations may fail or produce incorrect results.

