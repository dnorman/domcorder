/**
 * ElementScrollHandler - Manages scroll event binding and transform updates for a single scrollable element
 * 
 * This class encapsulates the scroll event handling for one scrollable element and its associated
 * overlay container. When the element scrolls, it updates the container's transform to keep
 * selection overlays properly positioned.
 */
export class ElementScrollHandler {
  private container: HTMLDivElement;
  private scrollableElement: HTMLElement;
  private scrollListener: ((event: Event) => void) | null = null;

  constructor(container: HTMLDivElement, scrollableElement: HTMLElement) {
    this.container = container;
    this.scrollableElement = scrollableElement;
  }

  /**
   * Bind to the scroll event of the underlying element and update the style of the container
   * when the element scrolls.
   */
  public bind(): void {
    if (this.scrollListener) {
      this.dispose(); // Clean up any existing binding
    }
    
    this.scrollListener = this.handleScroll.bind(this);
    this.scrollableElement.addEventListener('scroll', this.scrollListener, { passive: true });
    
    // Set initial position
    this.updateContainerPosition();
  }

  /**
   * Unbind from the scroll event.
   */
  public dispose(): void {
    if (this.scrollListener) {
      this.scrollableElement.removeEventListener('scroll', this.scrollListener);
      this.scrollListener = null;
    }
  }

  /**
   * Get the current scroll position of the element
   */
  public getScrollPosition(): { scrollX: number; scrollY: number } {
    return {
      scrollX: this.scrollableElement.scrollLeft,
      scrollY: this.scrollableElement.scrollTop
    };
  }

  /**
   * Handle scroll events from the scrollable element
   */
  private handleScroll(): void {
    this.updateContainerPosition();
  }

  /**
   * Update the container's transform to compensate for the element's scroll position
   */
  private updateContainerPosition(): void {
    const scrollX = this.scrollableElement.scrollLeft;
    const scrollY = this.scrollableElement.scrollTop;
    
    // Transform the container to compensate for the element's scroll
    this.container.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
  }
}
