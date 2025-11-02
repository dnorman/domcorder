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

    let mutationRecords: MutationRecord[] = [];

    const observer = new MutationObserver((mutations) => {
      // Capture ALL mutation records
      mutationRecords = [...mutations];
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
        
        console.log('Mutation Records Analysis:');
        console.log('  Total mutation records:', mutationRecords.length);
        
        if (mutationRecords.length > 0) {
          mutationRecords.forEach((record, idx) => {
            const addedNodes = Array.from(record.addedNodes);
            const removedNodes = Array.from(record.removedNodes);
            
            console.log(`\n  Mutation Record ${idx + 1}:`);
            console.log('    Type:', record.type);
            console.log('    Target:', record.target.nodeName);
            console.log('    Added nodes count:', addedNodes.length);
            console.log('    Removed nodes count:', removedNodes.length);
            
            // Check if any node appears in both IN THIS RECORD
            const inBoth = addedNodes.filter(node => removedNodes.includes(node));
            
            if (inBoth.length > 0) {
              console.log('    ✓ Node appears in BOTH addedNodes and removedNodes in this record!');
              console.log('    Nodes in both:', inBoth.length);
            }
          });
          
          // Check across ALL records
          const allAdded = mutationRecords.flatMap(r => Array.from(r.addedNodes));
          const allRemoved = mutationRecords.flatMap(r => Array.from(r.removedNodes));
          const inBothAcrossRecords = allAdded.filter(node => allRemoved.includes(node));
          
          console.log('\n  Cross-Record Analysis:');
          console.log('    Total added nodes across all records:', allAdded.length);
          console.log('    Total removed nodes across all records:', allRemoved.length);
          console.log('    Nodes that appear in both lists (across all records):', inBothAcrossRecords.length);
          
          if (inBothAcrossRecords.length > 0) {
            console.log('\n  ✓ RESULT: A node CAN appear in both addedNodes and removedNodes');
            console.log('    (possibly across different MutationRecords)');
          } else {
            console.log('\n  ✗ RESULT: A node does NOT appear in both lists');
            console.log('    MutationObserver may batch or filter out rapid add/remove cycles');
          }
        } else {
          console.log('  No mutation records captured');
        }
        
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
        
        resolve();
      }, 10);
    });
  });
});

