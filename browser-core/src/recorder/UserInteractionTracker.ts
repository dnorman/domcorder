import { NodeIdBiMap } from '../common/NodeIdBiMap';
import { EventRateLimiter } from './EventRateLimiter';

/**
 * Event handler interface for user interaction events
 */
export interface UserInteractionEventHandler {
  onMouseMove?: (event: { x: number; y: number }) => void;
  onMouseClick?: (event: { x: number; y: number }) => void;
  onKeyPress?: (event: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void;
  onWindowResize?: (event: { width: number; height: number }) => void;
  onScroll?: (event: { scrollX: number; scrollY: number }) => void;
  onElementScroll?: (event: { elementId: number; scrollLeft: number; scrollTop: number }) => void;
  onElementFocus?: (event: { elementId: number }) => void;
  onElementBlur?: (event: { elementId: number }) => void;
  onTextSelection?: (event: { startNodeId: number; startOffset: number; endNodeId: number; endOffset: number }) => void;
  onWindowFocus?: (event: {}) => void;
  onWindowBlur?: (event: {}) => void;
}

/**
 * Configuration options for the UserInteractionTracker
 */
export interface UserInteractionTrackerConfig {
  mouseMoveRateLimitMs?: number;
  scrollRateLimitMs?: number;
  resizeRateLimitMs?: number;
  selectionRateLimitMs?: number;
  elementScrollRateLimitMs?: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<UserInteractionTrackerConfig> = {
  mouseMoveRateLimitMs: 100,  
  scrollRateLimitMs: 100,     
  resizeRateLimitMs: 250,    
  selectionRateLimitMs: 250, 
  elementScrollRateLimitMs: 100
};

export class UserInteractionTracker {
  private nodeIdBiMap: NodeIdBiMap;
  private eventHandler: UserInteractionEventHandler;
  private config: Required<UserInteractionTrackerConfig>;
  private targetWindow: Window;
  private isTracking: boolean = false;
  private rateLimiter: EventRateLimiter;
  private iframeTrackers: Map<HTMLIFrameElement, UserInteractionTracker> = new Map();
  
  // Mouse state tracking for click vs drag detection
  private mouseDownPosition: { x: number; y: number } | null = null;
  private mouseDownTime: number | null = null;
  private isDragging: boolean = false;
  private readonly DRAG_THRESHOLD = 5; // pixels
  private readonly CLICK_TIMEOUT = 300; // milliseconds

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
    this.rateLimiter = new EventRateLimiter();
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
    this.rateLimiter.clear();
  }

  /**
   * Setup event listeners for the main document
   */
  private setupEventListeners(): void {
    const target = this.getTargetWindow();
    
    // Mouse events
    target.addEventListener('mousemove', this.handleMouseMove.bind(this), { passive: true });
    target.addEventListener('mousedown', this.handleMouseDown.bind(this), { passive: true });
    target.addEventListener('mouseup', this.handleMouseUp.bind(this), { passive: true });
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
    target.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    target.removeEventListener('mouseup', this.handleMouseUp.bind(this));
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
    // Check if we're dragging
    if (this.mouseDownPosition && this.mouseDownTime) {
      const distance = Math.sqrt(
        Math.pow(event.clientX - this.mouseDownPosition.x, 2) +
        Math.pow(event.clientY - this.mouseDownPosition.y, 2)
      );
      
      if (distance > this.DRAG_THRESHOLD) {
        this.isDragging = true;
      }
    }

    this.rateLimiter.rateLimit('mousemove', this.config.mouseMoveRateLimitMs, {
      x: event.clientX,
      y: event.clientY
    }, (data) => {
      this.eventHandler.onMouseMove?.(data);
    });
  };

  private handleMouseDown = (event: MouseEvent): void => {
    this.mouseDownPosition = { x: event.clientX, y: event.clientY };
    this.mouseDownTime = Date.now();
    this.isDragging = false;
  };

  private handleMouseUp = (event: MouseEvent): void => {
    // Reset drag state after a short delay to allow click event to fire first
    setTimeout(() => {
      this.mouseDownPosition = null;
      this.mouseDownTime = null;
      this.isDragging = false;
    }, 50);
  };

  private handleMouseClick = (event: MouseEvent): void => {
    // Only emit click event if we're not dragging
    if (!this.isDragging) {
      this.eventHandler.onMouseClick?.({
        x: event.clientX,
        y: event.clientY
      });
    }
  };

  private handleKeyPress = (event: KeyboardEvent): void => {
    this.eventHandler.onKeyPress?.({
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey
    });
  };

  private handleWindowResize = (): void => {
    this.rateLimiter.rateLimit('resize', this.config.resizeRateLimitMs, {
      width: this.targetWindow.innerWidth,
      height: this.targetWindow.innerHeight
    }, (data) => {
      this.eventHandler.onWindowResize?.(data);
    });
  };

  private handleScroll = (): void => {
    this.rateLimiter.rateLimit('scroll', this.config.scrollRateLimitMs, {
      scrollX: this.targetWindow.scrollX,
      scrollY: this.targetWindow.scrollY
    }, (data) => {
      this.eventHandler.onScroll?.(data);
    });
  };

  private handleElementScroll = (event: Event): void => {
    if (event.target instanceof Document) {
      return;
    }

    this.rateLimiter.rateLimit('elementScroll', this.config.elementScrollRateLimitMs, {
      elementId: this.getElementId(event.target as Element) || -1, // Use -1 for no element
      scrollLeft: (event.target as Element).scrollLeft,
      scrollTop: (event.target as Element).scrollTop
    }, (data) => {
      this.eventHandler.onElementScroll?.(data);
    });
  };

  private handleElementFocus = (event: FocusEvent): void => {
    const elementId = this.getElementId(event.target as Element);
    if (elementId !== null) {
      this.eventHandler.onElementFocus?.({
        elementId
      });
    }
  };

  private handleElementBlur = (event: FocusEvent): void => {
    const elementId = this.getElementId(event.target as Element);
    if (elementId !== null) {
      this.eventHandler.onElementBlur?.({
        elementId
      });
    }
  };

  private handleTextSelection = (): void => {
    this.rateLimiter.rateLimit('selection', this.config.selectionRateLimitMs, {
      startNodeId: this.getElementId(this.targetWindow.getSelection()?.anchorNode as Element) || -1,
      startOffset: this.targetWindow.getSelection()?.anchorOffset || 0,
      endNodeId: this.getElementId(this.targetWindow.getSelection()?.focusNode as Element) || -1,
      endOffset: this.targetWindow.getSelection()?.focusOffset || 0
    }, (data) => {
      this.eventHandler.onTextSelection?.(data);
    });
  };

  private handleWindowFocus = (): void => {
    this.eventHandler.onWindowFocus?.({});
  };

  private handleWindowBlur = (): void => {
    this.eventHandler.onWindowBlur?.({});
  };
}