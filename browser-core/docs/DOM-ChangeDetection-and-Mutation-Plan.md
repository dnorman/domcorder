# DOM Change Detection and Mutation Plan

## Overview

This document outlines the relationship between DomChangeDetector and DomMutator, their responsibilities, and the comprehensive testing strategy to ensure they work correctly together.

## Relationship Between DomChangeDetector and DomMutator

The DomMutator and DomChangeDetector work together:

- **DomChangeDetector**: Observes changes in the source document and emits operations
- **DomMutator**: Consumes operations and applies them to the target document

The DomChangeDetector is responsible for:
- Assigning node IDs when nodes are added
- Emitting operations in causal order
- Ensuring all necessary operations are emitted (including operations that appear to cancel out)

The DomMutator is responsible for:
- Applying operations in the order received
- Maintaining the node ID map for the target document
- Handling errors that occur during application

Both components must share the same understanding of:
- Node ID assignment and stability
- Operation structure and semantics
- Causal ordering requirements

## Testing Strategy

### Unit Tests

Each component should have comprehensive unit tests covering:

#### DomChangeDetector Unit Tests

**Core Functionality**:
- Node ID assignment when nodes are added
- Node ID stability during attribute/text changes
- Node ID cleanup when nodes are removed
- Operation emission for each operation type (insert, remove, updateAttribute, removeAttribute, updateText)

**Operation Ordering**:
- Causal ordering: operations emitted in correct dependency order
- Operations that appear to cancel out are still both emitted
- Node added and removed in same batch: both operations emitted in correct order

**Edge Cases**:
- Nodes added and removed in rapid succession
- Multiple attribute changes on same element
- Text content changed multiple times
- Complex nested structures
- DocumentFragments and their children
- Nodes moved between parents

**Error Handling**:
- Invalid operation sequences
- Missing parent nodes
- Nodes removed before they're added

#### DomMutator Unit Tests

**Core Functionality**:
- Node ID map initialization from initial DOM state
- Node insertion at correct index positions
- Node removal with subtree cleanup
- Attribute updates and removals
- Text content updates using string mutation operations

**Index Validation**:
- Valid index ranges (0 to childNodes.length)
- Error handling for out-of-bounds indices
- Correct insertion at end (index === length)

**Node ID Map Management**:
- Node adoption when inserting subtrees
- Node removal from map when removing subtrees
- Node ID stability during operations
- Map cleanup when nodes are removed

**Error Handling**:
- Missing parent nodes (ordering issues)
- Missing nodes for remove operations
- Non-Element nodes for attribute operations
- Non-CharacterData nodes for text operations

### Integration Tests

Integration tests verify that DomChangeDetector and DomMutator work correctly together by maintaining DOM synchronization.

**Test Structure**:
1. Create an initial source DOM
2. Clone it to create a target DOM
3. Initialize DomChangeDetector with source DOM
4. Initialize DomMutator with target DOM and initial node ID map
5. Apply mutations to source DOM
6. Collect operations from DomChangeDetector
7. Apply operations to target DOM via DomMutator
8. Verify source and target DOMs are identical

**Comprehensive Test Scenarios**:

**Basic Operations**:
- Single node insertion
- Single node removal
- Attribute updates (add, modify, remove)
- Text content changes
- Combination of multiple operation types

**Complex Scenarios**:
- Deeply nested structures (100+ levels)
- Large numbers of siblings (1000+ children)
- Rapid mutation sequences (add, remove, modify in quick succession)
- Nodes added and removed in same batch
- Nodes moved between parents
- DocumentFragments with multiple children
- Mixed content (elements, text nodes, comments, CDATA sections)

**Stress Tests**:
- Thousands of mutations in sequence
- Very large DOM trees (10,000+ nodes)
- Rapid-fire mutations (minimal delay between operations)
- Concurrent mutations on different subtrees

**Edge Cases**:
- Nodes added then removed before operations are processed
- Attributes set then removed in same batch
- Text changed multiple times rapidly
- Insertions at various index positions (beginning, middle, end)
- Removals that create gaps in child lists

**Validation Checks**:
- DOM structure equality (tree structure, node types, names)
- Attribute equality (all attributes match)
- Text content equality (CharacterData nodes match)
- Node ID consistency (same IDs used for same nodes across sync cycles)
- No orphaned nodes in target DOM
- No missing nodes that should exist

### Property-Based / Fuzz Testing

Generate random but valid DOM mutation sequences to discover edge cases:

**Strategy**:
- Generate random initial DOM structures
- Generate random mutation sequences
- Verify synchronization after each mutation or sequence
- Track mutation history to reproduce failures

**Mutation Generators**:
- Random node insertions (various element types, text nodes)
- Random removals
- Random attribute changes
- Random text modifications
- Random combinations and orderings

**Validation**:
- DOM equality after full sequence
- Operation sequence correctness
- Node ID consistency
- No memory leaks or performance degradation

### Browser Compatibility Testing

Test in multiple browsers to validate MutationObserver behavior assumptions:

**Browsers**:
- Chromium (Chrome, Edge)
- Firefox
- WebKit (Safari)

**Focus Areas**:
- MutationObserver callback ordering
- MutationRecord ordering behavior
- Batch boundaries and macrotask separation
- Attribute coalescing behavior
- DocumentFragment handling

**Test Location**: `test/recorder/mutationobserver-behavior-playwright.spec.ts`

### Performance Testing

Ensure the system performs adequately under real-world conditions:

**Benchmarks**:
- Operation generation time (DomChangeDetector)
- Operation application time (DomMutator)
- Memory usage during large DOM sync operations
- Throughput (operations per second)

**Performance Targets**:
- Real-time synchronization for typical web page mutations
- No noticeable lag during rapid DOM changes
- Memory usage stays within reasonable bounds

**Test Scenarios**:
- Large DOM trees (10,000+ nodes)
- High-frequency mutations (100+ mutations/second)
- Long-running sessions (hours of continuous mutation tracking)

### Regression Testing

Maintain a suite of known edge cases and failure scenarios:

**Regression Test Cases**:
- Previously discovered bugs (ensure they don't reoccur)
- Complex real-world DOM structures from actual web pages
- Edge cases discovered during development
- Property-based test failures (after fixing, add as regression test)

**Test Data**:
- Capture real DOM structures from web pages
- Store as test fixtures
- Include expected operation sequences
- Verify synchronization after operations applied

### Test Organization

```
test/
├── recorder/
│   ├── DomChangeDetector.test.ts          # Unit tests for DomChangeDetector
│   ├── DomMutator.test.ts                 # Unit tests for DomMutator
│   ├── DomSync.integration.test.ts        # Integration tests
│   ├── DomSync.fuzz.test.ts               # Property-based/fuzz tests
│   ├── DomSync.performance.test.ts        # Performance benchmarks
│   ├── DomSync.regression.test.ts         # Regression test suite
│   └── mutationobserver-behavior.test.ts  # MutationObserver behavior validation
```

### Test Utilities

**Helper Functions**:
- `createTestDOM(structure: DOMStructure): HTMLElement` - Create test DOM from specification
- `cloneDOM(node: Node): Node` - Deep clone for test setup
- `assertDOMEqual(source: Node, target: Node)` - Verify DOM equality
- `assertNodeIDsMatch(source: NodeIdBiMap, target: NodeIdBiMap)` - Verify node ID mapping
- `generateRandomMutations(count: number): Mutation[]` - Generate random mutation sequences
- `applyMutationsToDOM(dom: Node, mutations: Mutation[])` - Apply mutations for testing

**Test Data**:
- Pre-defined DOM structures for common scenarios
- Real-world DOM snapshots from web pages
- Edge case DOM structures
- Mutation sequences for regression tests

## Implementation Considerations

### Initial State Synchronization

Critical requirement: The initial state must be perfectly synchronized before applying any operations.

**Process**:
1. Clone source DOM to create target DOM
2. Assign matching node IDs to both DOMs
3. Initialize DomMutator's node ID map from target DOM
4. Verify initial equality before starting mutation tracking

**Validation**:
- Deep equality check between source and target before first operation
- Node ID maps match between source and target

### Operation Stream Integrity

The operation stream must be:
- **Complete**: All mutations result in operations
- **Correct**: Operations correctly represent the mutations
- **Ordered**: Operations respect causal dependencies
- **Consistent**: Node IDs remain stable throughout

### Error Recovery

Consider strategies for handling:
- Operation application failures
- Node ID mismatches
- Missing nodes during removal
- Out-of-sync states

Options:
- Re-synchronize from current state (expensive but safe)
- Log errors and continue (may accumulate drift)
- Halt and report (fail-fast for debugging)

## Success Criteria

The implementation is successful when:

1. **Correctness**: All test suites pass (unit, integration, property-based, regression)
2. **Performance**: Meets performance benchmarks for real-world scenarios
3. **Reliability**: Handles edge cases gracefully without crashes or undefined behavior
4. **Compatibility**: Works correctly across major browsers
5. **Maintainability**: Code is well-documented and test coverage is comprehensive
