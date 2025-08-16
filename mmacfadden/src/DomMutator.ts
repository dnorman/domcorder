import { NodeIdBiMap } from './dom/NodeIdBiMap';
import type { DomOperation } from './operation';
import { deserializeDomNode } from './serialization';

export class DomMutator {
  private root: Node;
  private nodeMap: NodeIdBiMap;

  constructor(root: Node, nodeMap?: NodeIdBiMap) {
    this.root = root;
    this.nodeMap = nodeMap ?? new NodeIdBiMap(root);
  }

  applyOps(ops: DomOperation[]): void {
    for (const op of ops) {
      switch (op.op) {
        case 'insert': {
          const parent = this.nodeMap.getNodeById(op.parentId)!;
          const node = op.node;
          parent.insertBefore(node, parent.childNodes[op.index] || null);
          this.nodeMap.assignNodeIdsToSubTree(node);
          break;
        }
        case 'remove': {
          const removedNode = this.nodeMap.getNodeById(op.nodeId)!;
          removedNode.parentNode?.removeChild(removedNode);
          this.nodeMap.removeNodesInSubtree(removedNode);
          break;
        }
        case 'replace': {
          const oldChild = this.nodeMap.getNodeById(op.nodeId)!;
          if (oldChild?.parentNode) {
            const newChild = op.node;
            oldChild.parentNode.replaceChild(newChild, oldChild);
            this.nodeMap.removeNodesInSubtree(oldChild);
            this.nodeMap.assignNodeIdsToSubTree(newChild);
          }
          
          break;
        }
        case 'updateAttribute': {
          const element = this.nodeMap.getNodeById(op.nodeId)! as Element;
          if (element && element.nodeType === Node.ELEMENT_NODE) {
            element.setAttribute(op.name, op.value);
          }
          break;
        }
        case 'removeAttribute': {
          const element = this.nodeMap.getNodeById(op.nodeId)! as Element;
          if (element && element.nodeType === Node.ELEMENT_NODE) {
            element.removeAttribute(op.name);
          }
          break;
        }
        case 'updateText': {
          const node = this.nodeMap.getNodeById(op.nodeId)!;
          if (node && node.nodeType === Node.TEXT_NODE) {
            node.textContent = op.value;
          }
          break;
        }
      }
    }
  }
}
