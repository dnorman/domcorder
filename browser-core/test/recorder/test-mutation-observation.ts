import 'global-jsdom/register';

/**
 * Test to verify if a node can appear in both addedNodes and removedNodes
 * of the same MutationRecord according to the MutationObserver spec
 */

describe('MutationObserver Behavior Validation', () => {
  test('can a node appear in both addedNodes and removedNodes of same MutationRecord?', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    
    const root = document.createElement('div');
    root.id = 'root';
    container.appendChild(root);

    let mutationRecord: MutationRecord | null = null;

    const observer = new MutationObserver((mutations) => {
      // Capture the first mutation record
      if (mutations.length > 0) {
        mutationRecord = mutations[0];
      }
    });

    observer.observe(root, { childList: true });

    // Test: Add and immediately remove in same synchronous operation
    const child = document.createElement('div');
    root.appendChild(child);
    root.removeChild(child);

    // MutationObserver callbacks are asynchronous, so we need to wait
    // But in practice, the callback fires after the synchronous code completes
    
    // Force a microtask to process
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        observer.disconnect();
        
        if (mutationRecord) {
          const addedNodes = Array.from(mutationRecord.addedNodes);
          const removedNodes = Array.from(mutationRecord.removedNodes);
          
          console.log('Mutation Record Analysis:');
          console.log('  Type:', mutationRecord.type);
          console.log('  Added nodes count:', addedNodes.length);
          console.log('  Removed nodes count:', removedNodes.length);
          console.log('  Added nodes:', addedNodes);
          console.log('  Removed nodes:', removedNodes);
          
          // Check if any node appears in both
          const inBoth = addedNodes.filter(node => removedNodes.includes(node));
          
          console.log('  Nodes in BOTH addedNodes and removedNodes:', inBoth.length);
          
          if (inBoth.length > 0) {
            console.log('  ✓ CONFIRMED: Node CAN appear in both addedNodes and removedNodes');
            console.log('  Nodes in both:', inBoth);
          } else {
            console.log('  ✗ Node does NOT appear in both - they are separate mutations');
          }
          
          // Document the actual behavior
          if (inBoth.length > 0) {
            expect(inBoth.length).toBeGreaterThan(0);
            console.log('\n  RESULT: According to this test, a node CAN be in both lists.');
          } else {
            console.log('\n  RESULT: According to this test, a node is NOT in both lists.');
            console.log('  This suggests separate MutationRecords are created.');
          }
        } else {
          console.log('No mutation record captured');
        }
        
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
        
        resolve();
      }, 10);
    });
  });
});

