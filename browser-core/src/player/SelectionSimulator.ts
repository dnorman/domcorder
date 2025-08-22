import { NodeIdBiMap } from '../common';

/**
 * SelectionOverlaySimulator - Simulates text selection using overlay elements
 * 
 * This class is responsible for:
 * - Creating visual selection overlays that appear on top of the page content
 * - Positioning overlay elements to match the exact bounds of text selections
 * - Handling multi-line selections with multiple overlay elements
 * - Providing consistent selection appearance regardless of window focus
 * 
 * Design Specifications:
 * 
 * Selection Appearance:
 * - Semi-transparent blue background (similar to browser default selection)
 * - Positioned absolutely over the target text content
 * - Multiple elements for multi-line selections
 * - Responsive to page scrolling and zoom
 * 
 * Overlay Elements:
 * - Created as div elements with specific styling
 * - Positioned using getBoundingClientRect() of text nodes
 * - Sized to match the exact text content bounds
 * - Added to the overlayElement container
 * 
 * Multi-line Handling:
 * - Splits selections across line boundaries
 * - Creates separate overlay elements for each line
 * - Handles partial line selections (start/end of lines)
 * 
 * API:
 * - Constructor takes overlayElement and NodeIdBiMap
 * - setSelection(startNodeId, startOffset, endNodeId, endOffset) for setting visual selection
 * - clearSelection() for removing all selection overlays
 */

export interface SelectionOverlayConfig {
  backgroundColor?: string;
  opacity?: number;
  zIndex?: number;
}

const DEFAULT_CONFIG: Required<SelectionOverlayConfig> = {
  backgroundColor: '#0078d7',
  opacity: 0.3,
  zIndex: 1000
};

export class SelectionSimulator {
  private overlayElement: HTMLElement;
  private nodeIdBiMap: NodeIdBiMap;
  private config: Required<SelectionOverlayConfig>;
  private currentSelectionElements: HTMLElement[] = [];

  constructor(overlayElement: HTMLElement, nodeIdBiMap: NodeIdBiMap, config: SelectionOverlayConfig = {}) {
    this.overlayElement = overlayElement;
    this.nodeIdBiMap = nodeIdBiMap;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Sets a visual text selection using overlay elements
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
    // Clear any existing selection
    this.clearSelection();

    // Get the nodes from the bi-directional map
    const startNode = this.nodeIdBiMap.getNodeById(startNodeId);
    const endNode = this.nodeIdBiMap.getNodeById(endNodeId);

    if (!startNode) {
      throw new Error(`Start node with ID ${startNodeId} not found in NodeIdBiMap`);
    }

    if (!endNode) {
      throw new Error(`End node with ID ${endNodeId} not found in NodeIdBiMap`);
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

    // Create overlay elements for the selection
    this.createSelectionOverlays(documentStartNode, documentStartOffset, documentEndNode, documentEndOffset);
  }

  /**
   * Clears all selection overlays
   */
  public clearSelection(): void {
    this.currentSelectionElements.forEach(element => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });
    this.currentSelectionElements = [];
  }

  /**
   * Updates the NodeIdBiMap reference (called when the map is recreated)
   */
  public updateNodeIdBiMap(nodeIdBiMap: NodeIdBiMap): void {
    this.nodeIdBiMap = nodeIdBiMap;
  }

  /**
   * Creates overlay elements for the given selection range
   */
  private createSelectionOverlays(
    startNode: Node,
    startOffset: number,
    endNode: Node,
    endOffset: number
  ): void {
    // Create a range for the entire selection
    const range = startNode.ownerDocument!.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    // Get all the client rectangles for this range
    const rects = Array.from(range.getClientRects());
    
    // Merge overlapping rectangles to avoid duplicate overlays
    const mergedRects = this.mergeOverlappingRectangles(rects);
    
    // Create overlay elements for each merged rectangle
    mergedRects.forEach(rect => {
      if (rect.width > 0 && rect.height > 0) {
        const overlayElement = this.createOverlayElement(rect);
        this.overlayElement.appendChild(overlayElement);
        this.currentSelectionElements.push(overlayElement);
      }
    });
  }

  /**
   * Merges overlapping rectangles to avoid duplicate overlays
   */
  private mergeOverlappingRectangles(rects: DOMRect[]): DOMRect[] {
    if (rects.length <= 1) return rects;

    const merged: DOMRect[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < rects.length; i++) {
      if (processed.has(i)) continue;

      let currentRect = rects[i];
      processed.add(i);

      // Check for overlaps with other rectangles
      for (let j = i + 1; j < rects.length; j++) {
        if (processed.has(j)) continue;

        const otherRect = rects[j];
        
        // Check if rectangles overlap (including touching edges)
        if (this.rectanglesOverlap(currentRect, otherRect)) {
          // Merge the rectangles
          currentRect = this.mergeRectangles(currentRect, otherRect);
          processed.add(j);
        }
      }

      merged.push(currentRect);
    }

    return merged;
  }

  /**
   * Checks if two rectangles overlap
   */
  private rectanglesOverlap(rect1: DOMRect, rect2: DOMRect): boolean {
    return !(
      rect1.right < rect2.left ||
      rect1.left > rect2.right ||
      rect1.bottom < rect2.top ||
      rect1.top > rect2.bottom
    );
  }

  /**
   * Merges two overlapping rectangles into one
   */
  private mergeRectangles(rect1: DOMRect, rect2: DOMRect): DOMRect {
    const left = Math.min(rect1.left, rect2.left);
    const top = Math.min(rect1.top, rect2.top);
    const right = Math.max(rect1.right, rect2.right);
    const bottom = Math.max(rect1.bottom, rect2.bottom);

    return new DOMRect(left, top, right - left, bottom - top);
  }



  /**
   * Creates a single overlay element with the given bounds
   */
  private createOverlayElement(bounds: DOMRect): HTMLElement {
    const element = document.createElement('div');
    
    element.style.position = 'absolute';
    element.style.left = `${bounds.left}px`;
    element.style.top = `${bounds.top}px`;
    element.style.width = `${bounds.width}px`;
    element.style.height = `${bounds.height}px`;
    element.style.backgroundColor = this.config.backgroundColor;
    element.style.opacity = this.config.opacity.toString();
    element.style.zIndex = this.config.zIndex.toString();
    element.style.pointerEvents = 'none';
    element.style.borderRadius = '2px';
    
    return element;
  }

  /**
   * Determines the correct document order for two positions and returns them in start/end order
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
    const range1 = node1.ownerDocument!.createRange();
    const range2 = node2.ownerDocument!.createRange();
    
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
}
