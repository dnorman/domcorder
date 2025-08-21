import { NodeIdBiMap } from '../common';
import type { DomOperation } from '../common/DomOperation';
import { applyChanges } from '../recorder/StringChangeDetector';

export class DomMutator {
  private nodeMap: NodeIdBiMap;

  constructor(nodeMap: NodeIdBiMap) {
      this.nodeMap = nodeMap;
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
            const textContent = node.textContent!;
            const updatedText = applyChanges(textContent, op.ops);
            node.textContent = updatedText;
          }
          break;
        }
      }
    }
  }
}
