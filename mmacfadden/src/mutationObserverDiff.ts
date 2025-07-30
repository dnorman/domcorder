import { diffDom } from './domDiff';
import type { DomOperation, NodePath } from './domDiff';

export type DirtyRegion = {
  element: Element;
  path: NodePath;
  lastModified: number;
};

export type MutationObserverDiffOptions = {
  batchTimeoutMs?: number;
  subtree?: boolean;
  attributes?: boolean;
  childList?: boolean;
  characterData?: boolean;
};

/**
 * Efficient DOM diffing using MutationObserver to track dirty regions.
 * Only diffs subtrees that have actually changed since the last snapshot.
 */
export class MutationObserverDiff {
  private observer: MutationObserver;
  private dirtyRegions = new Map<Element, DirtyRegion>();
  private snapshot: Element | null = null;
  private onDiff: (ops: DomOperation[]) => void;
  private options: Required<MutationObserverDiffOptions>;
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  constructor(
    private root: Element,
    onDiff: (ops: DomOperation[]) => void,
    options: MutationObserverDiffOptions = {}
  ) {
    this.onDiff = onDiff;
    this.options = {
      batchTimeoutMs: options.batchTimeoutMs ?? 1000,
      subtree: options.subtree ?? true,
      attributes: options.attributes ?? true,
      childList: options.childList ?? true,
      characterData: options.characterData ?? true,
    };

    this.observer = new MutationObserver(this.handleMutations.bind(this));
    this.start();
  }

  private start(): void {
    // Take initial snapshot
    this.snapshot = this.root.cloneNode(true) as Element;
    
    // Start observing
    this.observer.observe(this.root, {
      subtree: this.options.subtree,
      attributes: this.options.attributes,
      childList: this.options.childList,
      characterData: this.options.characterData,
    });
  }

  private handleMutations(mutations: MutationRecord[]): void {
    const now = Date.now();

    // Mark affected regions as dirty
    for (const mutation of mutations) {
      let target = mutation.target as Element;
      
      // For text nodes, get the parent element
      if (target.nodeType === Node.TEXT_NODE) {
        target = target.parentElement!;
      }

      // Find the closest ancestor that's a child of our root
      while (target && !this.root.contains(target)) {
        target = target.parentElement!;
      }

      if (target && this.root.contains(target)) {
        const path = this.getElementPath(target);
        this.dirtyRegions.set(target, {
          element: target,
          path,
          lastModified: now,
        });
      }
    }

    // Batch process changes
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    this.batchTimeout = setTimeout(() => {
      this.processDirtyRegions();
    }, this.options.batchTimeoutMs);
  }

  private getElementPath(element: Element): NodePath {
    const path: number[] = [];
    let current = element;

    while (current !== this.root && current.parentElement) {
      const parent = current.parentElement;
      const index = Array.from(parent.childNodes).indexOf(current);
      path.unshift(index);
      current = parent;
    }

    return path;
  }

  private processDirtyRegions(): void {
    if (this.isProcessing || this.dirtyRegions.size === 0) return;

    this.isProcessing = true;
    const allOps: DomOperation[] = [];

    try {
      // Process each dirty region
      for (const [element, region] of this.dirtyRegions) {
        // Find the corresponding element in the snapshot
        const snapshotElement = this.getElementByPath(this.snapshot!, region.path);
        
        if (snapshotElement) {
          // Diff only this subtree
          const ops = diffDom(snapshotElement, element, region.path);
          allOps.push(...ops);
        }
      }

      // Apply changes to snapshot and notify
      if (allOps.length > 0) {
        this.onDiff(allOps);
        // Update snapshot to reflect current state
        this.snapshot = this.root.cloneNode(true) as Element;
      }

      // Clear dirty regions
      this.dirtyRegions.clear();
    } finally {
      this.isProcessing = false;
    }
  }

  private getElementByPath(root: Element, path: NodePath): Element | null {
    let current: Node = root;
    
    for (const index of path) {
      if (!current.childNodes[index]) return null;
      current = current.childNodes[index];
    }
    
    return current.nodeType === Node.ELEMENT_NODE ? current as Element : null;
  }

  /**
   * Manually mark a region as dirty (useful for programmatic changes)
   */
  markDirty(element: Element): void {
    const path = this.getElementPath(element);
    this.dirtyRegions.set(element, {
      element,
      path,
      lastModified: Date.now(),
    });
  }

  /**
   * Force immediate processing of dirty regions
   */
  forceProcess(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    this.processDirtyRegions();
  }

  /**
   * Stop observing and clean up
   */
  stop(): void {
    this.observer.disconnect();
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    this.dirtyRegions.clear();
    this.snapshot = null;
  }

  /**
   * Get current dirty regions (for debugging)
   */
  getDirtyRegions(): DirtyRegion[] {
    return Array.from(this.dirtyRegions.values());
  }
}

/**
 * Convenience function to start mutation observer-based diffing
 */
export function startMutationObserverDiff(
  root: Element,
  onDiff: (ops: DomOperation[]) => void,
  options?: MutationObserverDiffOptions
): MutationObserverDiff {
  return new MutationObserverDiff(root, onDiff, options);
} 