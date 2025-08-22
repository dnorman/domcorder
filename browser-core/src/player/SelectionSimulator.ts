import { NodeIdBiMap } from '../common';
import { getSelectionVisualRects, type LineRect } from './SelectionRangeGenerator';

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
  backgroundColor: 'rgb(104 188 255)',
  opacity: 0.4,
  zIndex: 1000
};

export class SelectionSimulator {
  private overlayElement: HTMLElement;
  private selectionContainer: HTMLElement;
  private nodeIdBiMap: NodeIdBiMap;
  private config: Required<SelectionOverlayConfig>;
  private currentSelectionElements: HTMLElement[] = [];
  
  // Track current scroll position
  private currentScrollX: number = 0;
  private currentScrollY: number = 0;

  constructor(overlayElement: HTMLElement, nodeIdBiMap: NodeIdBiMap, config: SelectionOverlayConfig = {}) {
    this.overlayElement = overlayElement;
    this.nodeIdBiMap = nodeIdBiMap;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Create a container element for selections that will be translated on scroll
    this.selectionContainer = document.createElement('div');
    this.selectionContainer.style.position = 'absolute';
    this.selectionContainer.style.top = '0';
    this.selectionContainer.style.left = '0';
    this.selectionContainer.style.width = '100%';
    this.selectionContainer.style.height = '100%';
    this.selectionContainer.style.pointerEvents = 'none';
    this.selectionContainer.style.transform = 'translate(0px, 0px)';
    this.selectionContainer.style.transformOrigin = '0 0';
    
    this.overlayElement.appendChild(this.selectionContainer);
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
      return;
      // throw new Error(`Start node with ID ${startNodeId} not found in NodeIdBiMap`);
    }

    if (!endNode) {
      return;
      // throw new Error(`End node with ID ${endNodeId} not found in NodeIdBiMap`);
    }

    // Validate offsets
    const startTextContent = startNode.textContent || '';
    const endTextContent = endNode.textContent || '';

    if (startOffset < 0 || startOffset > startTextContent.length) {
      return;
      // throw new Error(
      //   `Start offset ${startOffset} is out of range for node ${startNodeId}. ` +
      //   `Valid range: 0 to ${startTextContent.length}`
      // );
    }

    if (endOffset < 0 || endOffset > endTextContent.length) {
      return;
      //   throw new Error(
      //     `End offset ${endOffset} is out of range for node ${endNodeId}. ` +
      //     `Valid range: 0 to ${endTextContent.length}`
      // );
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
   * Updates the position of selection overlays when the page is scrolled
   * 
   * @param scrollX - The horizontal scroll offset
   * @param scrollY - The vertical scroll offset
   */
  public updateScrollPosition(scrollX: number, scrollY: number): void {
    this.currentScrollX = scrollX;
    this.currentScrollY = scrollY;
    
    // Simply translate the selection container to compensate for scroll
    this.selectionContainer.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
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
    const document = startNode.ownerDocument!;
    const selection = document.defaultView!.getSelection();
    
    // Store the current selection to restore it later
    const originalSelection = selection ? {
      rangeCount: selection.rangeCount,
      ranges: Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    } : null;

    try {
      // Clear any existing selection
      if (selection) {
        selection.removeAllRanges();
      }

      // Create a new range for our selection
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      // Add the range to the selection to get accurate client rects
      if (selection) {
        selection.addRange(range);
      }

      const rects = getSelectionVisualRects(range);
      
      // Create overlay elements for each filtered rectangle
      rects.forEach(rect => {
        if (rect.width > 0 && rect.height > 0) {
          const overlayElement = this.createOverlayElement(rect);
          this.selectionContainer.appendChild(overlayElement);
          this.currentSelectionElements.push(overlayElement);
        }
      });

    } finally {
      // Restore the original selection
      if (selection && originalSelection) {
        selection.removeAllRanges();
        originalSelection.ranges.forEach(range => {
          selection.addRange(range);
        });
      }
    }
  }

  /**
   * Filters out rectangles that span the full width of their parent containers
   * This helps eliminate duplicate overlays where one covers just the text and another spans the full width
   */
  private filterFullWidthRectangles(rects: DOMRect[], range: Range): DOMRect[] {
    // If we only have one rectangle, keep it (no duplicates to filter)
    if (rects.length <= 1) {
      return rects;
    }

    // Group rectangles by their vertical position (y-coordinate)
    const rectGroups = this.groupRectanglesByVerticalPosition(rects);
    
    const filteredRects: DOMRect[] = [];
    
    rectGroups.forEach(group => {
      if (group.length === 1) {
        // Single rectangle on this line, keep it
        filteredRects.push(group[0]);
      } else {
        // Multiple rectangles on the same line - filter out the full-width ones
        const filteredGroup = this.filterFullWidthRectanglesInGroup(group, range);
        filteredRects.push(...filteredGroup);
      }
    });
    
    return filteredRects;
  }

  /**
   * Groups rectangles by their vertical position (y-coordinate) to handle multi-line selections
   */
  private groupRectanglesByVerticalPosition(rects: DOMRect[]): DOMRect[][] {
    const groups: DOMRect[][] = [];
    const tolerance = 2; // 2px tolerance for grouping rectangles on the same line
    
    rects.forEach(rect => {
      let addedToGroup = false;
      
      for (const group of groups) {
        if (group.length > 0) {
          const groupY = group[0].top;
          if (Math.abs(rect.top - groupY) <= tolerance) {
            group.push(rect);
            addedToGroup = true;
            break;
          }
        }
      }
      
      if (!addedToGroup) {
        groups.push([rect]);
      }
    });
    
    return groups;
  }

  /**
   * Filters full-width rectangles within a group of rectangles on the same line
   */
  private filterFullWidthRectanglesInGroup(rects: DOMRect[], range: Range): DOMRect[] {
    // Get the parent container
    const container = range.commonAncestorContainer;
    let parentElement: Element | null = null;
    
    if (container.nodeType === Node.TEXT_NODE) {
      parentElement = container.parentElement;
    } else if (container.nodeType === Node.ELEMENT_NODE) {
      parentElement = container as Element;
    }
    
    if (!parentElement) {
      return rects; // Can't determine parent, keep all rectangles
    }
    
    const parentRect = parentElement.getBoundingClientRect();
    const tolerance = 1;
    
    // Check if any rectangle spans the full width
    const hasFullWidthRect = rects.some(rect => 
      Math.abs(rect.left - parentRect.left) <= tolerance && 
      Math.abs(rect.right - parentRect.right) <= tolerance
    );
    
    if (!hasFullWidthRect) {
      return rects; // No full-width rectangle, keep all
    }
    
    // Find the narrowest rectangle (likely the actual text bounds)
    const narrowestRect = rects.reduce((narrowest, current) => 
      current.width < narrowest.width ? current : narrowest
    );
    
    // Find the widest rectangle (likely the full-width container rectangle)
    const widestRect = rects.reduce((widest, current) => 
      current.width > widest.width ? current : widest
    );
    
    // If the widest rectangle is significantly wider than the narrowest (more than 10px difference),
    // and the widest spans the full width, then filter out the widest
    const significantWidthDifference = widestRect.width - narrowestRect.width > 10;
    const widestSpansFullWidth = Math.abs(widestRect.left - parentRect.left) <= tolerance && 
                                Math.abs(widestRect.right - parentRect.right) <= tolerance;
    
    if (significantWidthDifference && widestSpansFullWidth) {
      // Filter out the full-width rectangle, keep the narrower ones
      return rects.filter(rect => 
        !(Math.abs(rect.left - parentRect.left) <= tolerance && 
          Math.abs(rect.right - parentRect.right) <= tolerance)
      );
    } else {
      // Keep all rectangles if there's no significant width difference
      // This handles cases where text actually spans the full width
      return rects;
    }
  }

  /**
   * Creates a single overlay element with the given bounds
   */
  private createOverlayElement(bounds: LineRect): HTMLElement {
    const element = document.createElement('div');
    
    // Adjust position to account for current scroll offset
    const adjustedLeft = bounds.left + this.currentScrollX;
    const adjustedTop = bounds.top + this.currentScrollY;
    
    element.style.position = 'absolute';
    element.style.left = `${adjustedLeft}px`;
    element.style.top = `${adjustedTop}px`;
    element.style.width = `${bounds.width}px`;
    element.style.height = `${bounds.height}px`;
    element.style.backgroundColor = this.config.backgroundColor;
    element.style.opacity = this.config.opacity.toString();
    element.style.zIndex = this.config.zIndex.toString();
    element.style.pointerEvents = 'none';
    
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
