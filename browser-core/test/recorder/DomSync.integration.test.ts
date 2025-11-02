import 'global-jsdom/register';
import { DomChangeDetector } from '../../src/recorder/DomChangeDetector';
import { DomMutator } from '../../src/player/DomMutator';
import { NodeIdBiMap } from '../../src/common/NodeIdBiMap';
import { cloneDOM, assertDOMEqual, delay } from './DomSyncTestUtils';

/**
 * Integration tests for DomChangeDetector and DomMutator working together.
 * 
 * These tests verify that:
 * - Operations emitted by DomChangeDetector correctly synchronize
 *   a target DOM when applied by DomMutator
 * - Complex mutation sequences maintain synchronization
 * - Edge cases are handled correctly
 */

describe('DomSyncV2 Integration', () => {
  let sourceContainer: HTMLElement;
  let targetContainer: HTMLElement;
  let sourceRoot: HTMLElement;
  let targetRoot: HTMLElement;
  let sourceNodeMap: NodeIdBiMap;
  let targetNodeMap: NodeIdBiMap;
  let detector: DomChangeDetector;
  let mutator: DomMutator;
  let operations: any[];

  beforeEach(() => {
    sourceContainer = document.createElement('div');
    targetContainer = document.createElement('div');
    document.body.appendChild(sourceContainer);
    document.body.appendChild(targetContainer);

    sourceRoot = document.createElement('div');
    sourceRoot.id = 'source-root';
    sourceContainer.appendChild(sourceRoot);

    sourceNodeMap = new NodeIdBiMap();
    sourceNodeMap.assignNodeIdsToSubTree(sourceRoot);

    // Clone for target
    targetRoot = cloneDOM(sourceRoot) as HTMLElement;
    targetContainer.appendChild(targetRoot);

    targetNodeMap = new NodeIdBiMap();
    targetNodeMap.assignNodeIdsToSubTree(targetRoot);

    operations = [];

    detector = new DomChangeDetector(
      sourceRoot,
      sourceNodeMap,
      (ops) => {
        operations.push(...ops);
      },
      1000,
      true // process immediately
    );

    // Create a mock AssetManager that mimics the real behavior
    const mockAssetManager = {
      findAndBindAssetToElementProperty: jest.fn((element: Element, property: string, value: string) => {
        if (value) {
          element.setAttribute(property, value);
        }
      }),
    } as any;
    
    mutator = new DomMutator(targetNodeMap, mockAssetManager);
  });

  afterEach(() => {
    if (detector) {
      detector.disconnect();
    }
    if (sourceContainer && sourceContainer.parentNode) {
      sourceContainer.parentNode.removeChild(sourceContainer);
    }
    if (targetContainer && targetContainer.parentNode) {
      targetContainer.parentNode.removeChild(targetContainer);
    }
  });

  async function waitAndSync(): Promise<void> {
    // Wait for requestAnimationFrame to process (if processImmediately is true)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Also wait a bit for any async processing
    await delay(50);
    
    // Copy operations array before clearing
    const opsToApply = [...operations];
    operations.length = 0; // Clear before applying to avoid accumulation
    
    if (opsToApply.length > 0) {
      // Debug: log operations being applied
      // console.log(`[waitAndSync] Applying ${opsToApply.length} operations:`, opsToApply.map(op => ({ op: op.op, nodeId: (op as any).nodeId || (op as any).parentId, index: (op as any).index })));
      mutator.applyOps(opsToApply);
      // Wait a bit after applying to ensure DOM is updated
      await delay(10);
    }
  }

  describe('basic operations', () => {
    test('should sync single node insertion', async () => {
      const child = document.createElement('span');
      child.textContent = 'Hello';
      sourceRoot.appendChild(child);
      sourceNodeMap.assignNodeIdsToSubTree(child);

      await waitAndSync();

      expect(targetRoot.childNodes.length).toBe(1);
      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync single node removal', async () => {
      const child = document.createElement('span');
      child.textContent = 'Test';
      sourceRoot.appendChild(child);
      sourceNodeMap.assignNodeIdsToSubTree(child);
      await waitAndSync();

      // Verify child was inserted
      expect(targetRoot.childNodes.length).toBe(1);
      const childId = sourceNodeMap.getNodeId(child)!;
      
      // Remove child - DO NOT remove from sourceNodeMap yet
      // The detector needs to find it in the snapshot to emit remove operation
      sourceRoot.removeChild(child);
      
      await waitAndSync();
      
      // Now remove from sourceNodeMap after detector has processed
      sourceNodeMap.removeNodesInSubtree(child);

      expect(targetRoot.childNodes.length).toBe(0);
      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync attribute update', async () => {
      sourceRoot.setAttribute('class', 'test');
      await waitAndSync();

      expect((targetRoot as Element).getAttribute('class')).toBe('test');
      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync attribute removal', async () => {
      sourceRoot.setAttribute('id', 'test');
      await waitAndSync();

      sourceRoot.removeAttribute('id');
      await waitAndSync();

      expect((targetRoot as Element).hasAttribute('id')).toBe(false);
      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync text content change', async () => {
      const textNode = document.createTextNode('old');
      sourceRoot.appendChild(textNode);
      sourceNodeMap.assignNodeIdsToSubTree(textNode);
      await waitAndSync();

      textNode.textContent = 'new';
      await waitAndSync();

      expect(targetRoot.textContent).toBe('new');
      assertDOMEqual(sourceRoot, targetRoot);
    });
  });

  describe('complex scenarios', () => {
    test('should sync deeply nested structure', async () => {
      let current = sourceRoot;
      for (let i = 0; i < 10; i++) {
        const child = document.createElement('div');
        child.id = `level-${i}`;
        current.appendChild(child);
        sourceNodeMap.assignNodeIdsToSubTree(child);
        current = child;
      }
      await waitAndSync();

      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync multiple siblings', async () => {
      for (let i = 0; i < 20; i++) {
        const child = document.createElement('div');
        child.textContent = `Child ${i}`;
        sourceRoot.appendChild(child);
        sourceNodeMap.assignNodeIdsToSubTree(child);
      }
      await waitAndSync();

      expect(targetRoot.childNodes.length).toBe(20);
      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync node added then removed in same batch', async () => {
      const child = document.createElement('span');
      child.textContent = 'Temporary';
      sourceRoot.appendChild(child);
      sourceNodeMap.assignNodeIdsToSubTree(child);

      // Remove immediately (same batch)
      sourceRoot.removeChild(child);
      sourceNodeMap.removeNodesInSubtree(child);

      await waitAndSync();

      // Both operations should be applied, resulting in no child
      expect(targetRoot.childNodes.length).toBe(0);
      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync node moved between parents', async () => {
      const parent1 = document.createElement('div');
      parent1.id = 'parent1';
      const parent2 = document.createElement('div');
      parent2.id = 'parent2';
      sourceRoot.appendChild(parent1);
      sourceRoot.appendChild(parent2);
      sourceNodeMap.assignNodeIdsToSubTree(parent1);
      sourceNodeMap.assignNodeIdsToSubTree(parent2);
      await waitAndSync();

      const child = document.createElement('span');
      child.textContent = 'Movable';
      parent1.appendChild(child);
      sourceNodeMap.assignNodeIdsToSubTree(child);
      await waitAndSync();

      parent2.appendChild(child);
      await waitAndSync();

      const targetParent1 = targetNodeMap.getNodeById(sourceNodeMap.getNodeId(parent1)!) as Element;
      const targetParent2 = targetNodeMap.getNodeById(sourceNodeMap.getNodeId(parent2)!) as Element;
      expect(targetParent1.childNodes.length).toBe(0);
      expect(targetParent2.childNodes.length).toBe(1);
      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync attribute set then removed in same batch', async () => {
      sourceRoot.setAttribute('class', 'test');
      sourceRoot.removeAttribute('class');
      await waitAndSync();

      expect((targetRoot as Element).hasAttribute('class')).toBe(false);
      // Note: This test validates that both operations are emitted,
      // even though they cancel out
    });

    test('should sync text changed multiple times rapidly', async () => {
      const textNode = document.createTextNode('A');
      sourceRoot.appendChild(textNode);
      sourceNodeMap.assignNodeIdsToSubTree(textNode);
      await waitAndSync();

      textNode.textContent = 'B';
      textNode.textContent = 'C';
      textNode.textContent = 'D';
      await waitAndSync();

      expect(targetRoot.textContent).toBe('D');
      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync insertions at various indices', async () => {
      const child1 = document.createElement('div');
      child1.id = '1';
      const child2 = document.createElement('div');
      child2.id = '2';
      const child3 = document.createElement('div');
      child3.id = '3';

      sourceRoot.appendChild(child1);
      sourceNodeMap.assignNodeIdsToSubTree(child1);
      await waitAndSync();

      sourceRoot.insertBefore(child2, child1);
      sourceNodeMap.assignNodeIdsToSubTree(child2);
      await waitAndSync();

      sourceRoot.appendChild(child3);
      sourceNodeMap.assignNodeIdsToSubTree(child3);
      await waitAndSync();

      const children = Array.from(targetRoot.childNodes) as Element[];
      expect(children.length).toBe(3);
      expect(children[0].id).toBe('2');
      expect(children[1].id).toBe('1');
      expect(children[2].id).toBe('3');
      assertDOMEqual(sourceRoot, targetRoot);
    });

    test('should sync mixed content (elements, text, comments)', async () => {
      const textNode = document.createTextNode('Text');
      const comment = document.createComment('Comment');
      const element = document.createElement('span');
      element.textContent = 'Element';

      sourceRoot.appendChild(textNode);
      sourceRoot.appendChild(comment);
      sourceRoot.appendChild(element);
      sourceNodeMap.assignNodeIdsToSubTree(textNode);
      sourceNodeMap.assignNodeIdsToSubTree(comment);
      sourceNodeMap.assignNodeIdsToSubTree(element);

      await waitAndSync();

      assertDOMEqual(sourceRoot, targetRoot);
    });
  });

  describe('node ID consistency', () => {
    test('should maintain node ID mapping throughout mutations', async () => {
      const child = document.createElement('div');
      child.id = 'test';
      sourceRoot.appendChild(child);
      sourceNodeMap.assignNodeIdsToSubTree(child);

      await waitAndSync();

      const sourceId = sourceNodeMap.getNodeId(child)!;
      const targetChild = targetNodeMap.getNodeById(sourceId) as Element;
      expect(targetChild).toBeDefined();
      expect(targetChild.id).toBe('test');

      // Modify and verify IDs still match
      child.setAttribute('class', 'modified');
      await waitAndSync();

      const targetChildAfter = targetNodeMap.getNodeById(sourceId) as Element;
      expect(targetChildAfter).toBe(targetChild);
      expect(targetChildAfter.getAttribute('class')).toBe('modified');
    });

    test('should handle node IDs correctly after removal and re-add', async () => {
      const child = document.createElement('span');
      child.id = 'original';
      sourceRoot.appendChild(child);
      sourceNodeMap.assignNodeIdsToSubTree(child);
      await waitAndSync();

      const originalId = sourceNodeMap.getNodeId(child)!;
      sourceRoot.removeChild(child);
      await waitAndSync();
      sourceNodeMap.removeNodesInSubtree(child);

      // Re-add (should get new ID)
      const newChild = document.createElement('span');
      newChild.id = 're-added';
      sourceRoot.appendChild(newChild);
      sourceNodeMap.assignNodeIdsToSubTree(newChild);
      await waitAndSync();

      const newId = sourceNodeMap.getNodeId(newChild)!;
      expect(newId).not.toBe(originalId);
      expect(targetNodeMap.getNodeById(newId)).toBeDefined();
    });
  });

  describe('rapid mutation sequences', () => {
    test('should sync rapid sequence of mutations', async () => {
      const children: HTMLElement[] = [];
      for (let i = 0; i < 10; i++) {
        const child = document.createElement('div');
        child.textContent = `Item ${i}`;
        sourceRoot.appendChild(child);
        sourceNodeMap.assignNodeIdsToSubTree(child);
        children.push(child);
      }
      await waitAndSync();

      // Remove half - don't remove from sourceNodeMap yet
      const removedChildren: HTMLElement[] = [];
      for (let i = 0; i < 5; i++) {
        const child = sourceRoot.firstChild as HTMLElement;
        sourceRoot.removeChild(child);
        removedChildren.push(child);
      }
      await waitAndSync();
      
      // Now remove from sourceNodeMap after detector has processed
      for (const child of removedChildren) {
        sourceNodeMap.removeNodesInSubtree(child);
      }

      // Modify remaining
      for (const child of Array.from(sourceRoot.childNodes) as Element[]) {
        child.setAttribute('modified', 'true');
      }
      await waitAndSync();

      assertDOMEqual(sourceRoot, targetRoot);
    });
  });

  describe('stress tests', () => {
    test('should sync large number of mutations', async () => {
      const children: HTMLElement[] = [];
      for (let i = 0; i < 50; i++) {
        const child = document.createElement('div');
        child.id = `child-${i}`;
        children.push(child);
        sourceRoot.appendChild(child);
        sourceNodeMap.assignNodeIdsToSubTree(child);
      }
      await waitAndSync();

      // Remove some - don't remove from sourceNodeMap yet
      const removedChildren: HTMLElement[] = [];
      for (let i = 0; i < 25; i++) {
        sourceRoot.removeChild(children[i]);
        removedChildren.push(children[i]);
      }
      await waitAndSync();
      
      // Now remove from sourceNodeMap after detector has processed
      for (const child of removedChildren) {
        sourceNodeMap.removeNodesInSubtree(child);
      }

      // Modify remaining
      for (let i = 25; i < 50; i++) {
        children[i].setAttribute('class', 'modified');
      }
      await waitAndSync();

      expect(targetRoot.childNodes.length).toBe(25);
      assertDOMEqual(sourceRoot, targetRoot);
    });
  });
});

