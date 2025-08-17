// TypeScript utility to compute incremental diffs between two DOM trees
// Each operation includes a path (array of child indices) to the parent node
// Operations are computed incrementally, taking into account the effects of previous operations

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

export type NodePath = number[];

export type DomOperation =
  | { op: 'insert'; path: NodePath; node: SerializedNode; index: number }
  | { op: 'remove'; path: NodePath; index: number }
  | { op: 'replace'; path: NodePath; node: SerializedNode }
  | { op: 'updateAttribute'; path: NodePath; index: number; name: string; value: string }
  | { op: 'removeAttribute'; path: NodePath; index: number; name: string }
  | { op: 'updateText'; path: NodePath; value: string };

/**
 * Compute incremental diff operations to transform oldNode into newNode.
 * Each operation is computed based on the state after applying previous operations.
 * @param oldNode - The root of the old DOM tree
 * @param newNode - The root of the new DOM tree
 * @returns List of incremental diff operations
 */
export function diffDom(
  oldNode: Node,
  newNode: Node,
  path: NodePath = []
): DomOperation[] {
  const ops: DomOperation[] = [];
  
  // If nodes are of different types, replace
  if (oldNode.nodeType !== newNode.nodeType) {
    ops.push({ 
      op: 'replace', 
      path,
      node: nodeToSerialized(newNode) 
    });
    return ops;
  }

  // Handle text nodes
  if (oldNode.nodeType === Node.TEXT_NODE && newNode.nodeType === Node.TEXT_NODE) {
    if (oldNode.textContent !== newNode.textContent) {
      ops.push({
        op: 'updateText',
        path,
        value: newNode.textContent || ''
      });
    }
    return ops;
  }

  // Handle element nodes
  if (oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
    const oldEl = oldNode as Element;
    const newEl = newNode as Element;
    
    // Tag name changed: replace
    if (oldEl.tagName !== newEl.tagName) {
      ops.push({ 
        op: 'replace', 
        path,
        node: nodeToSerialized(newNode) 
      });
      return ops;
    }
    
    // Attribute diffs
    const oldAttrs = oldEl.attributes;
    const newAttrs = newEl.attributes;
    
    // Check for removed and updated attributes
    for (let i = 0; i < oldAttrs.length; i++) {
      const attrName = oldAttrs[i].name;
      const newAttr = newEl.getAttribute(attrName);
      if (newAttr === null) {
        ops.push({
          op: 'removeAttribute',
          path,
          index: path[path.length - 1] ?? 0,
          name: attrName
        });
      } else if (newAttr !== oldAttrs[i].value) {
        ops.push({
          op: 'updateAttribute',
          path,
          index: path[path.length - 1] ?? 0,
          name: attrName,
          value: newAttr
        });
      }
    }
    
    // Check for new attributes
    for (let i = 0; i < newAttrs.length; i++) {
      const attrName = newAttrs[i].name;
      if (!oldEl.hasAttribute(attrName)) {
        ops.push({
          op: 'updateAttribute',
          path,
          index: path[path.length - 1] ?? 0,
          name: attrName,
          value: newAttrs[i].value
        });
      }
    }
    
    // Children diff - process from end to beginning to maintain indices
    const oldChildren = Array.from(oldEl.childNodes);
    const newChildren = Array.from(newEl.childNodes);
    const maxLen = Math.max(oldChildren.length, newChildren.length);
    
    // Process removals first (from end to beginning to maintain indices)
    for (let i = maxLen - 1; i >= 0; i--) {
      if (i >= oldChildren.length) continue; // nothing to remove
      if (i >= newChildren.length) {
        // Remove old child
        ops.push({
          op: 'remove',
          path,
          index: i
        });
      }
    }
    
    // Process insertions and updates
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
      } else if (i < newChildren.length) {
        // Diff children recursively
        const childOps = diffDom(oldChildren[i], newChildren[i], childPath);
        ops.push(...childOps);
      }
    }
    
    return ops;
  }
  
  // Fallback: replace
  ops.push({ 
    op: 'replace', 
    path, 
    node: nodeToSerialized(newNode) 
  });
  return ops;
}

// To run the test, see test/domDiff.test.ts 