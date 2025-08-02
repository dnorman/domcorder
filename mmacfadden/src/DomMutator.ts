import { NodeIdBiMap } from './NodeIdBiMap';
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
          const node = deserializeDomNode(this.root.ownerDocument!, op.node);
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
          // const parent = getNodeByPath(root, op.path.slice(0, -1)) as Element;
          // const node = deserializeDomNode(root.ownerDocument!, op.node);
          // const oldChild = parent.childNodes[op.path[op.path.length - 1]];
          // if (oldChild) parent.replaceChild(node, oldChild);
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
