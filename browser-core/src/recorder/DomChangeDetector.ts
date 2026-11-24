import { NodeIdBiMap } from "../common/NodeIdBiMap";
import type { DomOperation } from "../common/DomOperation";
import { computeMinimalChanges } from "./StringChangeDetector";

/**
 * An operation as the change detector finds it in the live page. A change of an attribute
 * carries the live element whose attribute changed, so that the recorder can ask the element
 * itself whether it has been a password field: the id the operation names it by can name another
 * node in the recorder's numbering of the page.
 */
export type DetectedDomOperation =
  | Exclude<DomOperation, { op: 'updateAttribute' }>
  | (Extract<DomOperation, { op: 'updateAttribute' }> & { element: Element });

/**
 * The live node that each node of an insert operation's subtree was copied from, so that the
 * recorder can ask the live node what the copy cannot tell, such as whether a field has been a
 * password field. The operation hands over a copy because the copy shows the subtree as it was
 * when the change was found. Weak, so that it keeps no copy alive.
 */
const liveNodesOfCopies = new WeakMap<Node, Node>();

/**
 * Copies `liveNode`'s subtree into `document` one node at a time, and links each copy to the
 * live node it copies as the copy is made. A subtree copied whole and then matched to the live
 * subtree by position can be linked to the wrong nodes: copying a custom element can run the
 * page's code for the copy before the copy is returned, and that code can reorder its children,
 * so that a password field's copy would be linked to an ordinary field. A node of the copy that
 * this function did not make from a live node, such as one inside the shadow root that a host's
 * copy carries, stays unlinked, and the recorder masks its `value`.
 */
function linkedCopyOf(liveNode: Node, document: Document): Node {
  const copy = document.importNode(liveNode, false);
  liveNodesOfCopies.set(copy, liveNode);
  if (liveNode instanceof HTMLTemplateElement) {
    // A template's content is not among its children, and only a whole copy takes it along
    (copy as HTMLTemplateElement).content.append(document.importNode(liveNode.content, true));
  }
  for (const child of Array.from(liveNode.childNodes)) {
    copy.appendChild(linkedCopyOf(child, document));
  }
  return copy;
}

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
  /** The live node that `copy`, a node of an insert operation's subtree, copies, if it is one. */
  public static liveNodeOf<T extends Node>(copy: T): T | undefined {
    return liveNodesOfCopies.get(copy) as T | undefined;
  }

  private readonly liveDomRoot: Node;
  private readonly liveNodeMap: NodeIdBiMap;
  
  private readonly snapshotDomRoot: Node;
  private readonly snapshotNodeMap: NodeIdBiMap;
  /**
   * The document the detector makes its copies in, its snapshot's. When the detector watches a
   * whole document, as the recorder's does, that is the snapshot, a copy of the document in which
   * the page's custom elements are not defined, so that making a copy there runs none of the code
   * of the page's own registry. The copy of an element created with a scoped custom element
   * registry keeps that registry, and so do the copies of such elements in a clonable shadow root,
   * open or closed, which the browser copies along with its host; their code runs for the copies.
   * A detector watching an element makes its copies in the page's own document, where the page's
   * custom elements are defined.
   */
  private readonly snapshotDocument: Document;

  private readonly liveDomObserver: MutationObserver;
  private readonly dirtySubtrees = new Set<Node>();

  private readonly callback: (ops: DetectedDomOperation[]) => void;
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
    callback: (ops: DetectedDomOperation[]) => void,
    batchIntervalMs: number = 1000,
    processImmediately: boolean = false
  ) {
    this.liveDomRoot = liveDomRoot;
    this.snapshotDomRoot = liveDomRoot.cloneNode(true);
    this.snapshotDocument = this.snapshotDomRoot.ownerDocument ?? (this.snapshotDomRoot as Document);
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
    const allOps: DetectedDomOperation[] = [];

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
  private computeAndApplyOperations(liveNode: Node, snapshotNode: Node): DetectedDomOperation[] {
    if (liveNode.nodeType !== snapshotNode.nodeType) {
      throw new Error(
        `[DomChangeDetector] Node types do not match: ` +
        `live=${liveNode.nodeType}, snapshot=${snapshotNode.nodeType}`
      );
    }

    const liveNodeId = this.liveNodeMap.getNodeId(liveNode)!;
    const ops: DetectedDomOperation[] = [];
  
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
  ): DetectedDomOperation[] {
    const ops: DetectedDomOperation[] = [];
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
          value: newAttr,
          element: liveEl
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
          value: newAttrs[i].value,
          element: liveEl
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
  ): DetectedDomOperation[] {
    const ops: DetectedDomOperation[] = [];
    
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
        const clonedChild = this.snapshotDocument.importNode(existingLiveChild, true);
        
        // Mirror node IDs from live to snapshot
        this.snapshotNodeMap.mirrorNodeIdsToSubTree(existingLiveChild, clonedChild);

        // Update snapshot DOM
        snapshotEl.insertBefore(clonedChild, snapshotChildren[snapshotChildrenIndex] || null);
        // console.log(`[computeChildOps] Inserted child ID ${liveChildId} (${(clonedChild as any).nodeName}) into snapshot parent ${parentId}. Snapshot now has ${snapshotEl.childNodes.length} children`);
        snapshotChildren.splice(snapshotChildrenIndex, 0, clonedChild as ChildNode);
        snapshotChildrenIds.splice(snapshotChildrenIndex, 0, liveChildId!);

        // Emit insert operation (causal order: insert before modify)
        // IMPORTANT: Copy the node again for the operation! If we pass the same node object that's
        // already in the snapshot, the mutator's insertBefore will MOVE it from the snapshot to the target!
        const clonedChildForOperation = linkedCopyOf(existingLiveChild, this.snapshotDocument);
        // Copy IDs without updating the snapshot map (which should only track snapshot nodes).
        // The ids go by position, from the live subtree to the snapshot copy and from that copy to
        // this one, so each node of this copy has its own live node's id only while both copies
        // have the live subtree's shape. They have it unless the page's code runs for a copy, as the
        // code of an element created with a scoped custom element registry does, and that of such
        // elements in a clonable shadow root that the browser copies with its host (see
        // `snapshotDocument`). Such code can change a copy, which is then recorded unlike the page.
        // Changes in the number or the order of a copy's children can put the ids on the wrong
        // nodes or make either copying of the ids throw, and then neither the subtree nor any later
        // change of the page is recorded.
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
        const clonedChild = this.snapshotDocument.importNode(existingLiveChild, true);
        this.snapshotNodeMap.mirrorNodeIdsToSubTree(existingLiveChild, clonedChild);

        // Copy again for the operation to avoid moving nodes between snapshot and target. The copy
        // of a node this branch inserts, one the page moved before its siblings or a sibling that
        // the page moved a node after, is handed over in the page's own document, whose address
        // the recorder resolves the copy's relative addresses (an image's `src`, a link's `href`)
        // against; the copy of a node that the branch above inserts (one new to this parent, moved
        // here from another parent, or moved after its siblings) stays in the snapshot document,
        // whose address is the page's when the detector started. The two differ once the page
        // changes its address (`history.pushState`). Adopted, the copy starts the loads of its
        // images, image inputs, SVG images, videos, audio elements and their sources, and a
        // `details` element's toggle, in the page's document, and their inline `onload`,
        // `onerror`, `onloadstart` and `ontoggle` attributes then run with the copy as `this`. The
        // `adoptedCallback` of an element of the copy that keeps a scoped registry runs too.
        const clonedChildForOperation = existingLiveChild.ownerDocument!.adoptNode(
          linkedCopyOf(existingLiveChild, this.snapshotDocument)
        );
        // Copy IDs without updating the snapshot map (which should only track snapshot nodes);
        // by position, which relies on both copies having the live subtree's shape, as for a new node
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
  ): DetectedDomOperation[] {
    const ops: DetectedDomOperation[] = [];
    
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

