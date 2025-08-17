import type { DomOperation, SerializedNode, NodePath } from './domDiff';

// Helper: create a DOM Node from a SerializedNode
function createNodeFromSerialized(doc: Document, node: SerializedNode): Node {
  if (node.type === 'text') {
    return doc.createTextNode(node.text);
  } else {
    const el = doc.createElement(node.tag);
    for (const [k, v] of Object.entries(node.attributes)) {
      el.setAttribute(k, v);
    }
    for (const child of node.children) {
      el.appendChild(createNodeFromSerialized(doc, child));
    }
    return el;
  }
}

// Helper: find the parent node by path
function getNodeByPath(root: Element, path: NodePath): Node {
  let node: Node = root;
  for (const idx of path) {
    if (!node.childNodes[idx]) throw new Error('Invalid path');
    node = node.childNodes[idx];
  }
  return node;
}

export function applyDomDiff(root: Element, ops: DomOperation[]): void {
  for (const op of ops) {
    switch (op.op) {
      case 'insert': {
        const parent = getNodeByPath(root, op.path) as Element;
        const node = createNodeFromSerialized(root.ownerDocument!, op.node);
        parent.insertBefore(node, parent.childNodes[op.index] || null);
        break;
      }
      case 'remove': {
        const parent = getNodeByPath(root, op.path) as Element;
        const child = parent.childNodes[op.index];
        if (child) parent.removeChild(child);
        break;
      }
      case 'replace': {
        const parent = getNodeByPath(root, op.path.slice(0, -1)) as Element;
        const node = createNodeFromSerialized(root.ownerDocument!, op.node);
        const oldChild = parent.childNodes[op.path[op.path.length - 1]];
        if (oldChild) parent.replaceChild(node, oldChild);
        break;
      }
      case 'updateAttribute': {
        const parent = getNodeByPath(root, op.path) as Element;
        const el = parent.childNodes[op.index] as Element;
        if (el && el.nodeType === Node.ELEMENT_NODE) {
          el.setAttribute(op.name, op.value);
        }
        break;
      }
      case 'removeAttribute': {
        const parent = getNodeByPath(root, op.path) as Element;
        const el = parent.childNodes[op.index] as Element;
        if (el && el.nodeType === Node.ELEMENT_NODE) {
          el.removeAttribute(op.name);
        }
        break;
      }
      case 'updateText': {
        const textNode = getNodeByPath(root, op.path);
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          textNode.textContent = op.value;
        }
        break;
      }
    }
  }
} 