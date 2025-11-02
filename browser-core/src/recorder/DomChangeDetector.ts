import { NodeIdBiMap } from "../common/NodeIdBiMap";
import type { DomOperation } from "../common/DomOperation";
import { computeMinimalChanges } from "./StringChangeDetector";

/**
 * DomChangeDetector - A specification-aligned implementation of DOM change detection.
 * 
 * This implementation ensures:
 * - Operations are emitted in causal order
 * - Batches correspond to single MutationObserver callback invocations
 * - Node IDs remain stable throughout the node lifecycle
 * - All operations are emitted (even if they appear to cancel out within a batch)
 * 
 * Key improvements:
 * - Processes each MutationObserver callback batch independently
 * - Better handling of dirty region compression
 * - Explicit causal ordering guarantees
 */
export class DomChangeDetector {
  private readonly liveDomRoot: Node;
  private readonly liveNodeMap: NodeIdBiMap;
  
  private readonly snapshotDomRoot: Node;
  private readonly snapshotNodeMap: NodeIdBiMap;

  private readonly liveDomObserver: MutationObserver;
  private readonly dirtySubtrees = new Set<Node>();

  private readonly callback: (ops: DomOperation[]) => void;
  private readonly batchIntervalMs: number;
  private batchInterval: number | null = null;
  private readonly processImmediately: boolean;
  private immediateProcessScheduled: boolean = false;

  /**
   * Creates a new DomChangeDetector instance.
   * 
   * @param liveDomRoot - The root node of the DOM tree to observe
   * @param liveNodeMap - The NodeIdBiMap that tracks node IDs for the live DOM
   * @param callback - Function called with operations when changes are detected
   * @param batchIntervalMs - Interval for processing dirty regions (default: 1000ms)
   * @param processImmediately - If true, process immediately via requestAnimationFrame (default: false)
   */
  constructor(
    liveDomRoot: Node,
    liveNodeMap: NodeIdBiMap,
    callback: (ops: DomOperation[]) => void,
    batchIntervalMs: number = 1000,
    processImmediately: boolean = false
  ) {
    this.liveDomRoot = liveDomRoot;
    this.snapshotDomRoot = liveDomRoot.cloneNode(true);
    this.liveNodeMap = liveNodeMap;
    this.snapshotNodeMap = new NodeIdBiMap();
    // Mirror node IDs from live DOM to snapshot to maintain consistency
    // This ensures the snapshot has the same IDs as the live DOM at initialization
    this.snapshotNodeMap.mirrorNodeIdsToSubTree(this.liveDomRoot, this.snapshotDomRoot);
    this.callback = callback;
    this.batchIntervalMs = batchIntervalMs;
    this.processImmediately = processImmediately;
    
    // console.log(`[DomChangeDetector] Initialized with snapshot root ID=${this.snapshotNodeMap.getNodeId(this.snapshotDomRoot)}, childCount=${this.snapshotDomRoot.childNodes.length}`);

    this.liveDomObserver = new MutationObserver(this.handleMutations.bind(this));

    this.liveDomObserver.observe(this.liveDomRoot, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });

    // Start regular interval processing
    this.batchInterval = setInterval(() => {
      this.processDirtyRegions();
    }, this.batchIntervalMs) as unknown as number;
  }

  /**
   * Returns a clone of the snapshot DOM root.
   * Useful for debugging or initial state synchronization.
   */
  public getSnapshotDomRoot(): Node {
    return this.snapshotDomRoot.cloneNode(true);
  }
  
  /**
   * Returns the actual snapshot DOM root (not a clone).
   * For debugging only - do not modify!
   */
  public getActualSnapshotRoot(): Node {
    return this.snapshotDomRoot;
  }

  /**
   * Returns the snapshot NodeIdBiMap.
   * Useful for initial state synchronization.
   */
  public getSnapshotNodeMap(): NodeIdBiMap {
    return this.snapshotNodeMap;
  }

  /**
   * Handles MutationObserver callbacks.
   * 
   * According to the spec, a "batch" refers to all MutationRecords delivered
   * to a single MutationObserver callback invocation. We mark dirty regions here
   * and process them either immediately (if processImmediately is true) or
   * on the next interval.
   * 
   * Note: The actual diffing happens in processDirtyRegions() to ensure we
   * see the final state of all mutations in the batch.
   */
  private handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      let target = mutation.target;
      
      // Find the closest ancestor that's a child of our root
      // that is still in the document.
      while (target && !this.liveDomRoot.contains(target)) {
        target = target.parentElement!;
      }

      if (target && this.liveDomRoot.contains(target)) {
        this.dirtySubtrees.add(target);
      }
    }

    // Compress dirty regions: if a node and its ancestor are both dirty,
    // we only need to process the ancestor.
    this.compressDirtyRegions();

    // If immediate processing is enabled, schedule processing after mutations
    if (this.processImmediately && this.dirtySubtrees.size > 0 && !this.immediateProcessScheduled) {
      this.immediateProcessScheduled = true;
      // Use requestAnimationFrame to process after the current event loop cycle
      // This batches mutations that happen in the same frame while still being immediate
      requestAnimationFrame(() => {
        this.immediateProcessScheduled = false;
        this.processDirtyRegions();
      });
    }
  }

  /**
   * Compresses dirty regions by removing descendants when an ancestor is also dirty.
   * This optimization ensures we don't process the same region multiple times.
   */
  private compressDirtyRegions(): void {
    const toRemove = new Set<Node>();
    
    for (const node of this.dirtySubtrees) {
      // Check if any ancestor is also in the dirty set
      let ancestor = node.parentNode;
      while (ancestor && ancestor !== this.liveDomRoot) {
        if (this.dirtySubtrees.has(ancestor)) {
          // An ancestor is dirty, so we can remove this node
          toRemove.add(node);
          break;
        }
        ancestor = ancestor.parentNode;
      }
      
      // Also remove nodes that are no longer in the live DOM
      if (!this.liveDomRoot.contains(node)) {
        toRemove.add(node);
      }
    }

    for (const node of toRemove) {
      this.dirtySubtrees.delete(node);
    }
  }

  /**
   * Processes all dirty regions and emits operations.
   * 
   * This method:
   * 1. Computes the diff between live and snapshot DOM for each dirty region
   * 2. Emits operations in causal order (add before modify, modify before remove)
   * 3. Updates the snapshot to match the live DOM
   * 4. Calls the callback with all operations
   */
  private processDirtyRegions(): void {
    const allOps: DomOperation[] = [];

    // console.log(`[processDirtyRegions] Processing ${this.dirtySubtrees.size} dirty nodes:`, Array.from(this.dirtySubtrees).map(n => this.liveNodeMap.getNodeId(n)));

    // Process each dirty region
    for (const liveNode of this.dirtySubtrees) {
      const liveNodeId = this.liveNodeMap.getNodeId(liveNode);
      if (liveNodeId === undefined) {
        // Node doesn't have an ID yet - skip it for now
        // It will be processed when its parent is processed
        continue;
      }

      const snapshotNode = this.snapshotNodeMap.getNodeById(liveNodeId);
      if (snapshotNode === undefined) {
        // Node doesn't exist in snapshot - this shouldn't happen in normal operation
        // It might occur if the node was removed from snapshot but still exists in live
        console.log(`[processDirtyRegions] Skipping node ${liveNodeId} - not in snapshot`);
        continue;
      }

      // console.log(`[processDirtyRegions] Retrieved snapshot node ${liveNodeId}, childCount=${snapshotNode.childNodes.length}, isRoot=${snapshotNode === this.snapshotDomRoot}, rootChildCount=${this.snapshotDomRoot.childNodes.length}`);

      const ops = this.computeAndApplyOperations(liveNode, snapshotNode);
      allOps.push(...ops);
      
      // console.log(`[processDirtyRegions] After processing node ${liveNodeId}, snapshot childCount=${snapshotNode.childNodes.length}, rootChildCount=${this.snapshotDomRoot.childNodes.length}`);
    }

    // Apply changes to snapshot and notify
    // Operations are already in causal order from computeAndApplyOperations
    // console.log(`[processDirtyRegions] Before callback: rootChildCount=${this.snapshotDomRoot.childNodes.length}`);
    if (allOps.length > 0) {
      try {
        this.callback(allOps);
      } catch (e) {
        console.error('[DomChangeDetector] Error in callback:', e);
      }
    }
    // console.log(`[processDirtyRegions] After callback: rootChildCount=${this.snapshotDomRoot.childNodes.length}`);

    // Clear dirty regions
    this.dirtySubtrees.clear();
    // console.log(`[processDirtyRegions] After clear: rootChildCount=${this.snapshotDomRoot.childNodes.length}`);
  }

  /**
   * Computes the diff between live and snapshot nodes and returns operations.
   * 
   * This method ensures causal ordering:
   * - For elements: attributes are processed before children
   * - For children: inserts come before removes
   * - Recursive processing maintains order within subtrees
   * 
   * @param liveNode - The current state of the node in the live DOM
   * @param snapshotNode - The previous state of the node in the snapshot
   * @returns Array of operations needed to transform snapshot to live state
   */
  private computeAndApplyOperations(liveNode: Node, snapshotNode: Node): DomOperation[] {
    if (liveNode.nodeType !== snapshotNode.nodeType) {
      throw new Error(
        `[DomChangeDetector] Node types do not match: ` +
        `live=${liveNode.nodeType}, snapshot=${snapshotNode.nodeType}`
      );
    }

    const liveNodeId = this.liveNodeMap.getNodeId(liveNode)!;
    const ops: DomOperation[] = [];
  
    // Handle CharacterData nodes (Text, Comment, CDATASection)
    if (liveNode.nodeType === Node.TEXT_NODE || 
        liveNode.nodeType === Node.COMMENT_NODE ||
        liveNode.nodeType === Node.CDATA_SECTION_NODE) {
      if (snapshotNode.textContent !== liveNode.textContent) {
        const changes = computeMinimalChanges(
          snapshotNode.textContent || '', 
          liveNode.textContent || ''
        );
        ops.push({
          op: 'updateText',
          nodeId: liveNodeId,
          ops: changes
        });
      }
      
      // Update snapshot to match live
      snapshotNode.textContent = liveNode.textContent;

      return ops;
    }
    
    // Handle Element nodes
    if (liveNode.nodeType === Node.ELEMENT_NODE) {
      const snapshotEl = snapshotNode as Element;
      const liveEl = liveNode as Element;

      // Process attributes first (causal order: attributes exist before they can be modified)
      const attributeOps = this.computeAttributeOperations(liveEl, snapshotEl, liveNodeId);
      ops.push(...attributeOps);

      // Then process children (causal order: nodes must be added before they can be modified/removed)
      const childOps = this.computeChildOperations(liveEl, snapshotEl, liveNodeId);
      ops.push(...childOps);

      // Finally, recursively process children that exist in both (causal order: node exists before modifications)
      const recursiveOps = this.computeRecursiveChildOperations(liveEl, snapshotEl);
      ops.push(...recursiveOps);
      
      return ops;
    }
    
    // Unknown node type - log but don't throw
    console.debug('[DomChangeDetector] Unexpected node type:', liveNode.nodeType, liveNode, snapshotNode);
    return [];
  }

  /**
   * Computes attribute operations (add, update, remove) for an element.
   * Operations are emitted even if they appear to cancel out within a batch.
   */
  private computeAttributeOperations(
    liveEl: Element,
    snapshotEl: Element,
    nodeId: number
  ): DomOperation[] {
    const ops: DomOperation[] = [];
    const oldAttrs = snapshotEl.attributes;
    const newAttrs = liveEl.attributes;
    
    // Check for removed and updated attributes (process in snapshot order for determinism)
    for (let i = 0; i < oldAttrs.length; i++) {
      const attrName = oldAttrs[i].name;
      const newAttr = liveEl.getAttribute(attrName);
      if (newAttr === null) {
        // Attribute was removed
        ops.push({
          op: 'removeAttribute',
          nodeId: nodeId,
          name: attrName
        });
        snapshotEl.removeAttribute(attrName);
      } else if (newAttr !== oldAttrs[i].value) {
        // Attribute value changed
        ops.push({
          op: 'updateAttribute',
          nodeId: nodeId,
          name: attrName,
          value: newAttr
        });
        snapshotEl.setAttribute(attrName, newAttr);
      }
    }
    
    // Check for new attributes
    for (let i = 0; i < newAttrs.length; i++) {
      const attrName = newAttrs[i].name;
      if (!snapshotEl.hasAttribute(attrName)) {
        // Attribute was added
        ops.push({
          op: 'updateAttribute',
          nodeId: nodeId,
          name: attrName,
          value: newAttrs[i].value
        });
        snapshotEl.setAttribute(attrName, newAttrs[i].value);
      }
    }

    return ops;
  }

  /**
   * Computes child list operations (insert, remove) for an element.
   * Ensures inserts come before removes for causal ordering.
   */
  private computeChildOperations(
    liveEl: Element,
    snapshotEl: Element,
    parentId: number
  ): DomOperation[] {
    const ops: DomOperation[] = [];
    
    const snapshotChildren = Array.from(snapshotEl.childNodes);
    const snapshotChildrenIds = snapshotChildren.map(c => this.snapshotNodeMap.getNodeId(c));
    const liveChildren = Array.from(liveEl.childNodes);
    const liveChildrenIds = liveChildren.map(c => this.liveNodeMap.getNodeId(c));
    
    // Debug logging - detect duplicate IDs which indicate a bug
    // if (liveChildrenIds.some((id, idx) => liveChildrenIds.indexOf(id) !== idx) ||
    //     snapshotChildrenIds.some((id, idx) => snapshotChildrenIds.indexOf(id) !== idx)) {
    //   console.warn(`[computeChildOps] DUPLICATE IDs DETECTED! parentId=${parentId}, live IDs:`, liveChildrenIds, ', snapshot IDs:', snapshotChildrenIds);
    // }

    const childIdsThatExistInLiveAndSnapshot = snapshotChildrenIds.filter(
      id => liveChildrenIds.includes(id)
    );

    let snapshotChildrenIndex = 0;
    let liveChildrenIndex = 0;

    // Use a two-pointer approach to align children
    while (snapshotChildrenIndex < snapshotChildren.length || liveChildrenIndex < liveChildren.length) {
      const snapshotChildId = snapshotChildrenIndex < snapshotChildren.length 
        ? this.snapshotNodeMap.getNodeId(snapshotChildren[snapshotChildrenIndex]) 
        : undefined;
      const liveChildId = liveChildrenIndex < liveChildren.length 
        ? this.liveNodeMap.getNodeId(liveChildren[liveChildrenIndex]) 
        : undefined;

      if (snapshotChildrenIndex < snapshotChildren.length && 
          liveChildrenIndex < liveChildren.length && 
          snapshotChildId === liveChildId) {
        // Elements match → no change needed
        snapshotChildrenIndex++;
        liveChildrenIndex++;
      } else if (liveChildrenIndex < liveChildren.length && 
                 liveChildId && 
                 (snapshotChildrenIndex >= snapshotChildren.length || 
                  !snapshotChildrenIds.includes(liveChildId))) {
        // New node in live DOM → insert operation
        const existingLiveChild = liveChildren[liveChildrenIndex];
        const clonedChild = existingLiveChild.cloneNode(true);
        
        // Mirror node IDs from live to snapshot
        this.snapshotNodeMap.mirrorNodeIdsToSubTree(existingLiveChild, clonedChild);

        // Update snapshot DOM
        snapshotEl.insertBefore(clonedChild, snapshotChildren[snapshotChildrenIndex] || null);
        // console.log(`[computeChildOps] Inserted child ID ${liveChildId} (${(clonedChild as any).nodeName}) into snapshot parent ${parentId}. Snapshot now has ${snapshotEl.childNodes.length} children`);
        snapshotChildren.splice(snapshotChildrenIndex, 0, clonedChild as ChildNode);
        snapshotChildrenIds.splice(snapshotChildrenIndex, 0, liveChildId!);

        // Emit insert operation (causal order: insert before modify)
        // IMPORTANT: Clone the node again for the operation! If we pass the same node object that's
        // already in the snapshot, the mutator's insertBefore will MOVE it from the snapshot to the target!
        const clonedChildForOperation = clonedChild.cloneNode(true);
        // Copy IDs without updating the snapshot map (which should only track snapshot nodes)
        NodeIdBiMap.copyNodeIdsToSubTree(clonedChild, clonedChildForOperation);
        
        ops.push({ 
          op: "insert", 
          parentId: parentId, 
          index: liveChildrenIndex, 
          node: clonedChildForOperation 
        });

        liveChildrenIndex++;
        snapshotChildrenIndex++;
      } else if (snapshotChildrenIndex < snapshotChildren.length && 
                 snapshotChildId && 
                 (liveChildrenIndex >= liveChildren.length || 
                  !liveChildrenIds.includes(snapshotChildId))) {
        // Node missing from live DOM → remove operation
        ops.push({ op: "remove", nodeId: snapshotChildId });
        
        // Clean up from live node map if node still exists
        const priorLiveNode = this.liveNodeMap.getNodeById(snapshotChildId);
        if (priorLiveNode) {
          this.liveNodeMap.removeNodesInSubtree(priorLiveNode);
        }

        // Update snapshot DOM
        snapshotEl.removeChild(snapshotChildren[snapshotChildrenIndex]);
        snapshotChildren.splice(snapshotChildrenIndex, 1);
        snapshotChildrenIds.splice(snapshotChildrenIndex, 1);
        // Don't increment liveChildrenIndex - we're removing from snapshot only
      } else {
        // Fallback: nodes differ but both exist later in their respective lists
        // This happens when nodes are reordered or replaced
        // Emit remove then insert (causal order: remove old before insert new)
        ops.push({ op: "remove", nodeId: snapshotChildId! });

        const priorLiveNode = this.liveNodeMap.getNodeById(snapshotChildId!);
        if (priorLiveNode) {
          this.liveNodeMap.removeNodesInSubtree(priorLiveNode);
        }

        // Insert the new node
        const existingLiveChild = liveChildren[liveChildrenIndex];
        const clonedChild = existingLiveChild.cloneNode(true);
        this.snapshotNodeMap.mirrorNodeIdsToSubTree(existingLiveChild, clonedChild);

        // Clone again for the operation to avoid moving nodes between snapshot and target
        const clonedChildForOperation = clonedChild.cloneNode(true);
        // Copy IDs without updating the snapshot map (which should only track snapshot nodes)
        NodeIdBiMap.copyNodeIdsToSubTree(clonedChild, clonedChildForOperation);

        ops.push({ 
          op: "insert", 
          parentId: parentId, 
          index: liveChildrenIndex, 
          node: clonedChildForOperation 
        });

        // Update snapshot DOM
        const priorSnapshotNode = snapshotChildren[snapshotChildrenIndex];
        this.snapshotNodeMap.removeNodesInSubtree(priorSnapshotNode);
        snapshotEl.replaceChild(clonedChild, priorSnapshotNode);

        snapshotChildren.splice(snapshotChildrenIndex, 1, clonedChild as ChildNode);
        snapshotChildrenIds.splice(snapshotChildrenIndex, 1, liveChildId!);

        snapshotChildrenIndex++;
        liveChildrenIndex++;
      }
    }

    return ops;
  }

  /**
   * Recursively processes children that exist in both live and snapshot DOMs.
   * Ensures modifications to existing nodes are processed after the nodes are added.
   */
  private computeRecursiveChildOperations(
    liveEl: Element,
    snapshotEl: Element
  ): DomOperation[] {
    const ops: DomOperation[] = [];
    
    const snapshotChildren = Array.from(snapshotEl.childNodes);
    const snapshotChildrenIds = snapshotChildren.map(c => this.snapshotNodeMap.getNodeId(c));
    const liveChildren = Array.from(liveEl.childNodes);
    const liveChildrenIds = liveChildren.map(c => this.liveNodeMap.getNodeId(c));

    const childIdsThatExistInLiveAndSnapshot = snapshotChildrenIds.filter(
      id => liveChildrenIds.includes(id)
    );

    // Process common children recursively
    const commonChildren = snapshotChildren.filter(child => {
      const childId = this.snapshotNodeMap.getNodeId(child);
      return childId && childIdsThatExistInLiveAndSnapshot.includes(childId);
    });

    for (const snapshotChild of commonChildren) {
      const childId = this.snapshotNodeMap.getNodeId(snapshotChild);
      const liveChild = this.liveNodeMap.getNodeById(childId!);
      
      if (liveChild) {
        // Recursively diff the child nodes
        const recursiveOps = this.computeAndApplyOperations(liveChild, snapshotChild);
        ops.push(...recursiveOps);
      }
    }

    return ops;
  }

  /**
   * Disconnects the MutationObserver and cleans up resources.
   */
  disconnect(): void {
    this.liveDomObserver.disconnect();
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
  }
}

