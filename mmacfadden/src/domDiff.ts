// TypeScript utility to compute minimal diffs between two DOM trees
// Each operation includes a path (array of child indices) to the parent node

// JSON-serializable representation of a DOM node
export type SerializedNode =
  | { type: 'text'; text: string }
  | { type: 'element'; tag: string; attributes: Record<string, string>; children: SerializedNode[] };

// Convert a DOM Node to a SerializedNode
export function nodeToSerialized(node: Node): SerializedNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: 'text', text: node.textContent || '' };
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const attributes: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
      attributes[el.attributes[i].name] = el.attributes[i].value;
    }
    const children = Array.from(el.childNodes).map(nodeToSerialized);
    return { type: 'element', tag: el.tagName.toLowerCase(), attributes, children };
  } else {
    // Ignore comments and others
    return { type: 'text', text: '' };
  }
}

export type Path = number[];

export type DiffOp =
  | { op: 'insert'; path: Path; node: SerializedNode; index: number }
  | { op: 'remove'; path: Path; index: number }
  | { op: 'replace'; path: Path; index: number; node: SerializedNode }
  | { op: 'updateAttribute'; path: Path; index: number; name: string; value: string }
  | { op: 'removeAttribute'; path: Path; index: number; name: string }
  | { op: 'updateText'; path: Path; value: string };

/**
 * Compute minimal diff operations to transform oldNode into newNode.
 * @param oldNode - The root of the old DOM tree
 * @param newNode - The root of the new DOM tree
 * @returns List of diff operations
 */
export function diffDom(
  oldNode: Node,
  newNode: Node,
  path: Path = []
): DiffOp[] {
  // If nodes are of different types, replace
  if (oldNode.nodeType !== newNode.nodeType) {
    return [{ op: 'replace', path, index: path[path.length - 1] ?? 0, node: nodeToSerialized(newNode) }];
  }

  // Handle text nodes
  if (oldNode.nodeType === Node.TEXT_NODE && newNode.nodeType === Node.TEXT_NODE) {
    if (oldNode.textContent !== newNode.textContent) {
      return [{
        op: 'updateText',
        path,
        value: newNode.textContent || ''
      }];
    }
    return [];
  }

  // Handle element nodes
  if (oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
    const oldEl = oldNode as Element;
    const newEl = newNode as Element;
    const ops: DiffOp[] = [];
    // Tag name changed: replace
    if (oldEl.tagName !== newEl.tagName) {
      return [{ op: 'replace', path, index: path[path.length - 1] ?? 0, node: nodeToSerialized(newNode) }];
    }
    // Attribute diffs
    const oldAttrs = oldEl.attributes;
    const newAttrs = newEl.attributes;
    const oldAttrNames = new Set<string>();
    for (let i = 0; i < oldAttrs.length; i++) {
      oldAttrNames.add(oldAttrs[i].name);
      const newAttr = newEl.getAttribute(oldAttrs[i].name);
      if (newAttr === null) {
        ops.push({
          op: 'removeAttribute',
          path,
          index: path[path.length - 1] ?? 0,
          name: oldAttrs[i].name
        });
      } else if (newAttr !== oldAttrs[i].value) {
        ops.push({
          op: 'updateAttribute',
          path,
          index: path[path.length - 1] ?? 0,
          name: oldAttrs[i].name,
          value: newAttr
        });
      }
    }
    for (let i = 0; i < newAttrs.length; i++) {
      if (!oldEl.hasAttribute(newAttrs[i].name)) {
        ops.push({
          op: 'updateAttribute',
          path,
          index: path[path.length - 1] ?? 0,
          name: newAttrs[i].name,
          value: newAttrs[i].value
        });
      }
    }
    // Children diff
    const oldChildren = Array.from(oldEl.childNodes);
    const newChildren = Array.from(newEl.childNodes);
    const maxLen = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLen; i++) {
      const childPath = [...path, i];
      if (i >= oldChildren.length) {
        // Insert new child
        ops.push({
          op: 'insert',
          path,
          node: nodeToSerialized(newChildren[i]),
          index: i
        });
      } else if (i >= newChildren.length) {
        // Remove old child
        ops.push({
          op: 'remove',
          path,
          index: i
        });
      } else {
        // Diff children recursively
        ops.push(...diffDom(oldChildren[i], newChildren[i], childPath));
      }
    }
    return ops;
  }
  // Fallback: replace
  return [{ op: 'replace', path, index: path[path.length - 1] ?? 0, node: nodeToSerialized(newNode) }];
}