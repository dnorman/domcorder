import { NodeIdBiMap, ASSET_CONTAINING_ATTRIBUTES } from '../common';
import type { DomOperation } from '../common/DomOperation';
import type { StringMutationOperation } from '../common/StringMutationOperation';
import { applyChanges } from '../recorder/StringChangeDetector';
import type { AssetManager } from './AssetManager';

/**
 * DomMutator - A specification-aligned implementation of DOM mutation.
 * 
 * This implementation ensures:
 * - Proper index validation for insert operations (0 <= index <= parent.childNodes.length)
 * - Consistent error logging across all operations
 * - Graceful handling of ordering issues
 * - Node ID map management throughout the operation lifecycle
 * 
 * Key features:
 * - Explicit index bounds validation
 * - Comprehensive error logging
 * - Better error handling philosophy alignment with spec
 */
export class DomMutator {
  private readonly nodeMap: NodeIdBiMap;
  private readonly assetManager: AssetManager;

  /**
   * Creates a new DomMutator instance.
   * 
   * @param nodeMap - The NodeIdBiMap that maps node IDs to DOM nodes in the target document
   * @param assetManager - The AssetManager for resolving asset placeholders to blob URLs
   */
  constructor(nodeMap: NodeIdBiMap, assetManager: AssetManager) {
    this.nodeMap = nodeMap;
    this.assetManager = assetManager;
  }

  /**
   * Gets an Element node by its node ID.
   * Returns null if the node doesn't exist or is not an Element.
   */
  public getElementByNodeId(nodeId: number): Element | null {
    const node = this.nodeMap.getNodeById(nodeId);
    return (node && node.nodeType === Node.ELEMENT_NODE) ? node as Element : null;
  }

  /**
   * Gets a Node by its node ID.
   * Returns null if the node doesn't exist.
   */
  public getNodeById(nodeId: number): Node | null {
    return this.nodeMap.getNodeById(nodeId) || null;
  }

  /**
   * Applies a sequence of operations to the target DOM.
   * 
   * Operations are processed sequentially in the order provided.
   * The DomChangeDetector guarantees operations arrive in causal order.
   * 
   * @param ops - Array of operations to apply
   */
  public applyOps(ops: DomOperation[]): void {
    for (const op of ops) {
      try {
        this.applyOperation(op);
      } catch (e) {
        console.error(`[DomMutator] Error applying operation ${op.op}:`, e, op);
        // Continue processing other operations even if one fails
      }
    }
  }

  /**
   * Applies a single operation to the target DOM.
   */
  private applyOperation(op: DomOperation): void {
    switch (op.op) {
      case 'insert':
        this.handleInsert(op);
        break;
      case 'remove':
        this.handleRemove(op);
        break;
      case 'updateAttribute':
        this.handleUpdateAttribute(op);
        break;
      case 'removeAttribute':
        this.handleRemoveAttribute(op);
        break;
      case 'updateText':
        this.handleUpdateText(op);
        break;
    }
  }

  /**
   * Handles an insert operation.
   * 
   * Validates:
   * - Parent node exists
   * - Index is within valid bounds (0 <= index <= parent.childNodes.length)
   * - Node to insert has a node ID
   * 
   * @param op - The insert operation
   */
  private handleInsert(op: { op: 'insert'; parentId: number; index: number; node: Node }): void {
    const parent = this.nodeMap.getNodeById(op.parentId);
    
    if (!parent) {
      console.error(
        `[DomMutator] Insert operation failed: parent node ${op.parentId} does not exist in nodeMap. ` +
        `This indicates an ordering issue - the parent was never added or was already removed.`
      );
      return;
    }

    // Validate index bounds as per spec
    if (op.index < 0) {
      console.error(
        `[DomMutator] Insert operation failed: index ${op.index} is negative. ` +
        `Index must be >= 0.`
      );
      return;
    }

    if (op.index > parent.childNodes.length) {
      console.error(
        `[DomMutator] Insert operation failed: index ${op.index} is out of bounds for parent ${op.parentId}. ` +
        `Parent has ${parent.childNodes.length} children, so index must be <= ${parent.childNodes.length}. ` +
        `This indicates a synchronization issue between source and target documents.`
      );
      return;
    }

    // Validate that the node to insert has a node ID
    const nodeId = NodeIdBiMap.getNodeId(op.node);
    if (nodeId === undefined) {
      console.error(
        `[DomMutator] Insert operation failed: node to insert does not have a node ID. ` +
        `All nodes must have node IDs assigned by the DomChangeDetector.`
      );
      return;
    }

    // Check if node is already in the DOM (might happen if same node reference is reused)
    // If it's already a child of the parent, insertBefore will just move it, which is fine
    // But if it's in a different location, we need to remove it first
    if (op.node.parentNode && op.node.parentNode !== parent) {
      op.node.parentNode.removeChild(op.node);
    }
    
    // Insert the node at the specified index
    // index === parent.childNodes.length is valid (append)
    // Note: If node is already a child of parent, insertBefore will move it to the correct position
    const referenceNode = parent.childNodes[op.index] || null;
    if (op.node.parentNode === parent && op.node.nextSibling === referenceNode) {
      // Node is already in the correct position, skip insertion
      // But still need to ensure it's in the node map
      this.nodeMap.adoptNodesFromSubTree(op.node);
      return;
    }
    
    parent.insertBefore(op.node, referenceNode);
    
    // Adopt all nodes in the inserted subtree into the node ID map
    this.nodeMap.adoptNodesFromSubTree(op.node);
  }

  /**
   * Handles a remove operation.
   * 
   * Gracefully handles:
   * - Node doesn't exist (non-fatal: log and continue)
   * - Node already detached (non-fatal: still remove from map)
   * 
   * @param op - The remove operation
   */
  private handleRemove(op: { op: 'remove'; nodeId: number }): void {
    const removedNode = this.nodeMap.getNodeById(op.nodeId);
    
    if (!removedNode) {
      console.error(
        `[DomMutator] Remove operation failed: node ${op.nodeId} does not exist in nodeMap. ` +
        `This indicates an ordering issue - the node was never added or was already removed.`
      );
      // Non-fatal: continue processing other operations
      return;
    }

    if (!removedNode.parentNode) {
      console.warn(
        `[DomMutator] Remove operation: node ${op.nodeId} has no parentNode, ` +
        `may have already been removed from DOM. Still removing from nodeMap.`
      );
      // Still remove from nodeMap even if already removed from DOM
      this.nodeMap.removeNodesInSubtree(removedNode);
      return;
    }

    // Remove from DOM
    removedNode.parentNode.removeChild(removedNode);
    
    // Remove from node ID map and clear node IDs
    this.nodeMap.removeNodesInSubtree(removedNode);
  }

  /**
   * Handles an updateAttribute operation.
   * 
   * Silently skips if:
   * - Node is not an Element (attributes only exist on Elements)
   * 
   * Errors if:
   * - Node doesn't exist (fatal: indicates synchronization issue)
   * 
   * @param op - The updateAttribute operation
   */
  private handleUpdateAttribute(op: { op: 'updateAttribute'; nodeId: number; name: string; value: string }): void {
    const node = this.nodeMap.getNodeById(op.nodeId);
    
    if (!node) {
      console.error(
        `[DomMutator] UpdateAttribute operation failed: node ${op.nodeId} does not exist. ` +
        `This indicates a synchronization issue.`
      );
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      // Silently skip: attributes can only exist on Element nodes
      // This is expected behavior per spec
      return;
    }

    const element = node as Element;
    this.assetManager.findAndBindAssetToElementProperty(element, op.name, op.value);
  }

  /**
   * Handles a removeAttribute operation.
   * 
   * Silently skips if:
   * - Node is not an Element (attributes only exist on Elements)
   * 
   * Errors if:
   * - Node doesn't exist (fatal: indicates synchronization issue)
   * 
   * Note: removeAttribute() is idempotent, so calling it when the attribute
   * doesn't exist is safe.
   * 
   * @param op - The removeAttribute operation
   */
  private handleRemoveAttribute(op: { op: 'removeAttribute'; nodeId: number; name: string }): void {
    const node = this.nodeMap.getNodeById(op.nodeId);
    
    if (!node) {
      console.error(
        `[DomMutator] RemoveAttribute operation failed: node ${op.nodeId} does not exist. ` +
        `This indicates a synchronization issue.`
      );
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      // Silently skip: attributes can only exist on Element nodes
      // This is expected behavior per spec
      return;
    }

    const element = node as Element;
    element.removeAttribute(op.name);
  }

  /**
   * Handles an updateText operation.
   * 
   * Errors if:
   * - Node doesn't exist (fatal: indicates synchronization issue)
   * - Node is not a CharacterData node (Text, Comment, or CDATASection)
   * 
   * @param op - The updateText operation
   */
  private handleUpdateText(op: { op: 'updateText'; nodeId: number; ops: StringMutationOperation[] }): void {
    const node = this.nodeMap.getNodeById(op.nodeId);
    
    if (!node) {
      console.error(
        `[DomMutator] UpdateText operation failed: node ${op.nodeId} does not exist. ` +
        `This indicates a synchronization issue.`
      );
      return;
    }

    if (node.nodeType !== Node.TEXT_NODE &&
        node.nodeType !== Node.COMMENT_NODE &&
        node.nodeType !== Node.CDATA_SECTION_NODE) {
      console.error(
        `[DomMutator] UpdateText operation failed: node ${op.nodeId} is not a CharacterData node. ` +
        `Node type is ${node.nodeType}, expected TEXT_NODE, COMMENT_NODE, or CDATA_SECTION_NODE.`
      );
      return;
    }

    const textContent = node.textContent || '';
    const updatedText = applyChanges(textContent, op.ops);
    node.textContent = updatedText;
  }

  // Additional utility methods (not part of core spec, but useful for extended functionality)

  /**
   * Updates the scroll position of an element.
   * Not part of core DOM mutation operations, but useful for playback.
   */
  public updateElementScrollPosition(nodeId: number, scrollXOffset: number, scrollYOffset: number): void {
    const node = this.nodeMap.getNodeById(nodeId);
    if (node && node.nodeType === Node.ELEMENT_NODE) {
      (node as Element).scrollTo(scrollXOffset, scrollYOffset);
    }
  }

  /**
   * Updates a property on a node.
   * Not part of core DOM mutation operations, but useful for extended functionality.
   */
  public updateNodeProperty(nodeId: number, property: string, value: any): void {
    const node = this.nodeMap.getNodeById(nodeId);
    if (node && node.nodeType === Node.ELEMENT_NODE) {
      (node as any)[property] = value;
    }
  }

  /**
   * Updates a property using text operations.
   * Not part of core DOM mutation operations, but useful for extended functionality.
   */
  public updateNodePropertyWithTextOperations(
    nodeId: number, 
    property: string, 
    operations: StringMutationOperation[]
  ): void {
    const node = this.nodeMap.getNodeById(nodeId);
    if (node && node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const currentValue = (element as any)[property] || '';
      
      // Apply text operations to get the new value
      const newValue = applyChanges(currentValue, operations);
      (element as any)[property] = newValue;
    }
  }

  /**
   * Updates a canvas element with image data.
   * Not part of core DOM mutation operations, but useful for extended functionality.
   */
  public async updateCanvas(nodeId: number, mimeType: string, data: ArrayBuffer): Promise<void> {
    const node = this.nodeMap.getNodeById(nodeId);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const canvas = node as HTMLCanvasElement;
    if (canvas.tagName !== 'CANVAS') {
      return;
    }

    const blob = new Blob([data], { type: mimeType });
    const bitmap = await createImageBitmap(blob);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D context not available");
    }

    // Resize canvas if needed
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
  }
}

