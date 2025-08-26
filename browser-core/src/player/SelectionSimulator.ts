import { NodeIdBiMap } from '../common';
import { getSelectionVisualRects, type LineRect } from './SelectionRangeGenerator';
import { ScrollableElementRegistry } from './ScrollableElementRegistry';
import { ScrollableElementTracker } from './ScrollableElementTracker';

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
  
  // Target document (iframe document)
  private targetDocument: Document;

  // Scrollable element management
  private scrollableRegistry: ScrollableElementRegistry;
  private scrollableTracker: ScrollableElementTracker;

  constructor(
    overlayElement: HTMLElement,
    nodeIdBiMap: NodeIdBiMap,
    targetDocument: Document,
    config: SelectionOverlayConfig = {}
  ) {
    this.overlayElement = overlayElement;
    this.nodeIdBiMap = nodeIdBiMap;
    this.targetDocument = targetDocument;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Create a container element for selections that will be translated on scroll
    this.selectionContainer = document.createElement('div');
    this.selectionContainer.style.position = 'absolute';
    this.selectionContainer.style.top = '0';
    this.selectionContainer.style.left = '0';
    // Size to match the full document, not just the viewport
    // Will be updated properly in updateContainerSize()
    this.selectionContainer.style.width = '100%';
    this.selectionContainer.style.height = '100%';
    this.selectionContainer.style.pointerEvents = 'none';
    this.selectionContainer.style.transform = 'translate(0px, 0px)';
    this.selectionContainer.style.transformOrigin = '0 0';
    
    this.overlayElement.appendChild(this.selectionContainer);

    // Initialize scrollable element management
    this.scrollableRegistry = new ScrollableElementRegistry(this.selectionContainer);
    this.scrollableTracker = new ScrollableElementTracker(this.scrollableRegistry);
    this.scrollableTracker.start();
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

    // Update container size to ensure it matches current document dimensions
    this.updateContainerSize();
    
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
    
    // Clean up any empty scrollable containers
    this.scrollableRegistry.cleanupEmptyContainer(document.body);
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
   * Updates the size of the selection container to match the document dimensions
   * Should be called when document content changes
   */
  public updateContainerSize(): void {
    // Get the maximum of all possible document dimension measurements
    const htmlElement = this.targetDocument.querySelector('html');
    
    const docWidth = Math.max(
      this.targetDocument.documentElement.scrollWidth,
      this.targetDocument.documentElement.clientWidth,
      this.targetDocument.documentElement.offsetWidth,
      htmlElement?.scrollWidth || 0,
      htmlElement?.clientWidth || 0,
      htmlElement?.offsetWidth || 0,
      this.targetDocument.body?.scrollWidth || 0,
      this.targetDocument.body?.clientWidth || 0,
      this.targetDocument.body?.offsetWidth || 0
    );
    
    const docHeight = Math.max(
      this.targetDocument.documentElement.scrollHeight,
      this.targetDocument.documentElement.clientHeight,
      this.targetDocument.documentElement.offsetHeight,
      htmlElement?.scrollHeight || 0,
      htmlElement?.clientHeight || 0,
      htmlElement?.offsetHeight || 0,
      this.targetDocument.body?.scrollHeight || 0,
      this.targetDocument.body?.clientHeight || 0,
      this.targetDocument.body?.offsetHeight || 0
    );
    
    this.selectionContainer.style.width = `${docWidth}px`;
    this.selectionContainer.style.height = `${docHeight}px`;
  }

  /**
   * Updates the position of selection overlays for a specific element
   * 
   * @param nodeId - The ID of the element to update
   * @param scrollX - The horizontal scroll offset
   * @param scrollY - The vertical scroll offset
   */
  public updateElementScrollPosition(nodeId: number, scrollX: number, scrollY: number): void {
    const element = this.nodeIdBiMap.getNodeById(nodeId);
    if (!element) return;
    
    const scrollableInfo = this.scrollableRegistry.getScrollableInfo(element as Element);
    if (scrollableInfo) {
      // The ElementScrollHandler will automatically update the container position
      // when it receives the scroll event, so we don't need to do anything here
      // This method exists for compatibility with the PagePlayer interface
    }
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

      // Split the range by scrollable element boundaries
      const rangeSegments = this.splitRangeByScrollableElements(range);
      
      // Create overlays for each segment
      rangeSegments.forEach(segment => {
        this.createOverlaysForRangeSegment(segment.range, segment.targetContainer, selection);
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
   * Split a range by scrollable element boundaries
   */
  private splitRangeByScrollableElements(range: Range): Array<{
    range: Range;
    targetContainer: HTMLElement;
  }> {
    const segments: Array<{ range: Range; targetContainer: HTMLElement }> = [];
    
    // Find scrollable ancestors of start and end nodes
    const startScrollable = this.findClosestScrollableAncestor(range.startContainer);
    const endScrollable = this.findClosestScrollableAncestor(range.endContainer);
    
    // Also check if there are any scrollable elements within the range
    const scrollableElementsInRange = this.findScrollableElementsInRange(range);
    const hasScrollableElementsInRange = scrollableElementsInRange.length > 0;
    

    
    // If both start and end are in the same scrollable context AND no scrollable elements in range, no splitting needed
    if (startScrollable === endScrollable && !hasScrollableElementsInRange) {

      const elementToUse = startScrollable || (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE 
        ? range.commonAncestorContainer as Element 
        : range.commonAncestorContainer.parentElement!);
      const targetContainer = this.scrollableRegistry.findOrCreateScrollableContainer(elementToUse);
      segments.push({ range: range.cloneRange(), targetContainer });
      return segments;
    }
    

    // Implement proper range splitting for ranges that cross scrollable boundaries
    return this.splitRangeAcrossScrollableBoundaries(range);
  }

  /**
   * Split a range that crosses scrollable element boundaries
   */
  private splitRangeAcrossScrollableBoundaries(range: Range): Array<{
    range: Range;
    targetContainer: HTMLElement;
  }> {
    const segments: Array<{ range: Range; targetContainer: HTMLElement }> = [];
    

    
    // Simple approach: check if start and end are in different scrollable contexts
    const startScrollable = this.findClosestScrollableAncestor(range.startContainer);
    const endScrollable = this.findClosestScrollableAncestor(range.endContainer);
    

    
    // If range crosses a scrollable boundary, we need to find the scrollable elements in between
    const scrollableElements = this.findScrollableElementsInRange(range);
    
    if (scrollableElements.length === 0) {
      // No scrollable elements in range, use simple approach
      const targetContainer = this.scrollableRegistry.findOrCreateScrollableContainer(
        startScrollable || (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE 
          ? range.commonAncestorContainer as Element 
          : range.commonAncestorContainer.parentElement!)
      );
      segments.push({ range: range.cloneRange(), targetContainer });
    } else {
      // Split the range at each scrollable element boundary
      let currentRange = range.cloneRange();
      
      for (const scrollableElement of scrollableElements) {
        // Create a range for content before this scrollable element
        const beforeRange = range.cloneRange();
        try {
          beforeRange.setEndBefore(scrollableElement);
          
          if (!beforeRange.collapsed && beforeRange.toString().trim()) {
            const beforeContainer = this.scrollableRegistry.findOrCreateScrollableContainer(
              this.findClosestScrollableAncestor(beforeRange.startContainer) || 
              (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE 
                ? range.commonAncestorContainer as Element 
                : range.commonAncestorContainer.parentElement!)
            );

            segments.push({ range: beforeRange, targetContainer: beforeContainer });
          }
        } catch (e) {

        }
        
        // Create a range for content inside this scrollable element
        const insideRange = range.cloneRange();
        
        // Check if the original range intersects with the scrollable element's content
        const elementRange = document.createRange();
        elementRange.selectNodeContents(scrollableElement);
        
        // Find the intersection of the original range with the scrollable element
        const compareStart = range.compareBoundaryPoints(Range.START_TO_START, elementRange);
        const compareEnd = range.compareBoundaryPoints(Range.END_TO_END, elementRange);
        
        // Check if the range actually intersects the element's content, not just touches its boundary
        const rangeIntersectsContent = range.intersectsNode(scrollableElement) && 
          (compareEnd > 0 || (compareEnd === 0 && range.endOffset > 0));
        
        if (rangeIntersectsContent) {
          if (compareStart <= 0) {
            // Original range starts before or at the element start
            insideRange.setStart(elementRange.startContainer, elementRange.startOffset);
          } else {
            // Original range starts after the element start
            insideRange.setStart(range.startContainer, range.startOffset);
          }
          
          if (compareEnd >= 0) {
            // Original range ends after or at the element end
            insideRange.setEnd(elementRange.endContainer, elementRange.endOffset);
          } else {
            // Original range ends before the element end
            insideRange.setEnd(range.endContainer, range.endOffset);
          }
        } else {
          // Range doesn't actually go into the element content
          insideRange.collapse(true); // Make it collapsed so it gets skipped
        }
        
        if (!insideRange.collapsed && insideRange.toString().trim()) {
          const insideContainer = this.scrollableRegistry.findOrCreateScrollableContainer(scrollableElement);

          segments.push({ range: insideRange, targetContainer: insideContainer });
        } else {

        }
        
        // Create a range for content after this scrollable element
        const afterRange = range.cloneRange();
        try {
          afterRange.setStartAfter(scrollableElement);
          
          if (!afterRange.collapsed && afterRange.toString().trim()) {
            const afterContainer = this.scrollableRegistry.findOrCreateScrollableContainer(
              this.findClosestScrollableAncestor(afterRange.startContainer) || 
              (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE 
                ? range.commonAncestorContainer as Element 
                : range.commonAncestorContainer.parentElement!)
            );

            segments.push({ range: afterRange, targetContainer: afterContainer });
          }
        } catch (e) {

        }
      }
    }
    
    return segments.length > 0 ? segments : [{ 
      range: range.cloneRange(), 
      targetContainer: this.scrollableRegistry.findOrCreateScrollableContainer(
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE 
          ? range.commonAncestorContainer as Element 
          : range.commonAncestorContainer.parentElement!
      )
    }];
  }

  /**
   * Find all scrollable elements that intersect with the range
   */
  private findScrollableElementsInRange(range: Range): Element[] {
    const scrollableElements: Element[] = [];
    const walker = range.commonAncestorContainer.ownerDocument!.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const element = node as Element;
          return this.isScrollable(element) && range.intersectsNode(element) ? 
            NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      }
    );
    
    let element = walker.nextNode();
    while (element) {
      scrollableElements.push(element as Element);

      element = walker.nextNode();
    }
    
    return scrollableElements;
  }

  /**
   * Find the closest scrollable ancestor of a node (including the node itself if it's an element)
   */
  private findClosestScrollableAncestor(node: Node): Element | null {
    let current = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    
    while (current && current !== document.body) {
      if (this.isScrollable(current)) {
        return current;
      }
      current = current.parentElement;
    }
    
    return null;
  }

  /**
   * Check if an element is scrollable
   */
  private isScrollable(element: Element | null): boolean {
    if (!element) return false;
    const computed = getComputedStyle(element);
    const hasScrollableContent = element.scrollHeight > element.clientHeight || 
                                element.scrollWidth > element.clientWidth;
    
    const canScroll = ['auto', 'scroll', 'hidden'].includes(computed.overflowY) || 
                     ['auto', 'scroll', 'hidden'].includes(computed.overflowX);
    
    return hasScrollableContent && canScroll;
  }

  /**
   * Create overlay elements for a specific range segment
   */
  private createOverlaysForRangeSegment(
    range: Range, 
    targetContainer: HTMLElement, 
    selection: Selection | null
  ): void {
    // Add the range to the selection to get accurate client rects
    if (selection) {
      selection.addRange(range);
    }

    const rects = getSelectionVisualRects(range);
    
    // Get the scrollable element for this container to calculate relative positioning
    const scrollableElement = this.getScrollableElementForContainer(targetContainer);
    
    // Create overlay elements for each filtered rectangle
    rects.forEach(rect => {
      if (rect.width > 0 && rect.height > 0) {
        const overlayElement = this.createOverlayElement(rect, targetContainer, scrollableElement);
        targetContainer.appendChild(overlayElement);
        this.currentSelectionElements.push(overlayElement);
      }
    });

    // Remove the range from selection
    if (selection) {
      selection.removeRange(range);
    }
  }

  /**
   * Get the scrollable element associated with a container
   */
  private getScrollableElementForContainer(container: HTMLElement): Element | null {
    if (container === this.selectionContainer) {
      return null; // Main container, no specific scrollable element
    }
    
    // Find the scrollable element by checking the registry
    const registryInfo = Array.from(this.scrollableRegistry['registry'].entries())
      .find(([element, info]) => info.overlayContainer === container);
    
    return registryInfo ? registryInfo[0] : null;
  }

  /**
   * Creates a single overlay element with the given bounds
   */
  private createOverlayElement(bounds: LineRect, targetContainer?: HTMLElement, scrollableElement?: Element | null): HTMLElement {
    const element = document.createElement('div');
    
    let adjustedLeft = bounds.left;
    let adjustedTop = bounds.top;
    
    // If using the main selection container (window scrolling), adjust for scroll offset
    if (!targetContainer || targetContainer === this.selectionContainer) {
      adjustedLeft = bounds.left + this.currentScrollX;
      adjustedTop = bounds.top + this.currentScrollY;
    } else if (scrollableElement) {
      // For scrollable element containers, position relative to the scrollable element's content area
      // Account for borders and current scroll position since the container is positioned at the content area
      const elementRect = scrollableElement.getBoundingClientRect();
      const computed = getComputedStyle(scrollableElement);
      const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
      const borderTop = parseFloat(computed.borderTopWidth) || 0;
      
      // Account for current scroll position - the container has been translated by -scroll amounts
      const currentScrollX = scrollableElement.scrollLeft;
      const currentScrollY = scrollableElement.scrollTop;
      
      adjustedLeft = bounds.left - (elementRect.left + borderLeft) + currentScrollX;
      adjustedTop = bounds.top - (elementRect.top + borderTop) + currentScrollY;
    } else {
      // Fallback: use bounds directly
      adjustedLeft = bounds.left;
      adjustedTop = bounds.top;
    }
    

    
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

  /**
   * Dispose of all resources including scrollable element tracking
   */
  public dispose(): void {
    this.clearSelection();
    this.scrollableTracker.dispose();
    this.scrollableRegistry.dispose();
  }
}
