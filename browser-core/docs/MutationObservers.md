# MutationObserver Behavior and Implementation Considerations

This document addresses key aspects of MutationObserver behavior that impact our implementation of DOM change detection.

## Batch Definition

A **batch** is defined as the set of `MutationRecord` objects delivered in a single invocation of the MutationObserver callback. All mutation records within a batch are processed synchronously during that single callback execution.

## DOM Stability During Callback Execution

**Assumption**: We assume that the DOM is static during the handling of our callback (if we don't change it ourselves). This means:

- Once the callback begins executing, the DOM state does not change due to external modifications
- Any mutations we observe in the batch have already been applied to the DOM
- We can safely read the DOM state during callback processing without worrying about it changing underneath us
- This assumption holds true because MutationObserver callbacks execute as microtasks, which run synchronously in a single event loop cycle

**Note**: If our callback code itself mutates the DOM, those changes will be reflected in future MutationObserver callbacks, not the current one.

## Temporal Ordering of Mutation Records

**Question**: Are MutationRecords temporally ordered (i.e., in the order that the original mutations happened within the current macrotask)?

**Answer**: **No, MutationRecords are NOT guaranteed to be temporally ordered.**

According to the MutationObserver specification:

- MutationRecords are grouped by the `target` node on which mutations occurred
- Multiple mutations on the same target may be coalesced into a single MutationRecord
- The order of MutationRecords in the array is not specified to reflect temporal order
- The order may be implementation-dependent or optimized for performance

**Question**: Can MutationRecords be out of causal order (i.e., can a remove record appear before an add record for the same node)?

**Answer**: **Yes, MutationRecords may be out of causal order as well.**

The MutationObserver specification does not guarantee causal ordering either. This means:

- A MutationRecord for removing a node may appear **before** a MutationRecord for adding that same node
- A MutationRecord for changing an attribute on a node may appear **before** the MutationRecord for adding that node
- This can happen even though the add operation must have occurred before the remove operation in reality (otherwise the remove would have nothing to remove)

**Implications for Implementation**:

- We cannot rely on the array index of MutationRecords to determine when mutations occurred (temporal ordering)
- We **also cannot rely on the array index to determine causal dependencies** (causal ordering)
- We must establish causal ordering ourselves through analysis of:
  - The DOM state (final state after all mutations)
  - Our own tracking of node IDs and when nodes were added
  - Comparing snapshot state to current state
- This is why the DomChangeDetector specification emphasizes that operations must be emitted in **causal order**, which requires additional logic beyond simply iterating through MutationRecords
- When processing a batch, we may see a remove operation before an add operation for the same node, even if the add happened first in real time

**Example Scenarios**:

```javascript
// Scenario 1: Temporal ordering violation
// Synchronous mutations:
parent.appendChild(nodeA);  // Mutation 1
parent.appendChild(nodeB);  // Mutation 2
nodeA.removeChild(someChild); // Mutation 3

// MutationRecords might appear as:
// [MutationRecord for nodeA (removeChild), MutationRecord for parent (appendChild x2)]
// The order does not reflect that appendChild happened before removeChild

// Scenario 2: Causal ordering violation
// Synchronous mutations:
parent.appendChild(nodeA);  // Must happen first
parent.removeChild(nodeA);  // Must happen second (depends on first)

// MutationRecords might appear as:
// [MutationRecord for parent (removeChild), MutationRecord for parent (appendChild)]
// The remove appears before the add, violating causal ordering!
```

**Critical Consequence**:

Because MutationRecords can violate causal ordering, an implementation that processes records sequentially cannot simply:
1. Process MutationRecord[0] → emit operations
2. Process MutationRecord[1] → emit operations
3. etc.

Instead, implementations must:
1. Collect all MutationRecords in the batch
2. Analyze the DOM state and track node additions
3. Establish causal dependencies
4. Emit operations in causal order (which may differ from the MutationRecord array order)

## Batch Scope and Macrotask Boundaries

**Question**: Does the mutation record batch encompass all of the changes accumulated during a macrotask?

**Answer**: **Yes, with some nuances.**

- MutationObserver callbacks execute as **microtasks**, not as part of the macrotask itself
- All DOM mutations that occur during a single macrotask (synchronous execution block) are batched together
- The callback is invoked once per macrotask, after all mutations in that macrotask have been applied
- If mutations occur across multiple macrotasks (e.g., in separate setTimeout callbacks), each macrotask will trigger its own MutationObserver callback

**Timeline Example**:
```
Macrotask 1:
  - DOM mutation 1
  - DOM mutation 2
  - DOM mutation 3
  → Microtask: MutationObserver callback fires with batch [record1, record2, record3]

Macrotask 2 (setTimeout):
  - DOM mutation 4
  → Microtask: MutationObserver callback fires with batch [record4]
```

**Note**: The term "macrotask" here refers to a synchronous execution block (script execution, event handler, etc.). The MutationObserver callback runs as a microtask that executes after the macrotask completes but before the next macrotask begins.

## DOM State During Callback

**Question**: Is the state of the DOM the current state after ALL mutations communicated across the entire batch were performed?

**Answer**: **Yes, definitively.**

- When the MutationObserver callback executes, the DOM reflects the **final state** after all mutations in the batch have been applied
- You can query the DOM during the callback and see the cumulative effect of all mutations
- This means if a node was added and then removed within the same macrotask, the DOM state during the callback will show that the node does not exist (even though we'll receive MutationRecords for both the add and remove)
- The `oldValue` property in MutationRecords (if enabled) captures the state before mutations, but the actual DOM tree reflects the final state

**Practical Implication**:

This is why our DomChangeDetector implementation cannot rely solely on the DOM state to determine what changed. We need to:
1. Track previous state (via snapshots or other mechanisms)
2. Compare against current state to determine what operations to emit
3. Process MutationRecords to understand what happened, but not rely on their order

**Example**:
```javascript
// Synchronous mutations:
parent.appendChild(node);
parent.removeChild(node);

// In MutationObserver callback:
// - DOM state: node does not exist in parent
// - MutationRecords: [add record, remove record] (or possibly combined)
// - We must emit both insert and remove operations, even though DOM shows neither
```

## Challenges for Direct MutationObserver Usage

The following characteristics of MutationObserver make direct usage challenging for our use case:

1. **Lack of Temporal and Causal Ordering**: We cannot determine the exact sequence of mutations from the MutationRecord array order alone. More critically, the records may violate causal ordering - a remove record may appear before an add record for the same node, requiring us to establish causal dependencies ourselves.

2. **Coalescing**: Multiple mutations on the same target may be coalesced into a single MutationRecord (e.g., multiple attribute changes), making it difficult to determine individual operations.

3. **DOM State Reflects Final State**: The DOM always shows the final state, not intermediate states, so we cannot use the DOM to determine what operations occurred.

4. **No Guarantee of Completeness**: The specification does not guarantee that every mutation will result in a MutationRecord (though in practice, this is rare).

5. **Batching Across Multiple Targets**: Mutations on different targets are batched together, which is helpful for performance but means we must process multiple unrelated changes in a single callback.

## Recommendations for Implementation

Given these challenges, our implementation strategy should:

1. **Use MutationObserver as a Trigger**: Use MutationObserver to detect *that* something changed, not necessarily *what* changed.

2. **Maintain Snapshot State**: Keep a snapshot of the DOM state to compare against the current state and compute the minimal set of changes needed.

3. **Process Mutations Intelligently**: When processing MutationRecords:
   - Group related mutations appropriately
   - Establish causal ordering (not temporal ordering)
   - Emit operations that, when applied in order, will transform the snapshot to match the current state

4. **Handle Edge Cases**: Account for nodes that are added and removed in the same batch, attributes that are set and removed, etc.

5. **Validate Assumptions**: Consider writing tests to verify that our assumptions about DOM stability and batch boundaries hold true across different browsers and scenarios.

## Browser-Specific Behavior Observations

**Note**: The following observations are based on testing with Chromium, Firefox, and WebKit. Behavior may vary in other browsers or browser versions.

### Causal Ordering in Practice

While the specification does not guarantee causal ordering, in practice, the tested browsers (Chromium, Firefox, WebKit) appear to preserve causal ordering in common scenarios:

- When a node is added and then immediately removed in the same macrotask, the add MutationRecord typically appears before the remove MutationRecord
- This behavior is consistent across Chromium, Firefox, and WebKit

**Important**: This should NOT be relied upon in implementation, as:
- The specification does not guarantee this behavior
- Edge cases or different mutation patterns may violate causal ordering
- Future browser implementations may change this behavior

### Nodes in Both addedNodes and removedNodes

All tested browsers confirm that:
- A node CAN appear in both `addedNodes` and `removedNodes` across different MutationRecords
- The same node does NOT appear in both lists within a single MutationRecord
- When a node is added and removed in the same batch, it appears in both lists (in separate records)

### Attribute Mutation Coalescing

In tested scenarios:
- Multiple rapid attribute changes on the same element may or may not be coalesced
- Three sequential attribute changes on the same element produced three separate MutationRecords in Chromium, Firefox, and WebKit
- Coalescing behavior may vary based on timing, element type, or attribute names

### Comparison with JSDOM (Node.js/Bun Testing Environment)

When running tests with JSDOM (as used by Bun's test runner):
- JSDOM implements MutationObserver, but behavior may differ from real browsers
- Some edge cases or timing-dependent behaviors may not be accurately represented
- For production-critical MutationObserver behavior, testing in real browsers (via Playwright) is recommended

**Recommendation**: For validating MutationObserver assumptions, run tests in both JSDOM (for fast iteration) and real browsers (for accuracy).

