import { diffDom } from './domDiff';
import type { DomOperation } from './domDiff';

/**
 * Starts an incremental DOM diff process.
 * - Clones the root element as a snapshot.
 * - Every intervalMs ms, diffs the snapshot against the current DOM.
 * - Calls the callback with the diff operations.
 * - Updates the snapshot after each diff.
 * @param root The root DOM element to observe
 * @param onDiff Callback to receive diff operations
 * @param intervalMs Polling interval in milliseconds (default: 1000)
 * @returns An object with a stop() method to halt the process
 */
export function startIncrementalDomDiff(
  root: Element,
  onDiff: (ops: DomOperation[]) => void,
  intervalMs: number = 1000
): { stop: () => void } {
  let snapshot = root.cloneNode(true) as Element;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;

  function tick() {
    if (stopped) return;
    const current = root;
    const ops = diffDom(snapshot, current);
    if (ops.length > 0) {
      onDiff(ops);
      snapshot = current.cloneNode(true) as Element;
    }
    timer = setTimeout(tick, intervalMs);
  }

  timer = setTimeout(tick, intervalMs);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
} 