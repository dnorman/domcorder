import { DomMutator } from "./DomMutator";
import { NodeIdBiMap } from "../dom/NodeIdBiMap";
import type { DomOperation } from "./operations";
import { computeMinimalChanges } from "./StringChangeDetector";

export class DomChangeDetector {
  private liveDomRoot: Node;
  private snapshotDomRoot: Node;
  private liveNodeMap: NodeIdBiMap;
  private snapshotNodeMap: NodeIdBiMap;

  private liveDomObserver: MutationObserver;
  private dirtySubtrees = new Set<Node>();

  private snapshotMutator: DomMutator;

  private callback: (ops: DomOperation[]) => void;
  private batchTimeout: number | null = null;
  private batchTimeoutMs = 1000;


  constructor(root: Node, liveNodeMap: NodeIdBiMap, callback: (ops: DomOperation[]) => void) {
    this.liveDomRoot = root;
    this.snapshotDomRoot = root.cloneNode(true);
    this.liveNodeMap = liveNodeMap;
    this.snapshotNodeMap = new NodeIdBiMap();
    this.snapshotNodeMap.assignNodeIdsToSubTree(this.snapshotDomRoot);
    this.snapshotMutator = new DomMutator(this.snapshotDomRoot, this.snapshotNodeMap);
    this.callback = callback;

    this.liveDomObserver = new MutationObserver(this.handleMutations.bind(this));

    this.liveDomObserver.observe(this.liveDomRoot, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
  }

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

      // FIXME it's possible that a region is marked dirty, but then some ancestor 
      // also then marked dirty. We should compress this. A node that is marked
      // dirty could also be removed from the live dom (directly or indirectly)
      // and we should then remove it from the dirty regions.
    }

    // Batch process changes
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    this.batchTimeout = setTimeout(() => {
      this.processDirtyRegions();
    }, this.batchTimeoutMs) as unknown as number;
  }

  private processDirtyRegions(): void {
    if (this.dirtySubtrees.size === 0) return;

    const allOps: DomOperation[] = [];

    // Process each dirty region
    for (const liveNode of this.dirtySubtrees) {
      const liveNodeId = this.liveNodeMap.getNodeId(liveNode);
      if (liveNodeId === undefined) continue;

      const snapshotNode = this.snapshotNodeMap.getNodeById(liveNodeId);
      if (snapshotNode === undefined) continue;

      const ops = this.computeOperations(liveNode, snapshotNode);
      allOps.push(...ops);
    }

    // Apply changes to snapshot and notify
    if (allOps.length > 0) {
      this.snapshotMutator.applyOps(allOps);
      try {
        this.callback(allOps);
      } catch (e) {
        console.error(e);
      }
    }

    // Clear dirty regions
    this.dirtySubtrees.clear();
  }

  private computeOperations(liveNode: Node, snapshotNode: Node): DomOperation[] {
    const liveNodeId = this.liveNodeMap.getNodeId(liveNode)!;

    const ops: DomOperation[] = [];
  
    // Handle text nodes (we know the types are the same)
    if (liveNode.nodeType === Node.TEXT_NODE) {
      if (snapshotNode.textContent !== liveNode.textContent) {
        const changes = computeMinimalChanges(snapshotNode.textContent || '', liveNode.textContent || '');
        ops.push({
          op: 'updateText',
          nodeId: liveNodeId,
          ops: changes
        });
      }
      return ops;
    }

    if (liveNode.nodeType === Node.ELEMENT_NODE) {
      const snapshotEl = snapshotNode as Element;
      const liveEl = liveNode as Element;      
      
      // Attribute diffs
      const oldAttrs = snapshotEl.attributes;
      const newAttrs = liveEl.attributes;
      
      // Check for removed and updated attributes
      for (let i = 0; i < oldAttrs.length; i++) {
        const attrName = oldAttrs[i].name;
        const newAttr = liveEl.getAttribute(attrName);
        if (newAttr === null) {
          ops.push({
            op: 'removeAttribute',
            nodeId: liveNodeId,
            name: attrName
          });
        } else if (newAttr !== oldAttrs[i].value) {
          ops.push({
            op: 'updateAttribute',
            nodeId: liveNodeId,
            name: attrName,
            value: newAttr
          });
        }
      }
      
      // Check for new attributes
      for (let i = 0; i < newAttrs.length; i++) {
        const attrName = newAttrs[i].name;
        if (!snapshotEl.hasAttribute(attrName)) {
          ops.push({
            op: 'updateAttribute',
            nodeId: liveNodeId,
            name: attrName,
            value: newAttrs[i].value
          });
        }
      }

      // handle children

      // TODO There is an optimization to be made here.  We should be able to
      // detect when an element in the array has been replaced with a new element
      // and issue a single replace operation instead of a remove and insert.
      // As of now we are not using the replace operation at all.

      const oldChildren = Array.from(snapshotEl.childNodes);
      const newChildren = Array.from(liveEl.childNodes);

      let i = 0, j = 0;
      while (i < oldChildren.length || j < newChildren.length) {
        if (i < oldChildren.length && j < newChildren.length && 
          this.liveNodeMap.getNodeId(oldChildren[i]) === this.snapshotNodeMap.getNodeId(newChildren[j])) {
          // elements match → no change
          i++;
          j++;
        } else if (j < newChildren.length && (i >= oldChildren.length || !oldChildren.includes(newChildren[j]))) {
          // element in newChildren[j] is new → insert
          ops.push({ op: "insert", parentId: liveNodeId, index: j, node: newChildren[j].cloneNode(true) });
          this.liveNodeMap.assignNodeIdsToSubTree(newChildren[j]);
          j++;
        } else if (i < oldChildren.length && (j >= newChildren.length || !newChildren.includes(oldChildren[i]))) {
          // element in oldChildren[i] is missing → remove
          ops.push({ op: "remove", nodeId: this.liveNodeMap.getNodeId(oldChildren[i])! });
          this.liveNodeMap.removeNodesInSubtree(oldChildren[i]);
          i++;
        } else {
          // TODO is there where we want to use the replace operation?
          // fallback: if elements differ but both exist later, remove + insert
          ops.push({ op: "remove", nodeId: this.liveNodeMap.getNodeId(oldChildren[i])! });
          this.liveNodeMap.removeNodesInSubtree(oldChildren[i]);
          ops.push({ op: "insert", parentId: liveNodeId, index: j, node: newChildren[j].cloneNode(true) });
          this.liveNodeMap.assignNodeIdsToSubTree(newChildren[j]);
          i++;
          j++;
        }
      }
        
      // Also handle updates for children that exist in both arrays
      const commonChildren = oldChildren.filter(child => newChildren.includes(child));
      for (const child of commonChildren) {
        const newChildIndex = newChildren.indexOf(child);
        const oldChildIndex = oldChildren.indexOf(child);
        const newChild = newChildren[newChildIndex];
        const oldChild = oldChildren[oldChildIndex];
        
        // Recursively diff the child nodes
        const recursiveOps = this.computeOperations(oldChild, newChild);
        ops.push(...recursiveOps);
      }
      
      return ops;
    }
    
    throw new Error('Unexpected change');
  }
}