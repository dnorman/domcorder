/**
 * MouseSimulator - Simulates mouse interactions during playback
 * 
 * This class is responsible for:
 * - Displaying a custom SVG arrow cursor that follows recorded mouse movements
 * - Providing smooth interpolation between mouse positions
 * - Rendering click animations with ripple effects
 * - Managing cursor visibility and positioning within the overlay element
 * 
 * Design Specifications:
 * 
 * Cursor Appearance:
 * - SVG arrow-style cursor (typical mouse pointer shape)
 * - Black fill with thin white outline
 * - Always visible during playback
 * - Rendered directly into the overlayElement
 * - Configurable size with hotspot offset (tip points to event coordinate)
 * - Scales with overlay element size
 * 
 * Coordinate System:
 * - Uses clientX/clientY coordinates (viewport-relative)
 * - Coordinates are relative to the overlayElement's coordinate system
 * - Overlay element represents the recorded client viewport
 * 
 * Movement Behavior:
 * - No movement trail/path visualization
 * - Linear interpolation between recorded mouse positions
 * - Configurable interpolation interval
 * - Interpolation skipped for very close positions
 * - No visual effects during movement
 * 
 * Click Animation:
 * - Dark gray click dot (relative to pointer size)
 * - Dark gray circular ripple effect (2 second duration, then fade out)
 * - One ripple/dot per click event (single for double-click)
 * - No actual DOM interaction (purely visual simulation)
 * - No click/drag animation support at this time
 * 
 * Event Handling:
 * - Focuses only on mouse events (mousemove, click)
 * - No keyboard interaction simulation
 * - No synchronization with DOM changes required
 * - No actual mouse event simulation in the DOM
 * 
 * API:
 * - Constructor takes configuration options
 * - Explicit start() method required
 * - moveTo(x, y) for cursor positioning
 * - click(x, y) for click animation
 * - stop() for cleanup
 */

export interface MouseSimulatorConfig {
  cursorSize?: number;
  interpolationIntervalMs?: number;
  minInterpolationDistance?: number;
  clickDotSize?: number;
  rippleDurationMs?: number;
}

const DEFAULT_CONFIG: Required<MouseSimulatorConfig> = {
  cursorSize: 24,
  interpolationIntervalMs: 16, // ~60fps
  minInterpolationDistance: 2,
  clickDotSize: 6,
  rippleDurationMs: 600 // Even faster expansion
};

export class MouseSimulator {
  private overlayElement: HTMLElement;
  private config: Required<MouseSimulatorConfig>;
  private isActive: boolean = false;
  
  // SVG elements
  private cursorSvg: SVGElement;
  private cursorGroup: SVGGElement;
  
  // Animation state
  private currentX: number = 0;
  private currentY: number = 0;
  private targetX: number = 0;
  private targetY: number = 0;
  private interpolationTimer: number | null = null;
  private ripples: SVGElement[] = [];

  constructor(overlayElement: HTMLElement, config: MouseSimulatorConfig = {}) {
    this.overlayElement = overlayElement;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Create SVG container
    this.cursorSvg = this.createSvgContainer();
    this.cursorGroup = this.createCursorGroup();
    this.cursorSvg.appendChild(this.cursorGroup);
    this.overlayElement.appendChild(this.cursorSvg);
    
    // Initialize cursor position
    this.updateCursorPosition(0, 0);
  }

  /**
   * Start the mouse simulator
   */
  public start(): void {
    this.isActive = true;
    this.cursorSvg.style.display = 'block';
  }

  /**
   * Stop the mouse simulator
   */
  public stop(): void {
    this.isActive = false;
    this.cursorSvg.style.display = 'none';
    this.clearInterpolation();
    this.clearRipples();
  }

  /**
   * Move cursor to a specific position with interpolation
   */
  public moveTo(x: number, y: number): void {
    console.log("moveTo", x, y);
    if (!this.isActive) return;
    
    this.targetX = x;
    this.targetY = y;
    
    // Skip interpolation if positions are very close
    const distance = Math.sqrt((x - this.currentX) ** 2 + (y - this.currentY) ** 2);
    if (distance <= this.config.minInterpolationDistance) {
      this.updateCursorPosition(x, y);
      return;
    }
    
    // Start interpolation
    this.startInterpolation();
  }

  /**
   * Simulate a click at the current cursor position
   */
  public click(x?: number, y?: number): void {
    if (!this.isActive) return;
    
    const clickX = x ?? this.currentX;
    const clickY = y ?? this.currentY;
    
    this.createClickAnimation(clickX, clickY);
  }

  private createSvgContainer(): SVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1001;
      display: none;
    `;
    return svg;
  }

  private createCursorGroup(): SVGGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute("viewBox", "-12 -12 140 140" );
    svg.setAttribute("width", "30");
    svg.setAttribute("height", "30");

    svg.innerHTML = ` 
  <!-- soft drop shadow for the white outline -->
  <defs>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="4" dy="4" stdDeviation="3" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- Cursor outline (white stroke), tip at (0,0) -->
  <!-- Path points form a typical mouse pointer with a notch for the tail -->
  <path id="cursor-shape"
        d="M 0 0
           L 0 95
           L 28 70
           L 42 108
           L 64 96
           L 48 64
           L 95 64
           Z"
        fill="black"
        stroke="white"
        stroke-width="7"
        stroke-linejoin="round"
        filter="url(#shadow)"/>

  <!-- Cursor fill (black) using the same geometry -->
  <use href="#cursor-shape" fill="black" stroke="none"/>`;

    return svg;
  }

  private updateCursorPosition(x: number, y: number): void {
    this.currentX = x;
    this.currentY = y;
    
    // Position the cursor directly at the coordinates with fixed size
    // The cursor SVG is already sized at 140x140, so just position it
    this.cursorGroup.setAttribute('transform', `translate(${x}, ${y})`);
  }

  private startInterpolation(): void {
    this.clearInterpolation();
    
    this.interpolationTimer = window.setInterval(() => {
      const dx = this.targetX - this.currentX;
      const dy = this.targetY - this.currentY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= this.config.minInterpolationDistance) {
        this.updateCursorPosition(this.targetX, this.targetY);
        this.clearInterpolation();
        return;
      }
      
      // Linear interpolation
      const step = this.config.interpolationIntervalMs / 16; // Adjust step size
      const newX = this.currentX + (dx * step);
      const newY = this.currentY + (dy * step);
      
      this.updateCursorPosition(newX, newY);
    }, this.config.interpolationIntervalMs);
  }

  private clearInterpolation(): void {
    if (this.interpolationTimer) {
      clearInterval(this.interpolationTimer);
      this.interpolationTimer = null;
    }
  }

  private createClickAnimation(x: number, y: number): void {
    // Create click dot
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', x.toString());
    dot.setAttribute('cy', y.toString());
    dot.setAttribute('r', (this.config.clickDotSize / 2).toString());
    dot.setAttribute('fill', '#666666');
    dot.setAttribute('opacity', '0.8');
    
    // Create ripple
    const ripple = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ripple.setAttribute('cx', x.toString());
    ripple.setAttribute('cy', y.toString());
    ripple.setAttribute('r', '0');
    ripple.setAttribute('fill', 'none');
    ripple.setAttribute('stroke', '#666666');
    ripple.setAttribute('stroke-width', '2');
    ripple.setAttribute('opacity', '0.6');
    
    this.cursorSvg.appendChild(dot);
    this.cursorSvg.appendChild(ripple);
    this.ripples.push(dot, ripple);
    
    // Animate ripple
    const startTime = Date.now();
    const totalDuration = this.config.rippleDurationMs + 200; // Expansion + fade time (shorter fade)
    const animateRipple = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / totalDuration;
      
      if (progress >= 1) {
        // Animation complete
        this.removeRipple(dot, ripple);
        return;
      }
      
      // Calculate expansion and fade phases
      const expansionProgress = Math.min(1, elapsed / this.config.rippleDurationMs);
      const fadeStartTime = this.config.rippleDurationMs * 0.7; // Start fade at 70% of expansion
      const fadeProgress = Math.max(0, (elapsed - fadeStartTime) / 200);
      
      // Always expand the ripple (even during fade)
      const maxRadius = 25; // Smaller fixed size for ripple
      const currentRadius = maxRadius * expansionProgress;
      ripple.setAttribute('r', currentRadius.toString());
      
      // Handle opacity (fade out as expansion finishes)
      if (fadeProgress > 0) {
        const opacity = 1 - fadeProgress;
        dot.setAttribute('opacity', (0.8 * opacity).toString());
        ripple.setAttribute('opacity', (0.6 * opacity).toString());
      }
      
      requestAnimationFrame(animateRipple);
    };
    
    requestAnimationFrame(animateRipple);
  }

  private removeRipple(dot: SVGElement, ripple: SVGElement): void {
    if (this.cursorSvg.contains(dot)) {
      this.cursorSvg.removeChild(dot);
    }
    if (this.cursorSvg.contains(ripple)) {
      this.cursorSvg.removeChild(ripple);
    }
    this.ripples = this.ripples.filter(r => r !== dot && r !== ripple);
  }

  private clearRipples(): void {
    this.ripples.forEach(ripple => {
      if (this.cursorSvg.contains(ripple)) {
        this.cursorSvg.removeChild(ripple);
      }
    });
    this.ripples = [];
  }
}