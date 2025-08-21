import { NodeIdBiMap } from '../common/NodeIdBiMap';

/**
 * Event handler interface for user interaction events
 */
export interface UserInteractionEventHandler {
  onMouseMove?: (event: { x: number; y: number; timestamp: number }) => void;
  onMouseClick?: (event: { x: number; y: number; timestamp: number }) => void;
  onKeyPress?: (event: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; timestamp: number }) => void;
  onWindowResize?: (event: { width: number; height: number; timestamp: number }) => void;
  onScroll?: (event: { scrollX: number; scrollY: number; timestamp: number }) => void;
  onElementScroll?: (event: { elementId: number; scrollLeft: number; scrollTop: number; timestamp: number }) => void;
  onElementFocus?: (event: { elementId: number; timestamp: number }) => void;
  onElementBlur?: (event: { elementId: number; timestamp: number }) => void;
  onTextSelection?: (event: { startNodeId: number; startOffset: number; endNodeId: number; endOffset: number; timestamp: number }) => void;
  onWindowFocus?: (event: { timestamp: number }) => void;
  onWindowBlur?: (event: { timestamp: number }) => void;
}

/**
 * Configuration options for the UserInteractionTracker
 */
export interface UserInteractionTrackerConfig {
  mouseMoveDebounceMs?: number;
  scrollDebounceMs?: number;
  resizeDebounceMs?: number;
  selectionDebounceMs?: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<UserInteractionTrackerConfig> = {
  mouseMoveDebounceMs: 16, // ~60fps
  scrollDebounceMs: 16,    // ~60fps
  resizeDebounceMs: 100,   // 10fps
  selectionDebounceMs: 100 // 10fps
};

export class UserInteractionTracker {
  private nodeIdBiMap: NodeIdBiMap;
  private eventHandler: UserInteractionEventHandler;
  private config: Required<UserInteractionTrackerConfig>;
  private targetWindow: Window;
  private isTracking: boolean = false;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private iframeTrackers: Map<HTMLIFrameElement, UserInteractionTracker> = new Map();

  constructor(
    targetWindow: Window,
    nodeIdBiMap: NodeIdBiMap,
    eventHandler: UserInteractionEventHandler,
    config: UserInteractionTrackerConfig = {}
  ) {
    this.targetWindow = targetWindow;
    this.nodeIdBiMap = nodeIdBiMap;
    this.eventHandler = eventHandler;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start tracking user interactions
   */
  public start(): void {
    if (this.isTracking) return;
    
    this.isTracking = true;
    this.setupEventListeners();
    this.setupIframeTracking();
  }

  /**
   * Stop tracking user interactions
   */
  public stop(): void {
    if (!this.isTracking) return;
    
    this.isTracking = false;
    this.removeEventListeners();
    this.stopIframeTracking();
    this.clearDebounceTimers();
  }

  /**
   * Setup event listeners for the main document
   */
  private setupEventListeners(): void {
    const target = this.getTargetWindow();
    
    // Mouse events
    target.addEventListener('mousemove', this.handleMouseMove.bind(this), { passive: true });
    target.addEventListener('click', this.handleMouseClick.bind(this), { passive: true });
    
    // Keyboard events
    target.addEventListener('keydown', this.handleKeyPress.bind(this), { passive: true });
    
    // Window events
    target.addEventListener('resize', this.handleWindowResize.bind(this), { passive: true });
    target.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
    target.addEventListener('focus', this.handleWindowFocus.bind(this), { passive: true });
    target.addEventListener('blur', this.handleWindowBlur.bind(this), { passive: true });
    
    // Document events
    const document = this.getTargetDocument();
    document.addEventListener('focusin', this.handleElementFocus.bind(this), { passive: true });
    document.addEventListener('focusout', this.handleElementBlur.bind(this), { passive: true });
    document.addEventListener('selectionchange', this.handleTextSelection.bind(this), { passive: true });
    
    // Element scroll events (capture to catch all scroll events from any element)
    document.addEventListener('scroll', this.handleElementScroll.bind(this), { passive: true, capture: true });
  }

  /**
   * Remove event listeners
   */
  private removeEventListeners(): void {
    const target = this.getTargetWindow();
    const document = this.getTargetDocument();
    
    target.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    target.removeEventListener('click', this.handleMouseClick.bind(this));
    target.removeEventListener('keydown', this.handleKeyPress.bind(this));
    target.removeEventListener('resize', this.handleWindowResize.bind(this));
    target.removeEventListener('scroll', this.handleScroll.bind(this));
    target.removeEventListener('focus', this.handleWindowFocus.bind(this));
    target.removeEventListener('blur', this.handleWindowBlur.bind(this));
    
    document.removeEventListener('focusin', this.handleElementFocus.bind(this));
    document.removeEventListener('focusout', this.handleElementBlur.bind(this));
    document.removeEventListener('selectionchange', this.handleTextSelection.bind(this));
    document.removeEventListener('scroll', this.handleElementScroll.bind(this), { capture: true });
  }

  /**
   * Setup tracking for iframes
   */
  private setupIframeTracking(): void {
    const iframes = this.getTargetDocument().querySelectorAll('iframe');
    iframes.forEach(iframe => this.setupIframeTracker(iframe));
    
    // Watch for new iframes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof HTMLIFrameElement) {
            this.setupIframeTracker(node);
          }
        });
      });
    });
    
    observer.observe(this.getTargetDocument().body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Setup tracker for a specific iframe
   */
  private setupIframeTracker(iframe: HTMLIFrameElement): void {
    try {
      const iframeWindow = iframe.contentWindow;
      const iframeDocument = iframe.contentDocument;
      
      if (iframeWindow && iframeDocument) {
        // Create a new tracker for the iframe using the iframe's window context
        const iframeTracker = new UserInteractionTracker(
          iframeWindow,
          this.nodeIdBiMap,
          this.eventHandler,
          this.config
        );
        
        this.iframeTrackers.set(iframe, iframeTracker);
        iframeTracker.start();
      }
    } catch (error) {
      // Cross-origin iframe, can't access content
      console.warn('Cannot track cross-origin iframe:', error);
    }
  }

  /**
   * Stop iframe tracking
   */
  private stopIframeTracking(): void {
    this.iframeTrackers.forEach(tracker => tracker.stop());
    this.iframeTrackers.clear();
  }

  /**
   * Clear all debounce timers
   */
  private clearDebounceTimers(): void {
    this.debounceTimers.forEach(timerId => clearTimeout(timerId));
    this.debounceTimers.clear();
  }

  /**
   * Debounce helper function
   */
  private debounce(key: string, delay: number, callback: () => void): void {
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    const timerId = setTimeout(() => {
      callback();
      this.debounceTimers.delete(key);
    }, delay);
    
    this.debounceTimers.set(key, timerId);
  }

  /**
   * Get the target window (supports iframe contexts)
   */
  private getTargetWindow(): Window {
    return this.targetWindow;
  }

  /**
   * Get the target document (supports iframe contexts)
   */
  private getTargetDocument(): Document {
    return this.targetWindow.document;
  }

  /**
   * Get element ID from NodeIdBiMap
   */
  private getElementId(element: Element | null): number | null {
    if (!element) return null;
    return this.nodeIdBiMap.getNodeId(element);
  }

  // Event handlers
  private handleMouseMove = (event: MouseEvent): void => {
    this.debounce('mousemove', this.config.mouseMoveDebounceMs, () => {
      this.eventHandler.onMouseMove?.({
        x: event.pageX,
        y: event.pageY,
        timestamp: Date.now()
      });
    });
  };

  private handleMouseClick = (event: MouseEvent): void => {
    this.eventHandler.onMouseClick?.({
      x: event.pageX,
      y: event.pageY,
      timestamp: Date.now()
    });
  };

  private handleKeyPress = (event: KeyboardEvent): void => {
    this.eventHandler.onKeyPress?.({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      timestamp: Date.now()
    });
  };

  private handleWindowResize = (): void => {
    this.debounce('resize', this.config.resizeDebounceMs, () => {
      this.eventHandler.onWindowResize?.({
        width: this.targetWindow.innerWidth,
        height: this.targetWindow.innerHeight,
        timestamp: Date.now()
      });
    });
  };

  private handleScroll = (): void => {
    this.debounce('scroll', this.config.scrollDebounceMs, () => {
      this.eventHandler.onScroll?.({
        scrollX: this.targetWindow.scrollX,
        scrollY: this.targetWindow.scrollY,
        timestamp: Date.now()
      });
    });
  };

  private handleElementScroll = (event: Event): void => {
    if (event.target instanceof Document) {
      return;
    }

    this.debounce('elementScroll', this.config.scrollDebounceMs, () => {
      const targetElement = event.target as Element;
      const elementId = this.getElementId(targetElement);
      if (elementId !== null) {
        this.eventHandler.onElementScroll?.({
          elementId,
          scrollLeft: targetElement.scrollLeft,
          scrollTop: targetElement.scrollTop,
          timestamp: Date.now()
        });
      }
    });
  };

  private handleElementFocus = (event: FocusEvent): void => {
    const elementId = this.getElementId(event.target as Element);
    if (elementId !== null) {
      this.eventHandler.onElementFocus?.({
        elementId,
        timestamp: Date.now()
      });
    }
  };

  private handleElementBlur = (event: FocusEvent): void => {
    const elementId = this.getElementId(event.target as Element);
    if (elementId !== null) {
      this.eventHandler.onElementBlur?.({
        elementId,
        timestamp: Date.now()
      });
    }
  };

  private handleTextSelection = (): void => {
    this.debounce('selection', this.config.selectionDebounceMs, () => {
      const selection = this.targetWindow.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const startNodeId = this.getElementId(range.startContainer as Element);
        const endNodeId = this.getElementId(range.endContainer as Element);
        
        if (startNodeId !== null && endNodeId !== null) {
          this.eventHandler.onTextSelection?.({
            startNodeId,
            startOffset: range.startOffset,
            endNodeId,
            endOffset: range.endOffset,
            timestamp: Date.now()
          });
        }
      }
    });
  };

  private handleWindowFocus = (): void => {
    this.eventHandler.onWindowFocus?.({
      timestamp: Date.now()
    });
  };

  private handleWindowBlur = (): void => {
    this.eventHandler.onWindowBlur?.({
      timestamp: Date.now()
    });
  };
}