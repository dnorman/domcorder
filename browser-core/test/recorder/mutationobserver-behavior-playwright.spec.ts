import { test, expect } from '@playwright/test';

/**
 * Playwright tests for MutationObserver behavior validation
 * Runs the same tests as mutationobserver-behavior.test.ts but in real browsers
 * 
 * These tests validate the assumptions documented in MutationObservers.md across:
 * - Chromium
 * - Firefox
 * - WebKit
 */

// Helper to wait for microtask in browser context
const waitForMicrotask = () => new Promise(resolve => setTimeout(resolve, 0));

test.describe('MutationObserver Behavior Validation', () => {
  test('DOM should not change during callback execution (if callback does not mutate)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      
      const root = document.createElement('div');
      root.id = 'test-root';
      container.appendChild(root);

      let callbackInvocationCount = 0;
      const domStatesDuringCallback: string[] = [];
      const domStatesAfterCallback: string[] = [];

      const observer = new MutationObserver((mutations) => {
        callbackInvocationCount++;
        
        // Capture DOM state multiple times during callback execution
        domStatesDuringCallback.push(root.innerHTML);
        domStatesDuringCallback.push(root.innerHTML);
        domStatesDuringCallback.push(root.innerHTML);
      });

      observer.observe(root, { childList: true, subtree: true });

      // Perform mutations
      const child1 = document.createElement('div');
      child1.textContent = 'child1';
      root.appendChild(child1);

      const child2 = document.createElement('div');
      child2.textContent = 'child2';
      root.appendChild(child2);

      await new Promise(resolve => setTimeout(resolve, 0));

      // Capture DOM state after callback completes
      domStatesAfterCallback.push(root.innerHTML);

      observer.disconnect();

      container.remove();

      return {
        callbackInvocationCount,
        domStatesDuringCallback,
        domStatesAfterCallback,
        allStatesMatch: new Set(domStatesDuringCallback.slice(-3)).size === 1,
        callbackMatchesAfter: domStatesDuringCallback[domStatesDuringCallback.length - 1] === domStatesAfterCallback[0],
      };
    });

    expect(result.callbackInvocationCount).toBe(1);
    expect(result.allStatesMatch).toBe(true);
    expect(result.callbackMatchesAfter).toBe(true);
  });

  test('DOM mutations in callback should not appear in current batch', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = document.createElement('div');
      container.appendChild(root);

      let currentBatchMutations: MutationRecord[] = [];
      let subsequentBatchMutations: MutationRecord[] = [];

      const observer = new MutationObserver((mutations) => {
        if (currentBatchMutations.length === 0) {
          currentBatchMutations = [...mutations];
          
          // Mutate DOM during callback
          const newChild = document.createElement('span');
          newChild.textContent = 'from-callback';
          root.appendChild(newChild);
        } else {
          subsequentBatchMutations = [...mutations];
        }
      });

      observer.observe(root, { childList: true });

      // Initial mutation
      const child = document.createElement('div');
      child.textContent = 'initial';
      root.appendChild(child);

      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0)); // Wait for potential second callback

      observer.disconnect();

      const firstBatchAdded = currentBatchMutations.flatMap(m => Array.from(m.addedNodes));
      const hasInitial = firstBatchAdded.some((n: Node) => (n as HTMLElement).textContent === 'initial');
      const hasCallbackInFirst = firstBatchAdded.some((n: Node) => (n as HTMLElement).textContent === 'from-callback');
      
      let hasCallbackInSecond = false;
      if (subsequentBatchMutations.length > 0) {
        const secondBatchAdded = subsequentBatchMutations.flatMap(m => Array.from(m.addedNodes));
        hasCallbackInSecond = secondBatchAdded.some((n: Node) => (n as HTMLElement).textContent === 'from-callback');
      }

      container.remove();

      return {
        hasInitial,
        hasCallbackInFirst,
        hasCallbackInSecond,
        subsequentBatchCount: subsequentBatchMutations.length,
      };
    });

    expect(result.hasInitial).toBe(true);
    expect(result.hasCallbackInFirst).toBe(false);
    // If a second batch occurred, it should have the callback mutation
    if (result.subsequentBatchCount > 0) {
      expect(result.hasCallbackInSecond).toBe(true);
    }
  });

  test('MutationRecords may not be in temporal order', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = document.createElement('div');
      container.appendChild(root);

      const mutationOrder: Array<{ type: string; target: string; operation: string }> = [];

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation, idx) => {
          const added = Array.from(mutation.addedNodes).length;
          const removed = Array.from(mutation.removedNodes).length;
          mutationOrder.push({
            type: mutation.type,
            target: (mutation.target as HTMLElement).id || mutation.target.nodeName,
            operation: `record[${idx}]: +${added} -${removed}`
          });
        });
      });

      observer.observe(root, { childList: true, subtree: true });

      // Perform mutations in a specific order
      const child1 = document.createElement('div');
      child1.id = 'child1';
      root.appendChild(child1);

      const child2 = document.createElement('div');
      child2.id = 'child2';
      root.appendChild(child2);

      const grandchild = document.createElement('span');
      grandchild.id = 'grandchild';
      child1.appendChild(grandchild);

      await new Promise(resolve => setTimeout(resolve, 0));

      observer.disconnect();
      container.remove();

      return { mutationOrder };
    });

    expect(result.mutationOrder.length).toBeGreaterThan(0);
    const browserName = test.info().project.name || 'unknown';
    console.log(`[${browserName}] Observed MutationRecord order:`, result.mutationOrder);
  });

  test('Remove mutation may appear before add mutation for same node', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = document.createElement('div');
      container.appendChild(root);

      const nodeOperations: Array<{ type: 'add' | 'remove'; recordIndex: number }> = [];
      const testNode = document.createElement('div');
      testNode.id = 'test-node';

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation, recordIdx) => {
          Array.from(mutation.addedNodes).forEach(node => {
            if (node === testNode) {
              nodeOperations.push({ type: 'add', recordIndex: recordIdx });
            }
          });
          Array.from(mutation.removedNodes).forEach(node => {
            if (node === testNode) {
              nodeOperations.push({ type: 'remove', recordIndex: recordIdx });
            }
          });
        });
      });

      observer.observe(root, { childList: true });

      // Add then immediately remove (causally dependent operations)
      root.appendChild(testNode);
      root.removeChild(testNode);

      await new Promise(resolve => setTimeout(resolve, 0));

      observer.disconnect();
      container.remove();

      const addOp = nodeOperations.find(op => op.type === 'add');
      const removeOp = nodeOperations.find(op => op.type === 'remove');
      const causalOrderViolated = addOp && removeOp && removeOp.recordIndex < addOp.recordIndex;

      return {
        nodeOperations,
        addOp,
        removeOp,
        causalOrderViolated,
      };
    });

    expect(result.addOp).toBeDefined();
    expect(result.removeOp).toBeDefined();
    
    const browserName = test.info().project.name || 'unknown';
    console.log(`[${browserName}] Causal ordering test: remove at record[${result.removeOp?.recordIndex}], add at record[${result.addOp?.recordIndex}]`);
    console.log(`[${browserName}] Causal order violated: ${result.causalOrderViolated}`);
    
    // Document behavior - don't assert (behavior varies by browser)
  });

  test('All mutations in single macrotask should be in one batch', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = document.createElement('div');
      container.appendChild(root);

      let callbackCount = 0;
      let totalMutations = 0;

      const observer = new MutationObserver((mutations) => {
        callbackCount++;
        totalMutations += mutations.length;
      });

      observer.observe(root, { childList: true });

      // All mutations in single synchronous block (single macrotask)
      root.appendChild(document.createElement('div'));
      root.appendChild(document.createElement('div'));
      root.appendChild(document.createElement('div'));

      await new Promise(resolve => setTimeout(resolve, 0));

      observer.disconnect();
      container.remove();

      return { callbackCount, totalMutations };
    });

    expect(result.callbackCount).toBe(1);
    expect(result.totalMutations).toBeGreaterThan(0);
  });

  test('DOM shows final state after all mutations in batch', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = document.createElement('div');
      container.appendChild(root);

      let domStateInCallback: string | null = null;
      let domStateAfterCallback: string | null = null;

      const observer = new MutationObserver((mutations) => {
        domStateInCallback = root.innerHTML;
      });

      observer.observe(root, { childList: true });

      // Add then remove node (final state: node doesn't exist)
      const child = document.createElement('div');
      child.textContent = 'transient';
      root.appendChild(child);
      root.removeChild(child);

      await new Promise(resolve => setTimeout(resolve, 0));

      domStateAfterCallback = root.innerHTML;

      observer.disconnect();
      container.remove();

      return {
        domStateInCallback,
        domStateAfterCallback,
        statesMatch: domStateInCallback === domStateAfterCallback,
        containsTransient: domStateInCallback?.includes('transient') || false,
      };
    });

    expect(result.containsTransient).toBe(false);
    expect(result.statesMatch).toBe(true);
  });

  test('Node can appear in both addedNodes and removedNodes across records', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = document.createElement('div');
      container.appendChild(root);

      const allAdded: Node[] = [];
      const allRemoved: Node[] = [];

      const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          allAdded.push(...Array.from(mutation.addedNodes));
          allRemoved.push(...Array.from(mutation.removedNodes));
        });
      });

      observer.observe(root, { childList: true });

      // Add then remove in same batch
      const child = document.createElement('div');
      root.appendChild(child);
      root.removeChild(child);

      await new Promise(resolve => setTimeout(resolve, 0));

      observer.disconnect();

      const inBoth = allAdded.filter(node => allRemoved.includes(node));

      container.remove();

      return {
        totalAdded: allAdded.length,
        totalRemoved: allRemoved.length,
        inBothCount: inBoth.length,
      };
    });

    expect(result.totalAdded).toBeGreaterThan(0);
    expect(result.totalRemoved).toBeGreaterThan(0);
    
    const browserName = test.info().project.name || 'unknown';
    console.log(`[${browserName}] Total added: ${result.totalAdded}, Total removed: ${result.totalRemoved}`);
    console.log(`[${browserName}] Nodes in both: ${result.inBothCount}`);
    
    if (result.inBothCount > 0) {
      console.log(`[${browserName}] ✓ CONFIRMED: Node CAN appear in both addedNodes and removedNodes`);
    }
  });

  test('DocumentFragment children appear in addedNodes, not fragment itself', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = document.createElement('div');
      container.appendChild(root);

      const addedNodes: Node[] = [];
      const fragmentNodes: Node[] = [];

      const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          Array.from(mutation.addedNodes).forEach(node => {
            addedNodes.push(node);
            if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
              fragmentNodes.push(node);
            }
          });
        });
      });

      observer.observe(root, { childList: true });

      // Create fragment and append
      const fragment = document.createDocumentFragment();
      const child1 = document.createElement('div');
      child1.id = 'frag-child-1';
      const child2 = document.createElement('div');
      child2.id = 'frag-child-2';
      fragment.appendChild(child1);
      fragment.appendChild(child2);
      root.appendChild(fragment);

      await new Promise(resolve => setTimeout(resolve, 0));

      observer.disconnect();

      const childIds = addedNodes
        .filter((n: Node) => n.nodeType === Node.ELEMENT_NODE)
        .map((n: Node) => (n as HTMLElement).id);

      container.remove();

      return {
        fragmentNodesCount: fragmentNodes.length,
        childIds,
        hasChild1: childIds.includes('frag-child-1'),
        hasChild2: childIds.includes('frag-child-2'),
      };
    });

    expect(result.hasChild1).toBe(true);
    expect(result.hasChild2).toBe(true);
    expect(result.fragmentNodesCount).toBe(0);
  });

  test('Multiple attribute changes may be coalesced', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = document.createElement('div');
      container.appendChild(root);

      let recordCount = 0;
      let attributeChanges = 0;

      const observer = new MutationObserver((mutations) => {
        recordCount = mutations.length;
        attributeChanges = mutations.filter(m => m.type === 'attributes').length;
      });

      observer.observe(root, { attributes: true, attributeOldValue: true });

      // Change multiple attributes rapidly
      root.setAttribute('attr1', 'value1');
      root.setAttribute('attr2', 'value2');
      root.setAttribute('attr3', 'value3');

      await new Promise(resolve => setTimeout(resolve, 0));

      observer.disconnect();
      container.remove();

      return { attributeChanges, recordCount };
    });

    expect(result.attributeChanges).toBeGreaterThan(0);
    const browserName = test.info().project.name || 'unknown';
    console.log(`[${browserName}] Attribute records: ${result.attributeChanges}, Total records: ${result.recordCount}`);
  });
});

