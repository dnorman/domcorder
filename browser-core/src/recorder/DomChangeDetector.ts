import { NodeIdBiMap } from "../common/NodeIdBiMap";
import type { DomOperation } from "../common/DomOperation";
import { computeMinimalChanges } from "./StringChangeDetector";

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

  constructor(liveDomRoot: Node, liveNodeMap: NodeIdBiMap, callback: (ops: DomOperation[]) => void, batchIntervalMs: number = 1000) {
    this.liveDomRoot = liveDomRoot;
    this.snapshotDomRoot = liveDomRoot.cloneNode(true);
    this.liveNodeMap = liveNodeMap;
    this.snapshotNodeMap = new NodeIdBiMap();
    this.snapshotNodeMap.assignNodeIdsToSubTree(this.snapshotDomRoot);
    this.callback = callback;
    this.batchIntervalMs = batchIntervalMs;

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

  public getSnapshotDomRoot(): Node {
    return this.snapshotDomRoot.cloneNode(true);
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

    // No timeout logic needed - the interval will process dirty regions regularly
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

      const ops = this.computeAndApplyOperations(liveNode, snapshotNode);
      allOps.push(...ops);
    }

    // Apply changes to snapshot and notify
    if (allOps.length > 0) {
      try {
        this.callback(allOps);
      } catch (e) {
        console.error(e);
      }
    }

    // Clear dirty regions
    this.dirtySubtrees.clear();
  }

  private computeAndApplyOperations(liveNode: Node, snapshotNode: Node): DomOperation[] {
    if (liveNode.nodeType !== snapshotNode.nodeType) {
      throw new Error(`Node types do not match, live: ${liveNode.nodeType}, snapshot: ${snapshotNode.nodeType}`);
    }

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
      
      snapshotNode.textContent = liveNode.textContent;

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

          snapshotEl.removeAttribute(attrName);
        } else if (newAttr !== oldAttrs[i].value) {
          ops.push({
            op: 'updateAttribute',
            nodeId: liveNodeId,
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
          ops.push({
            op: 'updateAttribute',
            nodeId: liveNodeId,
            name: attrName,
            value: newAttrs[i].value
          });

          snapshotEl.setAttribute(attrName, newAttrs[i].value);
        }
      }

      // handle children

      // TODO There is an optimization to be made here.  We should be able to
      // detect when an element in the array has been replaced with a new element
      // and issue a single replace operation instead of a remove and insert.
      // As of now we are not using the replace operation at all.

      const snapshotChildren = Array.from(snapshotEl.childNodes);
      const snapshotChildrenIds = snapshotChildren.map(c => this.snapshotNodeMap.getNodeId(c));
      const liveChildren = Array.from(liveEl.childNodes);
      const liveChildrenIds = liveChildren.map(c => this.liveNodeMap.getNodeId(c));

      const childIdsThatExistInLiveAndSnapshot = snapshotChildrenIds.filter(id => liveChildrenIds.includes(id));

      let snapshotChildrenIndex = 0;
      let liveChildrenIndex = 0;

      while (snapshotChildrenIndex < snapshotChildren.length || liveChildrenIndex < liveChildren.length) {
        const snapshotChildId = snapshotChildrenIndex < snapshotChildren.length ? this.snapshotNodeMap.getNodeId(snapshotChildren[snapshotChildrenIndex]) : undefined;
        const liveChildId = liveChildrenIndex < liveChildren.length ? this.liveNodeMap.getNodeId(liveChildren[liveChildrenIndex]) : undefined;

        if (snapshotChildrenIndex < snapshotChildren.length && liveChildrenIndex < liveChildren.length && snapshotChildId === liveChildId) {
          // elements match → no change
          snapshotChildrenIndex++;
          liveChildrenIndex++;
        } else if (liveChildrenIndex < liveChildren.length && liveChildId && (snapshotChildrenIndex >= snapshotChildren.length || !snapshotChildrenIds.includes(liveChildId))) {
          // element in newChildren[j] is new → insert
          const existingLiveChild = liveChildren[liveChildrenIndex];
          const clonedChild = existingLiveChild.cloneNode(true);
          this.snapshotNodeMap.mirrorNodeIdsToSubTree(existingLiveChild, clonedChild);

          snapshotEl.insertBefore(clonedChild, snapshotChildren[snapshotChildrenIndex]);
          snapshotChildren.splice(snapshotChildrenIndex, 0, clonedChild as ChildNode);
          snapshotChildrenIds.splice(snapshotChildrenIndex, 0, liveChildId!);

          ops.push({ op: "insert", parentId: liveNodeId, index: liveChildrenIndex, node: clonedChild });

          liveChildrenIndex++;
          snapshotChildrenIndex++;
        } else if (snapshotChildrenIndex < snapshotChildren.length && snapshotChildId && (liveChildrenIndex >= liveChildren.length || !liveChildrenIds.includes(snapshotChildId))) {
          // element in oldChildren[i] is missing → remove
          ops.push({ op: "remove", nodeId: snapshotChildId });
          
          const priorLiveNode = this.liveNodeMap.getNodeById(snapshotChildId);
          if (priorLiveNode) {
            this.liveNodeMap.removeNodesInSubtree(priorLiveNode);
          }

          snapshotEl.removeChild(snapshotChildren[snapshotChildrenIndex]);
          snapshotChildren.splice(snapshotChildrenIndex, 1);
          snapshotChildrenIds.splice(snapshotChildrenIndex, 1);
        } else {
          // TODO is there where we want to use the replace operation?
          // fallback: if elements differ but both exist later, remove + insert
          ops.push({ op: "remove", nodeId: snapshotChildId! });

          const priorLiveNode = this.liveNodeMap.getNodeById(liveChildId!);
          if (priorLiveNode) {
            this.liveNodeMap.removeNodesInSubtree(priorLiveNode);
          }

          const existingLiveChild = liveChildren[liveChildrenIndex];
          const clonedChild = existingLiveChild.cloneNode(true);
          this.snapshotNodeMap.mirrorNodeIdsToSubTree(existingLiveChild, clonedChild);

          ops.push({ op: "insert", parentId: liveNodeId, index: liveChildrenIndex, node: clonedChild });

          const priorSnapshotNode = snapshotChildren[snapshotChildrenIndex]
          this.snapshotNodeMap.removeNodesInSubtree(priorSnapshotNode);
          
          snapshotEl.replaceChild(clonedChild, priorSnapshotNode);

          snapshotChildren.splice(snapshotChildrenIndex, 1, clonedChild as ChildNode);
          snapshotChildrenIds.splice(snapshotChildrenIndex, 1, liveChildId!);

          snapshotChildrenIndex++;
          liveChildrenIndex++;
        }
      }
        
      // Also handle updates for children that exist in both arrays
      const commonChildren = snapshotChildren.filter(child => {
        const childId = this.snapshotNodeMap.getNodeId(child);
        return childId && childIdsThatExistInLiveAndSnapshot.includes(childId);
      });

      for (const snapshotChild of commonChildren) {        
        const childId = this.snapshotNodeMap.getNodeId(snapshotChild);
        const liveChild = this.liveNodeMap.getNodeById(childId)!;
        
        // Recursively diff the child nodes
        const recursiveOps = this.computeAndApplyOperations(liveChild, snapshotChild);
        ops.push(...recursiveOps);
      }
      
      return ops;
    }
    
    console.error('Unexpected change', liveNode, snapshotNode);
    return [];
  }

  disconnect(): void {
    this.liveDomObserver.disconnect();
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
  }
}