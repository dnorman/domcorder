import { NodeIdBiMap } from '../common';
import type { DomOperation } from '../common/DomOperation';
import { applyChanges } from '../recorder/StringChangeDetector';

export class DomMutator {
  private readonly nodeMap: NodeIdBiMap;

  constructor(nodeMap: NodeIdBiMap) {
    this.nodeMap = nodeMap;
  }

  public getElementByNodeId(nodeId: number): Element | null {
    const node = this.nodeMap.getNodeById(nodeId);
    return (node && node.nodeType === Node.ELEMENT_NODE) ? node as Element : null;
  }

  public getNodeById(nodeId: number): Node | null {
    return this.nodeMap.getNodeById(nodeId) || null;
  }

  public updateElementScrollPosition(nodeId: number, scrollXOffset: number, scrollYOffset: number) {
    const element = this.nodeMap.getNodeById(nodeId)! as Element;
    if (element && element.nodeType === Node.ELEMENT_NODE) {
      element.scrollTo(scrollXOffset, scrollYOffset);
    }
  }

  public applyOps(ops: DomOperation[]): void {
    for (const op of ops) {
      switch (op.op) {
        case 'insert': {
          const parent = this.nodeMap.getNodeById(op.parentId)!;
          const node = op.node;
          parent.insertBefore(node, parent.childNodes[op.index] || null);
          this.nodeMap.adoptNodesFromSubTree(node);
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
            this.nodeMap.adoptNodesFromSubTree(newChild);
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
          if (node && (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.CDATA_SECTION_NODE)) {
            const textContent = node.textContent!;
            const updatedText = applyChanges(textContent, op.ops);
            node.textContent = updatedText;
          } else {
            console.error('Node is not a text node, type:', node.nodeType);
          }
          break;
        }
        case 'propertyChanged': {
          const node = this.nodeMap.getNodeById(op.nodeId)!;
          if (node && node.nodeType === Node.ELEMENT_NODE) {
            (node as any)[op.property] = op.value;
          }
          break;
        }
      }
    }
  }

  public async updateCanvas(nodeId: number, mimeType: string, data: ArrayBuffer) {
    const canvas = this.nodeMap.getNodeById(nodeId)! as HTMLCanvasElement;
    if (!canvas) return;

    const blob = new Blob([data], { type: mimeType });
    const bitmap = await createImageBitmap(blob);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not available");

    // Resize canvas if needed
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(bitmap, 0, 0);
  }
}
