import { ScrollableElementRegistry } from './ScrollableElementRegistry';

/**
 * ScrollableElementTracker - Observes DOM changes and updates scrollable element registry
 * 
 * This class uses MutationObserver and ResizeObserver to detect when elements become
 * scrollable or stop being scrollable, updating the registry accordingly.
 */
export class ScrollableElementTracker {
  private mutationObserver: MutationObserver;
  private resizeObserver: ResizeObserver;
  private registry: ScrollableElementRegistry;
  private isObserving = false;

  constructor(registry: ScrollableElementRegistry) {
    this.registry = registry;
    
    // Single MutationObserver watching the entire document
    this.mutationObserver = new MutationObserver(this.handleMutations.bind(this));
    
    // Single ResizeObserver for content size changes
    this.resizeObserver = new ResizeObserver(this.handleResize.bind(this));
  }

  /**
   * Start observing for changes
   */
  public start(): void {
    if (this.isObserving) return;
    
    this.mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'class'], // Style changes that might affect scrollability
      childList: true,                     // DOM structure changes
      subtree: true                        // Watch entire tree
    });
    
    this.isObserving = true;
  }

  /**
   * Stop observing for changes
   */
  public stop(): void {
    if (!this.isObserving) return;
    
    this.mutationObserver.disconnect();
    this.resizeObserver.disconnect();
    this.isObserving = false;
  }

  /**
   * Handle mutation observer events
   */
  private handleMutations(mutations: MutationRecord[]): void {
    const elementsToCheck = new Set<Element>();

    mutations.forEach(mutation => {
      // Check for style/class changes that might affect scrollability
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        elementsToCheck.add(mutation.target);
      }
      
      // Check for DOM structure changes
      if (mutation.type === 'childList') {
        // Check added nodes
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) {
            elementsToCheck.add(node);
            // Also check all descendant elements
            this.addDescendantsToCheck(node, elementsToCheck);
          }
        });
        
        // Handle removed nodes - clean up any associated containers
        mutation.removedNodes.forEach(node => {
          if (node instanceof Element) {
            this.handleRemovedElement(node);
          }
        });
      }
    });

    // Re-evaluate scrollability for all affected elements
    elementsToCheck.forEach(element => {
      this.updateElementScrollability(element);
    });
  }

  /**
   * Handle resize observer events
   */
  private handleResize(entries: ResizeObserverEntry[]): void {
    entries.forEach(entry => {
      if (entry.target instanceof Element) {
        this.updateElementScrollability(entry.target);
      }
    });
  }

  /**
   * Add all descendant elements to the check set
   */
  private addDescendantsToCheck(element: Element, elementsToCheck: Set<Element>): void {
    const descendants = element.querySelectorAll('*');
    descendants.forEach(descendant => {
      elementsToCheck.add(descendant);
    });
  }

  /**
   * Handle when an element is removed from the DOM
   */
  private handleRemovedElement(element: Element): void {
    // Clean up the element and all its descendants
    const descendants = element.querySelectorAll('*');
    descendants.forEach(descendant => {
      this.registry.removeScrollableContainer(descendant);
    });
    this.registry.removeScrollableContainer(element);
  }

  /**
   * Update scrollability status for a single element
   */
  private updateElementScrollability(element: Element): void {
    const isCurrentlyScrollable = this.isScrollable(element);
    const hasContainer = this.registry.getScrollableInfo(element) !== undefined;
    
    // Check if element is hidden
    const computed = getComputedStyle(element);
    const isHidden = computed.display === 'none' || computed.visibility === 'hidden';
    
    if (isHidden && hasContainer) {
      // Element became hidden, remove container
      this.registry.removeScrollableContainer(element);
    } else if (isCurrentlyScrollable && !hasContainer && !isHidden) {
      // Element became scrollable, but don't create container yet
      // Container will be created when needed by SelectionSimulator
      
      // Start observing for resize changes on this element
      this.resizeObserver.observe(element);
    } else if (!isCurrentlyScrollable && hasContainer) {
      // Element stopped being scrollable, remove container
      this.registry.removeScrollableContainer(element);
      this.resizeObserver.unobserve(element);
    }
  }

  /**
   * Check if an element is scrollable
   */
  private isScrollable(element: Element): boolean {
    const computed = getComputedStyle(element);
    const hasScrollableContent = element.scrollHeight > element.clientHeight || 
                                element.scrollWidth > element.clientWidth;
    
    // Include 'hidden' since it can be programmatically scrolled
    const canScroll = ['auto', 'scroll', 'hidden'].includes(computed.overflowY) || 
                     ['auto', 'scroll', 'hidden'].includes(computed.overflowX);
    
    return hasScrollableContent && canScroll;
  }

  /**
   * Dispose of all observers
   */
  public dispose(): void {
    this.stop();
  }
}
