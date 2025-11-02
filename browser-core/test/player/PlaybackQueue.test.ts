import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PlaybackQueue } from "../../src/player/PlaybackQueue";
import { Frame, Timestamp, StyleSheetRuleInserted } from "@domcorder/proto-ts";

describe("PlaybackQueue", () => {
  let handledFrames: Array<{ frame: Frame; timestamp: number }> = [];
  let operationOrder: number[] = [];
  let operationCounter = 0;

  beforeEach(() => {
    handledFrames = [];
    operationOrder = [];
    operationCounter = 0;
  });

  function createPlaybackHandler(delayMs: number = 0): (frame: Frame, timestamp: number) => Promise<void> {
    return async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    };
  }

  test("processes immediate frames sequentially", async () => {
    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });
      
      // Add a small delay
      await new Promise(resolve => setTimeout(resolve, 10));
    };

    const queue = new PlaybackQueue(false, handler);

    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    
    // Small delay to let first frame start processing
    await new Promise(resolve => setTimeout(resolve, 5));
    
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2"));
    queue.enqueueFrame(new StyleSheetRuleInserted(3, 2, "rule3"));

    // Wait for all operations to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify operations happened in order
    expect(operationOrder).toEqual([0, 1, 2]);
    expect(handledFrames.length).toBe(3);
  });

  test("processes immediate frames sequentially even with async delays", async () => {
    const queue = new PlaybackQueue(false, createPlaybackHandler(20));

    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2"));
    queue.enqueueFrame(new StyleSheetRuleInserted(3, 2, "rule3"));

    // Wait for all operations to complete (3 operations * 20ms each = 60ms minimum)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify operations happened in order
    expect(operationOrder).toEqual([0, 1, 2]);
    expect(handledFrames.length).toBe(3);
  });

  test("queues frames when something is processing", async () => {
    let firstOperationResolve: () => void;
    const firstOperationPromise = new Promise<void>(resolve => {
      firstOperationResolve = resolve;
    });

    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      if (opId === 0) {
        // First operation waits
        await firstOperationPromise;
      }
    };

    const queue = new PlaybackQueue(false, handler);

    // Start first frame
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));

    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 10));

    // Enqueue more frames while first is processing
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2"));
    queue.enqueueFrame(new StyleSheetRuleInserted(3, 2, "rule3"));

    // Verify second and third are queued (not processed yet)
    expect(handledFrames.length).toBe(1);

    // Release first operation
    firstOperationResolve!();

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Now all should be processed in order
    expect(operationOrder).toEqual([0, 1, 2]);
    expect(handledFrames.length).toBe(3);
  });

  test("processes queued buckets sequentially with correct timestamps", async () => {
    const queue = new PlaybackQueue(false, createPlaybackHandler(10));

    // Use timestamps of 0 to ensure immediate processing
    const timestamp1 = new Timestamp(0n);
    const timestamp2 = new Timestamp(0n);
    const timestamp3 = new Timestamp(0n);

    queue.enqueueFrame(timestamp1);
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    queue.enqueueFrame(timestamp2);
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2"));
    queue.enqueueFrame(timestamp3);
    queue.enqueueFrame(new StyleSheetRuleInserted(3, 2, "rule3"));

    // Wait for processing (timestamps are 0, so should process immediately)
    await new Promise(resolve => setTimeout(resolve, 150));

    // All operations should be in order
    expect(operationOrder.length).toBe(3);
    expect(operationOrder).toEqual([0, 1, 2]);
    
    // Verify timestamps are preserved (all should be 0)
    expect(handledFrames[0].timestamp).toBe(0);
    expect(handledFrames[1].timestamp).toBe(0);
    expect(handledFrames[2].timestamp).toBe(0);
  });

  test("handles mixed immediate and queued frames correctly", async () => {
    let resolveFirst: () => void;
    const firstComplete = new Promise<void>(resolve => {
      resolveFirst = resolve;
    });

    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      if (opId === 0) {
        await firstComplete;
      }
    };

    const queue = new PlaybackQueue(false, handler);

    // Immediate frame
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));

    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 10));

    // Queue some frames
    const timestamp = new Timestamp(0n); // Use 0 for immediate processing
    queue.enqueueFrame(timestamp);
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2"));

    // Another frame should be queued since first is still processing
    queue.enqueueFrame(new StyleSheetRuleInserted(3, 2, "rule3"));

    expect(handledFrames.length).toBe(1);

    // Release first operation
    resolveFirst!();

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // All should be processed: frame 1 (op 0), then frames 2 and 3 from bucket (ops 1, 2)
    expect(operationOrder.length).toBe(3);
    expect(operationOrder).toEqual([0, 1, 2]);
  });

  test("processFrameQueue waits for pending operations", async () => {
    let resolveImmediate: () => void;
    const immediateComplete = new Promise<void>(resolve => {
      resolveImmediate = resolve;
    });

    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      if (opId === 0) {
        // Immediate operation waits
        await immediateComplete;
      }
    };

    const queue = new PlaybackQueue(false, handler);

    // Start immediate frame
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));

    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 10));

    // Queue a bucket (timestamp 0 means ready to process, but will wait for op 0)
    const timestamp = new Timestamp(0n);
    queue.enqueueFrame(timestamp);
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2"));

    // The bucket should wait for the immediate operation to complete
    expect(handledFrames.length).toBe(1);

    // Release immediate operation
    resolveImmediate!();

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have processed op 0 (immediate) then op 1 (from bucket)
    expect(operationOrder.length).toBe(2);
    expect(operationOrder).toEqual([0, 1]);
  });

  test("handles rapid sequential immediate frames", async () => {
    const queue = new PlaybackQueue(false, createPlaybackHandler(5));

    // Enqueue 10 frames rapidly
    for (let i = 0; i < 10; i++) {
      queue.enqueueFrame(new StyleSheetRuleInserted(i, i, `rule${i}`));
    }

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify all processed and in order
    expect(operationOrder.length).toBe(10);
    expect(operationOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("prevents concurrent processFrameQueue calls", async () => {
    const handler = createPlaybackHandler(10);
    const queue = new PlaybackQueue(false, handler);

    // Create multiple buckets that should all trigger processing
    queue.enqueueFrame(new Timestamp(0n));
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    queue.enqueueFrame(new Timestamp(0n));
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2"));
    queue.enqueueFrame(new Timestamp(0n));
    queue.enqueueFrame(new StyleSheetRuleInserted(3, 2, "rule3"));

    // Wait for all processing
    await new Promise(resolve => setTimeout(resolve, 150));

    // Operations should be sequential, not concurrent
    expect(operationOrder.length).toBeGreaterThan(0);
    // Verify operations are in order (not interleaved)
    for (let i = 1; i < operationOrder.length; i++) {
      expect(operationOrder[i]).toBeGreaterThan(operationOrder[i - 1]);
    }
  });

  // Live mode tests
  test("live mode processes frames immediately when not busy", async () => {
    const handler = createPlaybackHandler(10);
    const queue = new PlaybackQueue(true, handler);

    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(handledFrames.length).toBe(1);
    expect(operationOrder).toEqual([0]);
  });

  test("live mode queues frames when operation is pending", async () => {
    let resolveFirst: () => void;
    const firstComplete = new Promise<void>(resolve => {
      resolveFirst = resolve;
    });

    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      if (opId === 0) {
        await firstComplete;
      }
    };

    const queue = new PlaybackQueue(true, handler);

    // Start first frame
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    await new Promise(resolve => setTimeout(resolve, 10));

    // Queue more frames
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2"));
    queue.enqueueFrame(new StyleSheetRuleInserted(3, 2, "rule3"));

    expect(handledFrames.length).toBe(1);

    // Release first operation
    resolveFirst!();

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(operationOrder).toEqual([0, 1, 2]);
    expect(handledFrames.length).toBe(3);
  });

  test("live mode preserves timestamp context across buckets", async () => {
    let resolveFirst: () => void;
    const firstComplete = new Promise<void>(resolve => {
      resolveFirst = resolve;
    });

    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      if (opId === 0) {
        await firstComplete;
      }
    };

    const queue = new PlaybackQueue(true, handler);

    // Start first frame
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    await new Promise(resolve => setTimeout(resolve, 10));

    // Receive timestamp T1 and operations
    queue.enqueueFrame(new Timestamp(100n));
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2"));
    queue.enqueueFrame(new StyleSheetRuleInserted(3, 2, "rule3"));

    // Receive timestamp T2 and operations
    queue.enqueueFrame(new Timestamp(200n));
    queue.enqueueFrame(new StyleSheetRuleInserted(4, 3, "rule4"));
    queue.enqueueFrame(new StyleSheetRuleInserted(5, 4, "rule5"));

    expect(handledFrames.length).toBe(1);

    // Release first operation
    resolveFirst!();

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // All should be processed in order
    expect(operationOrder).toEqual([0, 1, 2, 3, 4]);
    expect(handledFrames.length).toBe(5);
    
    // Verify timestamps are preserved correctly
    // Frame 0 uses lastPlayedTimestamp (0 initially, or whatever was set)
    // Frames 1,2 should have timestamp 100
    expect(handledFrames[1].timestamp).toBe(100);
    expect(handledFrames[2].timestamp).toBe(100);
    // Frames 3,4 should have timestamp 200
    expect(handledFrames[3].timestamp).toBe(200);
    expect(handledFrames[4].timestamp).toBe(200);
  });

  // Race condition regression tests
  test("REGRESSION: live mode prevents queue skipping when frames arrive rapidly", async () => {
    // This tests the fix for the race condition where frames would bypass the queue
    // if pendingOperation was null but queue had items.
    // 
    // Scenario: Frame at index 127 completes, frames 128-142 are queued, 
    // frame 143 arrives and should NOT process immediately.
    
    let resolveFirst: () => void;
    const firstComplete = new Promise<void>(resolve => {
      resolveFirst = resolve;
    });

    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      if (opId === 0) {
        // First operation blocks
        await firstComplete;
      }
      // All other operations complete immediately
    };

    const queue = new PlaybackQueue(true, handler);

    // Start first frame and let it begin processing
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule at index 127"));
    await new Promise(resolve => setTimeout(resolve, 10));

    // Queue frames 128-142 (15 frames)
    for (let i = 2; i <= 16; i++) {
      queue.enqueueFrame(new StyleSheetRuleInserted(i, i - 1, `rule at index ${127 + i - 1}`));
    }

    // Verify they're queued
    expect(handledFrames.length).toBe(1);

    // Release first frame
    resolveFirst!();
    
    // Give a tiny window for queue processing to start
    await new Promise(resolve => setTimeout(resolve, 5));

    // NOW arrive with frame 143 - this should be queued, not processed immediately
    queue.enqueueFrame(new StyleSheetRuleInserted(17, 16, "rule at index 143"));

    // Wait for all processing to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // All 17 frames should be processed in strict sequential order
    expect(handledFrames.length).toBe(17);
    expect(operationOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    
    // Verify the frames are in the correct order
    for (let i = 0; i < handledFrames.length; i++) {
      expect((handledFrames[i].frame as StyleSheetRuleInserted).styleSheetId).toBe(i + 1);
    }
  });

  test("REGRESSION: live mode prevents microtask race condition", async () => {
    // This tests the fix for the microtask scheduling race where new frames
    // would check pendingOperation === null before processQueuedBuckets() ran.
    //
    // The bug was that processQueuedBuckets() was scheduled as a microtask,
    // creating a window where new frames could arrive and see pendingOperation === null
    // before the queued frames were processed.

    let resolveSlow: () => void;
    const slowOperation = new Promise<void>(resolve => {
      resolveSlow = resolve;
    });

    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      // Every 5th operation is slow to create queue buildup
      if (opId % 5 === 0) {
        await slowOperation;
      }
    };

    const queue = new PlaybackQueue(true, handler);

    // Process first frame (slow)
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    await new Promise(resolve => setTimeout(resolve, 10));

    // Queue up several frames
    for (let i = 2; i <= 10; i++) {
      queue.enqueueFrame(new StyleSheetRuleInserted(i, i - 1, `rule${i}`));
    }

    expect(handledFrames.length).toBe(1);

    // Release slow operation
    resolveSlow!();

    // Immediately (synchronously in the same event loop tick) enqueue more frames
    // These should be queued, not processed immediately, even though the slow
    // operation just completed
    queue.enqueueFrame(new StyleSheetRuleInserted(11, 10, "rule11"));
    queue.enqueueFrame(new StyleSheetRuleInserted(12, 11, "rule12"));

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // All frames should be processed in order
    expect(handledFrames.length).toBe(12);
    expect(operationOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    // Verify strict ordering
    for (let i = 0; i < handledFrames.length; i++) {
      expect((handledFrames[i].frame as StyleSheetRuleInserted).styleSheetId).toBe(i + 1);
    }
  });

  test("REGRESSION: live mode with isProcessingQueuedBuckets guard prevents concurrent bucket processing", async () => {
    // This tests that the isProcessingQueuedBuckets flag prevents multiple
    // concurrent calls to processQueuedBuckets()

    let resolvers: Array<() => void> = [];
    const operations: Array<Promise<void>> = [];
    
    for (let i = 0; i < 5; i++) {
      operations.push(new Promise<void>(resolve => {
        resolvers.push(resolve);
      }));
    }

    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      // Each operation waits for its specific resolver
      await operations[opId];
    };

    const queue = new PlaybackQueue(true, handler);

    // Start first frame
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    await new Promise(resolve => setTimeout(resolve, 10));

    // Queue frames 2-5
    for (let i = 2; i <= 5; i++) {
      queue.enqueueFrame(new StyleSheetRuleInserted(i, i - 1, `rule${i}`));
    }

    expect(handledFrames.length).toBe(1);

    // Release operations one by one with tiny delays
    // This ensures we don't have concurrent bucket processing
    for (let i = 0; i < 5; i++) {
      resolvers[i]();
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // All should be processed in order
    expect(operationOrder).toEqual([0, 1, 2, 3, 4]);
    expect(handledFrames.length).toBe(5);
  });

  test("REGRESSION: frames arriving during bucket processing are queued properly", async () => {
    // This tests that frames arriving while processQueuedBuckets() is running
    // are properly queued and not processed immediately

    let resolveMiddle: () => void;
    const middleComplete = new Promise<void>(resolve => {
      resolveMiddle = resolve;
    });

    const handler = async (frame: Frame, timestamp: number) => {
      const opId = operationCounter++;
      operationOrder.push(opId);
      handledFrames.push({ frame, timestamp });

      // Frame 2 (op 1) blocks to simulate slow processing during bucket processing
      if (opId === 1) {
        await middleComplete;
      }
    };

    const queue = new PlaybackQueue(true, handler);

    // Start first frame and let it complete
    queue.enqueueFrame(new StyleSheetRuleInserted(1, 0, "rule1"));
    await new Promise(resolve => setTimeout(resolve, 10));

    // Queue several frames
    queue.enqueueFrame(new StyleSheetRuleInserted(2, 1, "rule2")); // This will block
    queue.enqueueFrame(new StyleSheetRuleInserted(3, 2, "rule3"));
    queue.enqueueFrame(new StyleSheetRuleInserted(4, 3, "rule4"));

    // Give time for frame 2 to start processing
    await new Promise(resolve => setTimeout(resolve, 20));

    // Now while bucket processing is active (frame 2 is blocking),
    // enqueue more frames - these should be queued
    queue.enqueueFrame(new StyleSheetRuleInserted(5, 4, "rule5"));
    queue.enqueueFrame(new StyleSheetRuleInserted(6, 5, "rule6"));

    // Release the blocker
    resolveMiddle!();

    // Wait for all to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // All frames should be processed in order
    expect(operationOrder).toEqual([0, 1, 2, 3, 4, 5]);
    expect(handledFrames.length).toBe(6);

    // Verify order
    for (let i = 0; i < handledFrames.length; i++) {
      expect((handledFrames[i].frame as StyleSheetRuleInserted).styleSheetId).toBe(i + 1);
    }
  });
});

