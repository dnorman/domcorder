import { ElementScrollHandler } from './ElementScrollHandler';

/**
 * Information about a scrollable element and its associated overlay container
 */
export interface ScrollableElementInfo {
  element: Element;
  overlayContainer: HTMLDivElement;
  scrollHandler: ElementScrollHandler;
  parentScrollable: ScrollableElementInfo | null;
  childScrollables: Set<ScrollableElementInfo>;
}

/**
 * Registry for managing scrollable elements and their associated overlay containers
 * 
 * This class maintains the hierarchy of scrollable elements and their overlay containers,
 * handling creation, positioning, and cleanup of containers as elements become scrollable
 * or stop being scrollable.
 */
export class ScrollableElementRegistry {
  private registry = new Map<Element, ScrollableElementInfo>();
  private rootContainer: HTMLElement;

  constructor(rootContainer: HTMLElement) {
    this.rootContainer = rootContainer;
  }

  /**
   * Check if an element is scrollable
   */
  private isScrollable(element: Element | null): boolean {
    if (!element) return false;
    const computed = getComputedStyle(element);
    const hasScrollableContent = element.scrollHeight > element.clientHeight || 
                                element.scrollWidth > element.clientWidth;
    
    // Include 'hidden' since it can be programmatically scrolled
    const canScroll = ['auto', 'scroll', 'hidden'].includes(computed.overflowY) || 
                     ['auto', 'scroll', 'hidden'].includes(computed.overflowX);
    
    const isScrollable = hasScrollableContent && canScroll;
    

    
    return isScrollable;
  }

  /**
   * Find or create a scrollable container for the given element
   */
  public findOrCreateScrollableContainer(element: Element): HTMLElement {
    // First, find the closest scrollable ancestor
    const scrollableAncestor = this.findClosestScrollableAncestor(element);
    
    if (scrollableAncestor && !this.registry.has(scrollableAncestor)) {
      this.createScrollableContainer(scrollableAncestor);
    }
    
    return scrollableAncestor ? 
      this.registry.get(scrollableAncestor)!.overlayContainer : 
      this.rootContainer;
  }

  /**
   * Find the closest scrollable ancestor of an element (including the element itself)
   */
  private findClosestScrollableAncestor(element: Element): Element | null {
    let current: Element | null = element;
    
    while (current && current !== document.body) {
      if (current && this.isScrollable(current)) {
        return current;
      }
      current = current.parentElement;
    }
    
    return null;
  }

  /**
   * Create a scrollable container for the given element
   */
  private createScrollableContainer(element: Element): ScrollableElementInfo {
    // Create clipping container that stays fixed and provides overflow clipping
    const clippingContainer = document.createElement('div');
    clippingContainer.style.position = 'absolute';
    clippingContainer.style.pointerEvents = 'none';
    clippingContainer.style.overflow = 'hidden'; // This provides the clipping
    
    // Create scrollable container that gets translated on scroll
    const scrollableContainer = document.createElement('div');
    scrollableContainer.style.position = 'absolute';
    scrollableContainer.style.left = '0px';
    scrollableContainer.style.top = '0px';
    scrollableContainer.style.width = '100%';
    scrollableContainer.style.height = '100%';
    scrollableContainer.style.pointerEvents = 'none';
    scrollableContainer.style.transformOrigin = '0 0';
    
    // Put scrollable container inside clipping container
    clippingContainer.appendChild(scrollableContainer);
    
    // Position the clipping container to match the element's content area
    this.positionContainer(clippingContainer, element);
    

    
    // Create and bind ElementScrollHandler to the scrollable container (the one that moves)
    const scrollHandler = new ElementScrollHandler(scrollableContainer, element as HTMLElement);
    scrollHandler.bind();
    
    // Find parent scrollable and establish hierarchy
    const parentScrollable = this.findParentScrollable(element);
    const parentContainer = parentScrollable ? 
      parentScrollable.overlayContainer : 
      this.rootContainer;
    
    // Append the clipping container to the parent
    parentContainer.appendChild(clippingContainer);
    

    
    // Create registry entry - overlayContainer is now the scrollableContainer (where overlays go)
    const info: ScrollableElementInfo = {
      element,
      overlayContainer: scrollableContainer, // Overlays go in the scrollable container
      scrollHandler,
      parentScrollable,
      childScrollables: new Set()
    };
    
    // Update parent-child relationships
    if (parentScrollable) {
      parentScrollable.childScrollables.add(info);
    }
    
    this.registry.set(element, info);
    return info;
  }

  /**
   * Position a container relative to its scrollable element
   */
  private positionContainer(container: HTMLDivElement, element: Element): void {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    
    // Get current document scroll position to convert viewport coordinates to document coordinates
    const doc = element.ownerDocument!;
    const scrollX = doc.defaultView?.scrollX || doc.documentElement.scrollLeft || 0;
    const scrollY = doc.defaultView?.scrollY || doc.documentElement.scrollTop || 0;
    
    // Get the content area (excluding borders and scrollbars) for proper clipping
    const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
    const borderTop = parseFloat(computed.borderTopWidth) || 0;
    const borderRight = parseFloat(computed.borderRightWidth) || 0;
    const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
    
    // Position container to match the content area, accounting for document scroll
    // rect gives viewport coordinates, but we need document coordinates since
    // the main selection container is translated by scroll offset
    const contentLeft = rect.left + borderLeft + scrollX;
    const contentTop = rect.top + borderTop + scrollY;
    const contentWidth = rect.width - borderLeft - borderRight;
    const contentHeight = rect.height - borderTop - borderBottom;
    
    container.style.left = `${contentLeft}px`;
    container.style.top = `${contentTop}px`;
    container.style.width = `${contentWidth}px`;
    container.style.height = `${contentHeight}px`;
    

  }

  /**
   * Find the parent scrollable element info
   */
  private findParentScrollable(element: Element): ScrollableElementInfo | null {
    let current = element.parentElement;
    
    while (current && current !== document.body) {
      const info = this.registry.get(current);
      if (info) {
        return info;
      }
      current = current.parentElement;
    }
    
    return null;
  }

  /**
   * Remove a scrollable container and clean up
   */
  public removeScrollableContainer(element: Element): void {
    const info = this.registry.get(element);
    if (!info) return;
    
    // Dispose of scroll handler
    info.scrollHandler.dispose();
    
    // Remove from parent's children
    if (info.parentScrollable) {
      info.parentScrollable.childScrollables.delete(info);
    }
    
    // Move any child containers to parent
    info.childScrollables.forEach(child => {
      const newParent = info.parentScrollable ? 
        info.parentScrollable.overlayContainer : 
        this.rootContainer;
      
      newParent.appendChild(child.overlayContainer);
      child.parentScrollable = info.parentScrollable;
      
      if (info.parentScrollable) {
        info.parentScrollable.childScrollables.add(child);
      }
    });
    
    // Remove container from DOM
    info.overlayContainer.remove();
    
    // Remove from registry
    this.registry.delete(element);
  }

  /**
   * Clean up empty containers immediately
   */
  public cleanupEmptyContainer(element: Element): void {
    const info = this.registry.get(element);
    if (info && info.overlayContainer.children.length === 0 && info.childScrollables.size === 0) {
      this.removeScrollableContainer(element);
    }
  }

  /**
   * Get scrollable element info
   */
  public getScrollableInfo(element: Element): ScrollableElementInfo | undefined {
    return this.registry.get(element);
  }

  /**
   * Update container positions for all registered scrollable elements
   */
  public updateAllContainerPositions(): void {
    this.registry.forEach(info => {
      this.positionContainer(info.overlayContainer, info.element);
    });
  }

  /**
   * Dispose of all containers and handlers
   */
  public dispose(): void {
    this.registry.forEach(info => {
      info.scrollHandler.dispose();
    });
    this.registry.clear();
  }
}
