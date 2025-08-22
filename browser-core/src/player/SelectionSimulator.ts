import { NodeIdBiMap } from '../common';

/**
 * SelectionSimulator - Simulates text selection during playback
 * 
 * This class is responsible for:
 * - Setting text selections on a target document using node IDs and offsets
 * - Validating that node IDs exist in the provided NodeIdBiMap
 * - Validating that offsets are within valid ranges for text nodes
 * - Clearing all selections from the document
 * 
 * Design Specifications:
 * 
 * Selection Behavior:
 * - Creates standard DOM Range objects for text selection
 * - Supports selections across multiple nodes (start/end nodes can be different)
 * - Validates node IDs exist in the provided NodeIdBiMap
 * - Validates offsets are within valid text content bounds
 * - Throws descriptive errors for invalid inputs
 * 
 * Error Handling:
 * - Throws error if start or end node IDs don't exist in the map
 * - Throws error if offsets are outside valid text content range
 * - Throws error if target nodes are not text nodes
 * 
 * API:
 * - Constructor takes NodeIdBiMap and Document
 * - setSelection(startNodeId, startOffset, endNodeId, endOffset) for setting text selection
 * - clearSelection() for removing all selections
 */

export class SelectionSimulator {
  private nodeIdBiMap: NodeIdBiMap;
  private document: Document;

  constructor(nodeIdBiMap: NodeIdBiMap, document: Document) {
    this.nodeIdBiMap = nodeIdBiMap;
    this.document = document;
  }

  /**
   * Sets a text selection on the document using node IDs and offsets
   * 
   * @param startNodeId - The ID of the starting node for the selection
   * @param startOffset - The offset within the starting node (0-based)
   * @param endNodeId - The ID of the ending node for the selection
   * @param endOffset - The offset within the ending node (0-based)
   * @throws Error if node IDs don't exist in the map
   * @throws Error if offsets are invalid for the target nodes
   * @throws Error if target nodes are not text nodes
   */
  public setSelection(
    startNodeId: number,
    startOffset: number,
    endNodeId: number,
    endOffset: number
  ): void {
    // Get the nodes from the bi-directional map
    const startNode = this.nodeIdBiMap.getNodeById(startNodeId);
    const endNode = this.nodeIdBiMap.getNodeById(endNodeId);

    if (!startNode) {
      throw new Error(`Start node with ID ${startNodeId} not found in NodeIdBiMap`);
    }

    if (!endNode) {
      throw new Error(`End node with ID ${endNodeId} not found in NodeIdBiMap`);
    }

    // Validate that both nodes are text nodes
    if (startNode.nodeType !== Node.TEXT_NODE) {
      throw new Error(`Start node with ID ${startNodeId} is not a text node (nodeType: ${startNode.nodeType})`);
    }

    if (endNode.nodeType !== Node.TEXT_NODE) {
      throw new Error(`End node with ID ${endNodeId} is not a text node (nodeType: ${endNode.nodeType})`);
    }

    // Validate offsets
    const startTextContent = startNode.textContent || '';
    const endTextContent = endNode.textContent || '';

    if (startOffset < 0 || startOffset > startTextContent.length) {
      throw new Error(
        `Start offset ${startOffset} is out of range for node ${startNodeId}. ` +
        `Valid range: 0 to ${startTextContent.length}`
      );
    }

    if (endOffset < 0 || endOffset > endTextContent.length) {
      throw new Error(
        `End offset ${endOffset} is out of range for node ${endNodeId}. ` +
        `Valid range: 0 to ${endTextContent.length}`
      );
    }

    // Determine the correct document order for the range
    const { documentStartNode, documentStartOffset, documentEndNode, documentEndOffset } = 
      this.getDocumentOrderedPositions(startNode, startOffset, endNode, endOffset);

    // Create the range
    const range = this.document.createRange();
    range.setStart(documentStartNode, documentStartOffset);
    range.setEnd(documentEndNode, documentEndOffset);

    // Clear any existing selection and set the new one
    const selection = this.document.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  /**
   * Determines the correct document order for two positions and returns them in start/end order
   * 
   * @param node1 - First node
   * @param offset1 - Offset within first node
   * @param node2 - Second node
   * @param offset2 - Offset within second node
   * @returns Object with documentStartNode, documentStartOffset, documentEndNode, documentEndOffset
   */
  private getDocumentOrderedPositions(
    node1: Node,
    offset1: number,
    node2: Node,
    offset2: number
  ): {
    documentStartNode: Node;
    documentStartOffset: number;
    documentEndNode: Node;
    documentEndOffset: number;
  } {
    // If both nodes are the same, just check the offsets
    if (node1 === node2) {
      if (offset1 <= offset2) {
        return {
          documentStartNode: node1,
          documentStartOffset: offset1,
          documentEndNode: node2,
          documentEndOffset: offset2
        };
      } else {
        return {
          documentStartNode: node2,
          documentStartOffset: offset2,
          documentEndNode: node1,
          documentEndOffset: offset1
        };
      }
    }

    // Create two ranges to compare positions
    const range1 = this.document.createRange();
    const range2 = this.document.createRange();
    
    range1.setStart(node1, offset1);
    range1.setEnd(node1, offset1);
    
    range2.setStart(node2, offset2);
    range2.setEnd(node2, offset2);

    // Compare the positions using compareBoundaryPoints
    const comparison = range1.compareBoundaryPoints(Range.START_TO_END, range2);
    
    if (comparison <= 0) {
      // node1 comes before node2 in document order
      return {
        documentStartNode: node1,
        documentStartOffset: offset1,
        documentEndNode: node2,
        documentEndOffset: offset2
      };
    } else {
      // node2 comes before node1 in document order, swap the positions
      return {
        documentStartNode: node2,
        documentStartOffset: offset2,
        documentEndNode: node1,
        documentEndOffset: offset1
      };
    }
  }

  /**
   * Clears all selections from the document
   */
  public clearSelection(): void {
    const selection = this.document.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
  }
}
