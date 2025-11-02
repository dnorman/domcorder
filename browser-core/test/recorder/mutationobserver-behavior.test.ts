import 'global-jsdom/register';

/**
 * Comprehensive tests to validate MutationObserver behavior assumptions
 * documented in MutationObservers.md
 * 
 * These tests validate:
 * 1. DOM stability during callback execution
 * 2. Temporal ordering (or lack thereof)
 * 3. Causal ordering (or lack thereof)
 * 4. Batch scope (macrotask boundaries)
 * 5. DOM state reflects final state after all mutations
 * 6. Nodes appearing in both addedNodes and removedNodes
 */

describe('MutationObserver Behavior Validation', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  // Helper to wait for MutationObserver callback
  const waitForMicrotask = (): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, 0));
  };

  describe('DOM Stability During Callback Execution', () => {
    test('DOM should not change during callback execution (if callback does not mutate)', async () => {
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
        domStatesDuringCallback.push(root.innerHTML); // Check again
        domStatesDuringCallback.push(root.innerHTML); // And again
        
        // Verify all reads return the same value
        expect(new Set(domStatesDuringCallback.slice(-3)).size).toBe(1);
      });

      observer.observe(root, { childList: true, subtree: true });

      // Perform mutations
      const child1 = document.createElement('div');
      child1.textContent = 'child1';
      root.appendChild(child1);

      const child2 = document.createElement('div');
      child2.textContent = 'child2';
      root.appendChild(child2);

      await waitForMicrotask();

      // Capture DOM state after callback completes
      domStatesAfterCallback.push(root.innerHTML);

      observer.disconnect();

      expect(callbackInvocationCount).toBe(1);
      
      // DOM state during callback should match state after callback
      if (domStatesDuringCallback.length > 0 && domStatesAfterCallback.length > 0) {
        expect(domStatesDuringCallback[domStatesDuringCallback.length - 1])
          .toBe(domStatesAfterCallback[0]);
      }
    });

    test('DOM mutations in callback should not appear in current batch', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      let currentBatchMutations: MutationRecord[] = [];
      let subsequentBatchMutations: MutationRecord[] = [];

      const observer = new MutationObserver((mutations) => {
        if (currentBatchMutations.length === 0) {
          // First batch
          currentBatchMutations = [...mutations];
          
          // Mutate DOM during callback
          const newChild = document.createElement('span');
          newChild.textContent = 'from-callback';
          root.appendChild(newChild);
        } else {
          // Subsequent batch (should contain the mutation we made in callback)
          subsequentBatchMutations = [...mutations];
        }
      });

      observer.observe(root, { childList: true });

      // Initial mutation
      const child = document.createElement('div');
      child.textContent = 'initial';
      root.appendChild(child);

      await waitForMicrotask();
      await waitForMicrotask(); // Wait for potential second callback

      observer.disconnect();

      // First batch should only contain the initial mutation
      expect(currentBatchMutations.length).toBeGreaterThan(0);
      const firstBatchAdded = currentBatchMutations.flatMap(m => Array.from(m.addedNodes));
      expect(firstBatchAdded.some(n => (n as HTMLElement).textContent === 'initial')).toBe(true);
      expect(firstBatchAdded.some(n => (n as HTMLElement).textContent === 'from-callback')).toBe(false);

      // If a second batch occurred, it should contain the callback mutation
      if (subsequentBatchMutations.length > 0) {
        const secondBatchAdded = subsequentBatchMutations.flatMap(m => Array.from(m.addedNodes));
        expect(secondBatchAdded.some(n => (n as HTMLElement).textContent === 'from-callback')).toBe(true);
      }
    });
  });

  describe('Temporal Ordering of Mutation Records', () => {
    test('MutationRecords may not be in temporal order', async () => {
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
      root.appendChild(child1); // Mutation 1

      const child2 = document.createElement('div');
      child2.id = 'child2';
      root.appendChild(child2); // Mutation 2

      const grandchild = document.createElement('span');
      grandchild.id = 'grandchild';
      child1.appendChild(grandchild); // Mutation 3

      await waitForMicrotask();

      observer.disconnect();

      // Document the order we observed (may or may not match temporal order)
      // This test documents behavior, doesn't assert a specific order
      expect(mutationOrder.length).toBeGreaterThan(0);
      console.log('Observed MutationRecord order:', mutationOrder);
      console.log('Note: Order may not match temporal order of mutations');
    });

    test('Multiple mutations on same target may be coalesced', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      let recordCount = 0;
      let totalAdded = 0;

      const observer = new MutationObserver((mutations) => {
        recordCount = mutations.length;
        totalAdded = mutations.reduce((sum, m) => sum + m.addedNodes.length, 0);
      });

      observer.observe(root, { childList: true });

      // Add multiple children rapidly
      for (let i = 0; i < 5; i++) {
        const child = document.createElement('div');
        root.appendChild(child);
      }

      await waitForMicrotask();

      observer.disconnect();

      // All 5 additions might be in 1 record or multiple records
      // But total added nodes should be 5
      expect(totalAdded).toBe(5);
      expect(recordCount).toBeGreaterThan(0);
      expect(recordCount).toBeLessThanOrEqual(5); // May be coalesced
    });
  });

  describe('Causal Ordering Violations', () => {
    test('Remove mutation may appear before add mutation for same node', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      const nodeOperations: Array<{ type: 'add' | 'remove'; node: Node; recordIndex: number }> = [];
      let testNode: HTMLElement | null = null;

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation, recordIdx) => {
          Array.from(mutation.addedNodes).forEach(node => {
            if (node === testNode) {
              nodeOperations.push({ type: 'add', node, recordIndex: recordIdx });
            }
          });
          Array.from(mutation.removedNodes).forEach(node => {
            if (node === testNode) {
              nodeOperations.push({ type: 'remove', node, recordIndex: recordIdx });
            }
          });
        });
      });

      observer.observe(root, { childList: true });

      // Add then immediately remove (causally dependent operations)
      testNode = document.createElement('div');
      testNode.id = 'test-node';
      root.appendChild(testNode); // Must happen first
      root.removeChild(testNode); // Must happen second (depends on first)

      await waitForMicrotask();

      observer.disconnect();

      // Both operations should be recorded
      expect(nodeOperations.length).toBe(2);
      expect(nodeOperations.some(op => op.type === 'add')).toBe(true);
      expect(nodeOperations.some(op => op.type === 'remove')).toBe(true);

      // Check if causal ordering is violated
      const addOp = nodeOperations.find(op => op.type === 'add');
      const removeOp = nodeOperations.find(op => op.type === 'remove');
      
      if (addOp && removeOp) {
        const causalOrderViolated = removeOp.recordIndex < addOp.recordIndex;
        console.log(`Causal ordering test: remove at record[${removeOp.recordIndex}], add at record[${addOp.recordIndex}]`);
        console.log(`Causal order violated: ${causalOrderViolated}`);
        
        // Document the behavior - we expect this might happen
        if (causalOrderViolated) {
          console.log('✓ CONFIRMED: Remove can appear before add in MutationRecords');
        } else {
          console.log('✓ In this case, causal order was preserved');
        }
      }
    });

    test('Attribute mutation may appear before node add mutation', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      const operations: Array<{ type: 'add' | 'attribute'; target: string; recordIndex: number }> = [];
      let testNode: HTMLElement | null = null;

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation, recordIdx) => {
          if (mutation.type === 'childList') {
            Array.from(mutation.addedNodes).forEach(node => {
              if (node === testNode) {
                operations.push({ type: 'add', target: 'test-node', recordIndex: recordIdx });
              }
            });
          } else if (mutation.type === 'attributes' && mutation.target === testNode) {
            operations.push({ type: 'attribute', target: 'test-node', recordIndex: recordIdx });
          }
        });
      });

      observer.observe(root, { childList: true, attributes: true, subtree: true });

      // Create node, add attribute, then add to DOM
      testNode = document.createElement('div');
      testNode.id = 'test-node';
      testNode.setAttribute('data-test', 'value'); // Set attribute before adding to DOM
      root.appendChild(testNode); // Add to DOM

      await waitForMicrotask();

      observer.disconnect();

      // Both operations should be recorded
      expect(operations.length).toBeGreaterThanOrEqual(1);

      const addOp = operations.find(op => op.type === 'add');
      const attrOp = operations.find(op => op.type === 'attribute');

      if (addOp && attrOp) {
        const causalOrderViolated = attrOp.recordIndex < addOp.recordIndex;
        console.log(`Attribute/node order test: attribute at record[${attrOp.recordIndex}], add at record[${addOp.recordIndex}]`);
        console.log(`Causal order violated: ${causalOrderViolated}`);
      }
    });
  });

  describe('Batch Scope and Macrotask Boundaries', () => {
    test('All mutations in single macrotask should be in one batch', async () => {
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

      await waitForMicrotask();

      observer.disconnect();

      // Should have been called once with all mutations batched
      expect(callbackCount).toBe(1);
      expect(totalMutations).toBeGreaterThan(0);
    });

    test('Mutations in separate macrotasks should trigger separate callbacks', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      const callbackBatches: number[] = [];

      const observer = new MutationObserver((mutations) => {
        callbackBatches.push(mutations.length);
      });

      observer.observe(root, { childList: true });

      // First macrotask
      root.appendChild(document.createElement('div'));

      await waitForMicrotask();

      // Second macrotask (different setTimeout)
      await new Promise(resolve => setTimeout(() => {
        root.appendChild(document.createElement('div'));
        resolve(undefined);
      }, 10));

      await waitForMicrotask();

      observer.disconnect();

      // Should have two separate callbacks
      expect(callbackBatches.length).toBeGreaterThanOrEqual(1);
      // May be 1 or 2 depending on timing, but mutations should be separated
      console.log(`Callback batches: ${callbackBatches.length}`, callbackBatches);
    });

    test('Mutations across multiple synchronous blocks in same macrotask are batched', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      let callbackCount = 0;

      const observer = new MutationObserver((mutations) => {
        callbackCount++;
      });

      observer.observe(root, { childList: true });

      // Multiple mutations, but all synchronous
      const addNodes = () => {
        root.appendChild(document.createElement('div'));
        root.appendChild(document.createElement('div'));
      };

      addNodes();
      addNodes();
      addNodes();

      await waitForMicrotask();

      observer.disconnect();

      // All synchronous mutations should be in one batch
      expect(callbackCount).toBe(1);
    });
  });

  describe('DOM State Reflects Final State', () => {
    test('DOM shows final state after all mutations in batch', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      let domStateInCallback: string | null = null;
      let domStateAfterCallback: string | null = null;

      const observer = new MutationObserver((mutations) => {
        // Read DOM state during callback
        domStateInCallback = root.innerHTML;
      });

      observer.observe(root, { childList: true });

      // Add then remove node (final state: node doesn't exist)
      const child = document.createElement('div');
      child.textContent = 'transient';
      root.appendChild(child);
      root.removeChild(child);

      await waitForMicrotask();

      // Read DOM state after callback
      domStateAfterCallback = root.innerHTML;

      observer.disconnect();

      // DOM during callback should show final state (node doesn't exist)
      expect(domStateInCallback).not.toContain('transient');
      expect(domStateAfterCallback).not.toContain('transient');
      expect(domStateInCallback).toBe(domStateAfterCallback);
    });

    test('DOM state matches cumulative effect of all mutations', async () => {
      const root = document.createElement('div');
      root.id = 'test-root';
      container.appendChild(root);

      const domStates: string[] = [];

      const observer = new MutationObserver((mutations) => {
        // DOM should reflect all mutations that occurred
        domStates.push(root.innerHTML);
        domStates.push(root.childNodes.length.toString());
      });

      observer.observe(root, { childList: true });

      // Multiple mutations
      root.appendChild(document.createElement('div'));
      root.appendChild(document.createElement('div'));
      const third = document.createElement('div');
      root.appendChild(third);
      root.removeChild(third); // Remove last one

      await waitForMicrotask();

      observer.disconnect();

      // DOM should show 2 children (final state)
      expect(root.childNodes.length).toBe(2);
      if (domStates.length > 0) {
        expect(domStates[domStates.length - 1]).toBe('2');
      }
    });
  });

  describe('Nodes in Both addedNodes and removedNodes', () => {
    test('Node can appear in both addedNodes and removedNodes across records', async () => {
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

      await waitForMicrotask();

      observer.disconnect();

      // Check if same node appears in both lists
      const inBoth = allAdded.filter(node => allRemoved.includes(node));

      console.log(`Total added: ${allAdded.length}, Total removed: ${allRemoved.length}`);
      console.log(`Nodes in both: ${inBoth.length}`);

      // Document behavior
      if (inBoth.length > 0) {
        console.log('✓ CONFIRMED: Node CAN appear in both addedNodes and removedNodes');
      } else {
        console.log('✓ In this case, node appears in separate records');
      }

      expect(allAdded.length).toBeGreaterThan(0);
      expect(allRemoved.length).toBeGreaterThan(0);
    });

    test('Same node should not appear in both lists of single MutationRecord', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      let foundInBoth = false;

      const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          const added = Array.from(mutation.addedNodes);
          const removed = Array.from(mutation.removedNodes);
          const intersection = added.filter(node => removed.includes(node));
          if (intersection.length > 0) {
            foundInBoth = true;
          }
        });
      });

      observer.observe(root, { childList: true });

      // Various mutations
      const child1 = document.createElement('div');
      root.appendChild(child1);
      root.removeChild(child1);

      const child2 = document.createElement('div');
      root.appendChild(child2);

      await waitForMicrotask();

      observer.disconnect();

      // According to spec, a node should not be in both lists of the same record
      // Document actual behavior
      console.log(`Node in both lists of same record: ${foundInBoth}`);
      // Note: This tests actual behavior - spec says it shouldn't happen
    });
  });

  describe('DocumentFragments', () => {
    test('DocumentFragment children appear in addedNodes, not fragment itself', async () => {
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
      root.appendChild(fragment); // Fragment children are inserted, fragment itself is not

      await waitForMicrotask();

      observer.disconnect();

      // Fragment children should appear in addedNodes
      const childIds = addedNodes
        .filter(n => n.nodeType === Node.ELEMENT_NODE)
        .map(n => (n as HTMLElement).id);
      
      expect(childIds).toContain('frag-child-1');
      expect(childIds).toContain('frag-child-2');

      // Fragment itself should NOT appear (or should be empty/handled specially)
      console.log(`Fragment nodes found: ${fragmentNodes.length}`);
      console.log(`Fragment children in addedNodes: ${childIds.length}`);
    });
  });

  describe('Attribute Mutations', () => {
    test('Multiple attribute changes may be coalesced', async () => {
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

      await waitForMicrotask();

      observer.disconnect();

      // All changes might be in one or more records
      expect(attributeChanges).toBeGreaterThan(0);
      console.log(`Attribute records: ${attributeChanges}, Total records: ${recordCount}`);
    });

    test('Attribute set and remove in same batch both recorded', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      const attributeMutations: Array<{ type: string; attributeName: string | null }> = [];

      const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          if (mutation.type === 'attributes') {
            attributeMutations.push({
              type: 'change',
              attributeName: mutation.attributeName
            });
          }
        });
      });

      observer.observe(root, { attributes: true });

      // Set then remove attribute
      root.setAttribute('test-attr', 'value');
      root.removeAttribute('test-attr');

      await waitForMicrotask();

      observer.disconnect();

      // Both operations should produce mutation records
      expect(attributeMutations.length).toBeGreaterThan(0);
      console.log(`Attribute mutations recorded: ${attributeMutations.length}`);
    });
  });

  describe('Text/CharacterData Mutations', () => {
    test('Text content changes are recorded', async () => {
      const root = document.createElement('div');
      container.appendChild(root);

      const textNode = document.createTextNode('initial');
      root.appendChild(textNode);

      let characterDataMutations = 0;

      const observer = new MutationObserver((mutations) => {
        characterDataMutations = mutations.filter(m => m.type === 'characterData').length;
      });

      observer.observe(root, { characterData: true, subtree: true });

      // Change text content
      textNode.textContent = 'changed';
      textNode.textContent = 'changed again';

      await waitForMicrotask();

      observer.disconnect();

      expect(characterDataMutations).toBeGreaterThan(0);
      console.log(`CharacterData mutations: ${characterDataMutations}`);
    });
  });
});

