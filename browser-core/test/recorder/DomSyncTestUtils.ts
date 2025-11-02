import { NodeIdBiMap } from '../../src/common/NodeIdBiMap';
import type { DomOperation } from '../../src/common/DomOperation';

/**
 * Test utilities for DOM synchronization testing.
 * Provides helper functions for creating, cloning, and comparing DOM structures.
 */

/**
 * Creates a test DOM structure from a simple specification.
 * 
 * @param structure - Object describing the DOM structure
 * @returns Created DOM element
 * 
 * @example
 * createTestDOM({
 *   tag: 'div',
 *   attrs: { id: 'test', class: 'container' },
 *   children: [
 *     { tag: 'span', text: 'Hello' },
 *     { tag: 'p', children: [{ tag: 'em', text: 'World' }] }
 *   ]
 * })
 */
export interface DOMStructure {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: DOMStructure[];
}

export function createTestDOM(structure: DOMStructure, document: Document = window.document): Element {
  const element = document.createElement(structure.tag);
  
  if (structure.attrs) {
    for (const [key, value] of Object.entries(structure.attrs)) {
      element.setAttribute(key, value);
    }
  }
  
  if (structure.text) {
    element.textContent = structure.text;
  }
  
  if (structure.children) {
    for (const childStruct of structure.children) {
      const child = createTestDOM(childStruct, document);
      element.appendChild(child);
    }
  }
  
  return element;
}

/**
 * Deep clones a DOM node, preserving structure but not node IDs.
 */
export function cloneDOM(node: Node): Node {
  return node.cloneNode(true);
}

/**
 * Asserts that two DOM nodes are structurally equal.
 * Compares:
 * - Node types
 * - Tag names (for elements)
 * - Text content (for text nodes)
 * - Attributes (for elements)
 * - Child structure
 * 
 * @throws Error if DOMs are not equal
 */
export function assertDOMEqual(source: Node, target: Node, path: string = 'root'): void {
  if (source.nodeType !== target.nodeType) {
    throw new Error(
      `Node type mismatch at ${path}: ` +
      `source=${source.nodeType}, target=${target.nodeType}`
    );
  }

  if (source.nodeType === Node.TEXT_NODE ||
      source.nodeType === Node.COMMENT_NODE ||
      source.nodeType === Node.CDATA_SECTION_NODE) {
    if (source.textContent !== target.textContent) {
      throw new Error(
        `Text content mismatch at ${path}: ` +
        `source="${source.textContent}", target="${target.textContent}"`
      );
    }
    return;
  }

  if (source.nodeType === Node.ELEMENT_NODE) {
    const sourceEl = source as Element;
    const targetEl = target as Element;

    if (sourceEl.tagName !== targetEl.tagName) {
      throw new Error(
        `Tag name mismatch at ${path}: ` +
        `source=${sourceEl.tagName}, target=${targetEl.tagName}`
      );
    }

    // Compare attributes
    const sourceAttrs = Array.from(sourceEl.attributes);
    const targetAttrs = Array.from(targetEl.attributes);

    if (sourceAttrs.length !== targetAttrs.length) {
      throw new Error(
        `Attribute count mismatch at ${path}: ` +
        `source=${sourceAttrs.length}, target=${targetAttrs.length}`
      );
    }

    for (const sourceAttr of sourceAttrs) {
      const targetAttr = targetEl.getAttribute(sourceAttr.name);
      if (targetAttr !== sourceAttr.value) {
        throw new Error(
          `Attribute mismatch at ${path}.${sourceAttr.name}: ` +
          `source="${sourceAttr.value}", target="${targetAttr}"`
        );
      }
    }

    // Compare children
    const sourceChildren = Array.from(source.childNodes);
    const targetChildren = Array.from(target.childNodes);

    if (sourceChildren.length !== targetChildren.length) {
      throw new Error(
        `Child count mismatch at ${path}: ` +
        `source=${sourceChildren.length}, target=${targetChildren.length}`
      );
    }

    for (let i = 0; i < sourceChildren.length; i++) {
      const childPath = `${path} > [${i}]`;
      assertDOMEqual(sourceChildren[i], targetChildren[i], childPath);
    }
  }
}

/**
 * Asserts that node IDs match between source and target DOMs.
 * 
 * @throws Error if node ID mappings don't match
 */
export function assertNodeIDsMatch(
  sourceNode: Node,
  targetNode: Node,
  sourceMap: NodeIdBiMap,
  targetMap: NodeIdBiMap,
  path: string = 'root'
): void {
  const sourceId = sourceMap.getNodeId(sourceNode);
  const targetId = targetMap.getNodeId(targetNode);

  if (sourceId !== targetId) {
    throw new Error(
      `Node ID mismatch at ${path}: ` +
      `source=${sourceId}, target=${targetId}`
    );
  }

  // Recursively check children
  const sourceChildren = Array.from(sourceNode.childNodes);
  const targetChildren = Array.from(targetNode.childNodes);

  if (sourceChildren.length !== targetChildren.length) {
    throw new Error(
      `Child count mismatch at ${path} (cannot check IDs): ` +
      `source=${sourceChildren.length}, target=${targetChildren.length}`
    );
  }

  for (let i = 0; i < sourceChildren.length; i++) {
    const childPath = `${path} > [${i}]`;
    assertNodeIDsMatch(
      sourceChildren[i],
      targetChildren[i],
      sourceMap,
      targetMap,
      childPath
    );
  }
}

/**
 * Generates a random but valid DOM mutation.
 * Useful for property-based/fuzz testing.
 */
export interface Mutation {
  type: 'insert' | 'remove' | 'updateAttribute' | 'removeAttribute' | 'updateText';
  nodeId?: number;
  parentId?: number;
  index?: number;
  attrName?: string;
  attrValue?: string;
  textValue?: string;
}

export function generateRandomMutation(
  availableNodeIds: number[],
  availableParentIds: number[],
  availableAttrNames: string[] = ['class', 'id', 'data-test', 'title']
): Mutation | null {
  if (availableNodeIds.length === 0) {
    return null;
  }

  const mutationTypes: Mutation['type'][] = [
    'insert',
    'remove',
    'updateAttribute',
    'removeAttribute',
    'updateText'
  ];

  const type = mutationTypes[Math.floor(Math.random() * mutationTypes.length)];
  const nodeId = availableNodeIds[Math.floor(Math.random() * availableNodeIds.length)];

  switch (type) {
    case 'insert':
      if (availableParentIds.length === 0) return null;
      return {
        type: 'insert',
        parentId: availableParentIds[Math.floor(Math.random() * availableParentIds.length)],
        index: Math.floor(Math.random() * 10), // Random index
      };
    case 'remove':
      return { type: 'remove', nodeId };
    case 'updateAttribute':
      if (availableAttrNames.length === 0) return null;
      return {
        type: 'updateAttribute',
        nodeId,
        attrName: availableAttrNames[Math.floor(Math.random() * availableAttrNames.length)],
        attrValue: `value-${Math.random().toString(36).substr(2, 9)}`
      };
    case 'removeAttribute':
      if (availableAttrNames.length === 0) return null;
      return {
        type: 'removeAttribute',
        nodeId,
        attrName: availableAttrNames[Math.floor(Math.random() * availableAttrNames.length)]
      };
    case 'updateText':
      return {
        type: 'updateText',
        nodeId,
        textValue: `text-${Math.random().toString(36).substr(2, 9)}`
      };
    default:
      return null;
  }
}

/**
 * Applies a mutation to a DOM node.
 * Used for generating test scenarios.
 */
export function applyMutationToDOM(
  dom: Node,
  mutation: Mutation,
  nodeMap: NodeIdBiMap,
  document: Document = window.document
): void {
  switch (mutation.type) {
    case 'insert':
      if (mutation.parentId === undefined || mutation.index === undefined) return;
      const parent = nodeMap.getNodeById(mutation.parentId);
      if (!parent || parent.nodeType !== Node.ELEMENT_NODE) return;
      const newElement = document.createElement('div');
      const index = Math.min(mutation.index, parent.childNodes.length);
      parent.insertBefore(newElement, parent.childNodes[index] || null);
      nodeMap.assignNodeIdsToSubTree(newElement);
      break;
    case 'remove':
      if (mutation.nodeId === undefined) return;
      const nodeToRemove = nodeMap.getNodeById(mutation.nodeId);
      if (nodeToRemove && nodeToRemove.parentNode) {
        nodeToRemove.parentNode.removeChild(nodeToRemove);
        nodeMap.removeNodesInSubtree(nodeToRemove);
      }
      break;
    case 'updateAttribute':
      if (mutation.nodeId === undefined || !mutation.attrName || !mutation.attrValue) return;
      const attrNode = nodeMap.getNodeById(mutation.nodeId);
      if (attrNode && attrNode.nodeType === Node.ELEMENT_NODE) {
        (attrNode as Element).setAttribute(mutation.attrName, mutation.attrValue);
      }
      break;
    case 'removeAttribute':
      if (mutation.nodeId === undefined || !mutation.attrName) return;
      const removeAttrNode = nodeMap.getNodeById(mutation.nodeId);
      if (removeAttrNode && removeAttrNode.nodeType === Node.ELEMENT_NODE) {
        (removeAttrNode as Element).removeAttribute(mutation.attrName);
      }
      break;
    case 'updateText':
      if (mutation.nodeId === undefined || !mutation.textValue) return;
      const textNode = nodeMap.getNodeById(mutation.nodeId);
      if (textNode && (
        textNode.nodeType === Node.TEXT_NODE ||
        textNode.nodeType === Node.COMMENT_NODE ||
        textNode.nodeType === Node.CDATA_SECTION_NODE
      )) {
        textNode.textContent = mutation.textValue;
      }
      break;
  }
}

/**
 * Collects all node IDs from a DOM tree.
 */
export function collectNodeIds(node: Node, nodeMap: NodeIdBiMap): number[] {
  const ids: number[] = [];
  const nodeId = nodeMap.getNodeId(node);
  if (nodeId !== undefined) {
    ids.push(nodeId);
  }
  for (const child of Array.from(node.childNodes)) {
    ids.push(...collectNodeIds(child, nodeMap));
  }
  return ids;
}

/**
 * Collects all element node IDs from a DOM tree.
 */
export function collectElementIds(node: Node, nodeMap: NodeIdBiMap): number[] {
  const ids: number[] = [];
  if (node.nodeType === Node.ELEMENT_NODE) {
    const nodeId = nodeMap.getNodeId(node);
    if (nodeId !== undefined) {
      ids.push(nodeId);
    }
  }
  for (const child of Array.from(node.childNodes)) {
    ids.push(...collectElementIds(child, nodeMap));
  }
  return ids;
}

/**
 * Waits for a specified number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Waits for the next animation frame.
 */
export function waitForAnimationFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/**
 * Waits for all pending mutations to be processed.
 * This is useful for testing MutationObserver behavior.
 */
export function waitForMutations(ms: number = 50): Promise<void> {
  return delay(ms);
}

