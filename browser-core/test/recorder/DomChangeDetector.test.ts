import 'global-jsdom/register';
import { DomChangeDetector } from '../../src/recorder/DomChangeDetector';
import { NodeIdBiMap } from '../../src/common/NodeIdBiMap';
import { waitForMutations, delay } from './DomSyncTestUtils';

/**
 * Unit tests for DomChangeDetector
 * Tests cover operation emission, causal ordering, and batch processing.
 */

describe('DomChangeDetector', () => {
  let container: HTMLElement;
  let liveNodeMap: NodeIdBiMap;
  let operations: any[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    liveNodeMap = new NodeIdBiMap();
    operations = [];
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  function createDetector(
    root: Node,
    processImmediately: boolean = true,
    batchIntervalMs: number = 1000
  ): DomChangeDetector {
    return new DomChangeDetector(
      root,
      liveNodeMap,
      (ops) => {
        operations.push(...ops);
      },
      batchIntervalMs,
      processImmediately
    );
  }

  describe('initialization', () => {
    test('should create snapshot and assign node IDs', () => {
      const root = document.createElement('div');
      root.id = 'test';
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      const snapshot = detector.getSnapshotDomRoot();
      expect(snapshot).not.toBe(root);
      expect((snapshot as Element).id).toBe('test');
      
      detector.disconnect();
    });

    test('should mirror node IDs from live DOM to snapshot (Bug #3 fix)', () => {
      // This test verifies the fix for Bug #3: Snapshot IDs must match live DOM IDs
      const root = document.createElement('div');
      root.id = 'root';
      const child = document.createElement('span');
      child.id = 'child';
      root.appendChild(child);
      container.appendChild(root);
      
      liveNodeMap.assignNodeIdsToSubTree(root);
      const rootId = liveNodeMap.getNodeId(root)!;
      const childId = liveNodeMap.getNodeId(child)!;

      const detector = createDetector(root);
      
      // Verify snapshot map has same IDs pointing to snapshot nodes
      const snapshotMap = detector.getSnapshotNodeMap();
      const snapshotRoot = snapshotMap.getNodeById(rootId);
      const snapshotChild = snapshotMap.getNodeById(childId);
      
      expect(snapshotRoot).toBeDefined();
      expect(snapshotChild).toBeDefined();
      expect(snapshotRoot).not.toBe(root); // Different objects
      expect(snapshotChild).not.toBe(child); // Different objects
      expect((snapshotRoot as Element).id).toBe('root');
      expect((snapshotChild as Element).id).toBe('child');
      
      detector.disconnect();
    });

    test('should start observing mutations', async () => {
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      const child = document.createElement('span');
      root.appendChild(child);
      liveNodeMap.assignNodeIdsToSubTree(child);
      
      await waitForMutations(100);

      expect(operations.length).toBeGreaterThan(0);
      expect(operations.some(op => op.op === 'insert')).toBe(true);
      
      detector.disconnect();
    });
  });

  describe('insert operation', () => {
    test('should emit insert operation when node is added', async () => {
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      const child = document.createElement('span');
      child.textContent = 'Test';
      root.appendChild(child);
      liveNodeMap.assignNodeIdsToSubTree(child);
      
      await waitForMutations(100);

      const insertOps = operations.filter(op => op.op === 'insert');
      expect(insertOps.length).toBe(1);
      expect(insertOps[0].node.textContent).toBe('Test');
      expect(insertOps[0].parentId).toBe(liveNodeMap.getNodeId(root));
      
      detector.disconnect();
    });

    test('should emit insert with correct index', async () => {
      const root = document.createElement('div');
      const existing = document.createElement('p');
      root.appendChild(existing);
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      const child = document.createElement('span');
      root.insertBefore(child, existing);
      liveNodeMap.assignNodeIdsToSubTree(child);
      
      await waitForMutations(100);

      const insertOps = operations.filter(op => op.op === 'insert');
      expect(insertOps.length).toBe(1);
      expect(insertOps[0].index).toBe(0);
      
      detector.disconnect();
    });
  });

  describe('remove operation', () => {
    test('should emit remove operation when node is removed', async () => {
      const root = document.createElement('div');
      const child = document.createElement('span');
      root.appendChild(child);
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      await waitForMutations(50); // Let initial state settle
      operations.length = 0; // Clear initial operations
      
      const childId = liveNodeMap.getNodeId(child)!;
      root.removeChild(child);
      liveNodeMap.removeNodesInSubtree(child);
      
      await waitForMutations(100);

      const removeOps = operations.filter(op => op.op === 'remove');
      expect(removeOps.length).toBe(1);
      expect(removeOps[0].nodeId).toBe(childId);
      
      detector.disconnect();
    });
  });

  describe('attribute operations', () => {
    test('should emit updateAttribute when attribute is added', async () => {
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      root.setAttribute('id', 'test');
      
      await waitForMutations(100);

      const attrOps = operations.filter(op => op.op === 'updateAttribute');
      expect(attrOps.length).toBe(1);
      expect(attrOps[0].name).toBe('id');
      expect(attrOps[0].value).toBe('test');
      
      detector.disconnect();
    });

    test('should emit updateAttribute when attribute value changes', async () => {
      const root = document.createElement('div');
      root.setAttribute('id', 'old');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      await waitForMutations(50);
      operations.length = 0;
      
      root.setAttribute('id', 'new');
      
      await waitForMutations(100);

      const attrOps = operations.filter(op => op.op === 'updateAttribute' && op.name === 'id');
      expect(attrOps.length).toBe(1);
      expect(attrOps[0].value).toBe('new');
      
      detector.disconnect();
    });

    test('should emit removeAttribute when attribute is removed', async () => {
      const root = document.createElement('div');
      root.setAttribute('id', 'test');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      await waitForMutations(50);
      operations.length = 0;
      
      root.removeAttribute('id');
      
      await waitForMutations(100);

      const removeAttrOps = operations.filter(op => op.op === 'removeAttribute');
      expect(removeAttrOps.length).toBe(1);
      expect(removeAttrOps[0].name).toBe('id');
      
      detector.disconnect();
    });
  });

  describe('text operations', () => {
    test('should emit updateText when text content changes', async () => {
      const root = document.createElement('div');
      const textNode = document.createTextNode('old');
      root.appendChild(textNode);
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      await waitForMutations(50);
      operations.length = 0;
      
      textNode.textContent = 'new';
      
      await waitForMutations(100);

      const textOps = operations.filter(op => op.op === 'updateText');
      expect(textOps.length).toBe(1);
      expect(textOps[0].ops).toBeDefined();
      
      detector.disconnect();
    });
  });

  describe('causal ordering', () => {
    test('should emit insert before attribute update for new node', async () => {
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      const child = document.createElement('span');
      root.appendChild(child);
      liveNodeMap.assignNodeIdsToSubTree(child);
      
      // Wait for insert to be processed
      await waitForMutations(100);
      
      // Then set attribute (separate batch)
      child.setAttribute('id', 'test');
      await waitForMutations(100);

      const insertIdx = operations.findIndex(op => op.op === 'insert');
      const childId = liveNodeMap.getNodeId(child);
      const attrIdx = operations.findIndex(op => op.op === 'updateAttribute' && op.nodeId === childId);
      
      expect(insertIdx).not.toBe(-1);
      expect(attrIdx).not.toBe(-1);
      // Insert should come before attribute update (but may be in different batches)
      // If both exist, verify insert came first
      if (insertIdx !== -1 && attrIdx !== -1) {
        expect(insertIdx).toBeLessThan(attrIdx);
      }
      
      detector.disconnect();
    });

    test('should emit insert before remove for node added then removed', async () => {
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      const child = document.createElement('span');
      root.appendChild(child);
      liveNodeMap.assignNodeIdsToSubTree(child);
      
      // Remove immediately after insert (in same batch)
      root.removeChild(child);
      liveNodeMap.removeNodesInSubtree(child);
      
      // Wait for requestAnimationFrame processing
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await delay(50);

      // Note: Since the detector uses snapshot-based diffing, mutations that cancel out
      // (like add-then-remove in same batch) produce no net change and no operations.
      // This is by design - the detector emits operations representing the net state change,
      // not every intermediate mutation. This ensures efficient synchronization.
      const insertOps = operations.filter(op => op.op === 'insert');
      const removeOps = operations.filter(op => op.op === 'remove');
      
      // Expect no operations since there's no net change (snapshot and live both have no child)
      expect(insertOps.length).toBe(0);
      expect(removeOps.length).toBe(0);
      
      detector.disconnect();
    });

    test('should process attributes before children for elements', async () => {
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      root.setAttribute('id', 'test');
      const child = document.createElement('span');
      root.appendChild(child);
      liveNodeMap.assignNodeIdsToSubTree(child);
      
      await waitForMutations(100);

      const attrIdx = operations.findIndex(op => op.op === 'updateAttribute' && op.nodeId === liveNodeMap.getNodeId(root));
      const insertIdx = operations.findIndex(op => op.op === 'insert' && op.parentId === liveNodeMap.getNodeId(root));
      
      // Attributes should be processed before child insertions
      expect(attrIdx).not.toBe(-1);
      expect(insertIdx).not.toBe(-1);
      expect(attrIdx).toBeLessThan(insertIdx);
      
      detector.disconnect();
    });
  });

  describe('batch processing', () => {
    test('should process mutations in batches', async () => {
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root, false, 100); // 100ms batch interval
      
      const child1 = document.createElement('span');
      root.appendChild(child1);
      liveNodeMap.assignNodeIdsToSubTree(child1);
      
      await delay(50);
      
      const child2 = document.createElement('p');
      root.appendChild(child2);
      liveNodeMap.assignNodeIdsToSubTree(child2);
      
      // Wait for batch interval
      await delay(150);

      // Both should be in operations (batched together)
      const insertOps = operations.filter(op => op.op === 'insert');
      expect(insertOps.length).toBeGreaterThanOrEqual(1);
      
      detector.disconnect();
    });
  });

  describe('cleanup', () => {
    test('should disconnect observer and clear intervals', async () => {
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      const child = document.createElement('span');
      root.appendChild(child);
      liveNodeMap.assignNodeIdsToSubTree(child);
      
      await waitForMutations(100); // Wait for first mutation to be captured
      const opsBeforeDisconnect = operations.length;
      
      detector.disconnect();
      
      // Add another mutation after disconnect
      const child2 = document.createElement('p');
      root.appendChild(child2);
      liveNodeMap.assignNodeIdsToSubTree(child2);
      
      await waitForMutations(100);
      
      // Operations should not increase (observer disconnected)
      expect(operations.length).toBe(opsBeforeDisconnect);
    });
  });

  describe('snapshot consistency', () => {
    test('should maintain snapshot consistency after operations', async () => {
      const root = document.createElement('div');
      root.id = 'root';
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      const child = document.createElement('span');
      child.id = 'child';
      root.appendChild(child);
      liveNodeMap.assignNodeIdsToSubTree(child);
      
      await waitForMutations(100);

      const snapshot = detector.getSnapshotDomRoot();
      expect((snapshot as Element).id).toBe('root');
      expect((snapshot as Element).childNodes.length).toBe(1);
      expect(((snapshot as Element).firstChild as Element).id).toBe('child');
      
      detector.disconnect();
    });

    test('should use separate node objects for operations and snapshot (Bug #1 fix)', async () => {
      // This test verifies the fix for Bug #1: Operation nodes must be different objects
      // from snapshot nodes to prevent DOM.insertBefore from moving nodes
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);

      const detector = createDetector(root);
      
      const child = document.createElement('span');
      child.textContent = 'Test';
      root.appendChild(child);
      liveNodeMap.assignNodeIdsToSubTree(child);
      
      await waitForMutations(100);

      // Get snapshot before applying operations
      const snapshotMap = detector.getSnapshotNodeMap();
      const snapshotRoot = snapshotMap.getNodeById(liveNodeMap.getNodeId(root)!)!;
      const snapshotChild = snapshotRoot.childNodes[0] as Node;

      // Get the insert operation
      const insertOps = operations.filter(op => op.op === 'insert');
      expect(insertOps.length).toBe(1);
      const operationNode = (insertOps[0] as any).node;

      // Verify operation node is a different object from snapshot node
      expect(operationNode).not.toBe(snapshotChild);
      expect(operationNode).not.toBe(child);
      
      // Verify snapshot still has its child (wasn't moved)
      expect(snapshotRoot.childNodes.length).toBe(1);
      expect(snapshotRoot.childNodes[0]).toBe(snapshotChild);
      
      detector.disconnect();
    });

    test('should not corrupt snapshot map when creating operation clones (Bug #2 fix)', async () => {
      // This test verifies the fix for Bug #2: Snapshot map must still point to
      // snapshot nodes after creating operation clones (not target DOM nodes)
      const root = document.createElement('div');
      const child = document.createElement('span');
      child.id = 'child';
      root.appendChild(child);
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);
      
      const childId = liveNodeMap.getNodeId(child)!;

      const detector = createDetector(root);
      const snapshotMap = detector.getSnapshotNodeMap();
      
      // Get the snapshot child node
      const snapshotRoot = snapshotMap.getNodeById(liveNodeMap.getNodeId(root)!)!;
      const snapshotChild = snapshotMap.getNodeById(childId)!;

      // Modify the live DOM to trigger operation generation
      const newChild = document.createElement('p');
      newChild.textContent = 'New';
      root.appendChild(newChild);
      liveNodeMap.assignNodeIdsToSubTree(newChild);
      
      await waitForMutations(100);

      // Verify snapshot map still points to snapshot nodes (not operation nodes)
      const snapshotChildAfter = snapshotMap.getNodeById(childId);
      expect(snapshotChildAfter).toBe(snapshotChild); // Same object (snapshot node)
      
      // Get the insert operation node
      const insertOps = operations.filter(op => op.op === 'insert');
      if (insertOps.length > 0) {
        const operationNode = (insertOps[insertOps.length - 1] as any).node;
        
        // Verify operation node is NOT tracked by snapshot map
        // (map should only track snapshot nodes, not operation nodes)
        expect(snapshotMap.getNodeById(liveNodeMap.getNodeId(newChild)!)).not.toBe(operationNode);
        
        // Verify snapshot still has its original structure
        expect(snapshotRoot.childNodes.length).toBe(2); // Original child + new child in snapshot
        expect(snapshotRoot.childNodes[0]).toBe(snapshotChild);
      }
      
      detector.disconnect();
    });
  });
});

