import type { Frame } from "@domcorder/proto-ts";
import { Deferred } from "../common/Deferred";
import { PagePlayer } from "./PagePlayer";

export class PagePlayerComponent {

  private player: PagePlayer | null;
  private readonly overlayElement: HTMLDivElement;
  private readonly typingSimulatorElement: HTMLDivElement;
  private readonly iframe: HTMLIFrameElement;
  private readonly container: HTMLElement;
  private readonly shadowRoot: ShadowRoot;

  private readonly frameQueue: Frame[] = [];
  
  
  private resizeObserver: ResizeObserver | null = null;
  private currentScale: number = 1;

  private readonly readyPromise: Deferred<void>;
  keyboardContainer: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.readyPromise = new Deferred<void>();
    this.container = container;

    const shadow = container.attachShadow({ mode: 'closed' });
    this.shadowRoot = shadow;

    this.overlayElement = container.ownerDocument.createElement("div");
    this.overlayElement.className = "iframe-overlay";
    this.typingSimulatorElement = container.ownerDocument.createElement("div");
    this.typingSimulatorElement.className = "typing-simulator-container";

    this.keyboardContainer = container.ownerDocument.createElement("div");
    this.keyboardContainer.className = "keyboard-container";

    this.iframe = container.ownerDocument.createElement("iframe");
    this.iframe.className = "iframe";

    // Initialize iframe with proper DOCTYPE to ensure Standards Mode
    this.iframe.srcdoc = '<!DOCTYPE html><html><head></head><body></body></html>';

    // Create container structure
    const playerContainer = container.ownerDocument.createElement("div");
    playerContainer.className = "player-container";

    const playerContent = container.ownerDocument.createElement("div");
    playerContent.className = "player-content";

    playerContent.appendChild(this.iframe);
    playerContent.appendChild(this.overlayElement);
    playerContent.appendChild(this.typingSimulatorElement);

    this.typingSimulatorElement.appendChild(this.keyboardContainer);

    playerContainer.appendChild(playerContent);
    shadow.appendChild(playerContainer);

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        max-height: 100%;
        overflow: hidden;
        background: #f0f0f0;
        box-sizing: border-box;
      }

      .player-container {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .player-content {
        position: relative;
        transform-origin: center center;
        transition: transform 0.2s ease-out;
      }

      iframe {
        border: none;
        box-sizing: border-box;
        display: block;
        background: white;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .iframe-overlay {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
        z-index: 1000;
        overflow: hidden;
      }

      .typing-simulator-container {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
        z-index: 2000;
        pointer-events: none;
        overflow: hidden;
        opacity: 0.7;
      }

      .typing-simulator-container .keyboard-container {
        position: absolute;
        bottom: 0;
        right: 0;
        scale: 0.7;
        transform-origin: bottom right;
      }
    `);

    shadow.adoptedStyleSheets = [sheet];

    this.player = null;

    // Set up resize observer for scaling
    this.resizeObserver = new ResizeObserver(() => {
      this.updateScale();
    });
    this.resizeObserver.observe(container);

    // We have to wait for the iframe to load before we can create the player
    // because the player needs the iframe's contentDocument to be available
    // and the iframe's contentDocument is not available until the iframe has loaded.
    new Promise(res => this.iframe.addEventListener('load', res, { once: true })).then(() => {
      this.player = new PagePlayer(this.iframe, this.overlayElement, this.keyboardContainer, this);

      for (const frame of this.frameQueue) {
        this.player.queueFrame(frame);
      }

      this.frameQueue.length = 0;

      this.readyPromise.resolve();

      // Initial scale update
      this.updateScale();
    });
  }

  public ready(): Promise<void> {
    return this.readyPromise.promise();
  }

  public handleFrame(frame: Frame): void {
    console.log('handleFrame', frame);
    if (!this.player) {
      this.frameQueue.push(frame);
    } else {
      this.player.queueFrame(frame);
    }
  }

  private updateScale(): void {
    if (!this.player) return;

    const containerRect = this.container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    console.debug(`Container rect: ${containerWidth}x${containerHeight}`);

    if (containerWidth === 0 || containerHeight === 0) {
      console.debug('Container has zero dimensions, skipping scale update');
      return;
    }

    // Get current iframe dimensions (set by the player based on viewport dimensions)
    const iframeWidth = this.iframe.offsetWidth || this.iframe.clientWidth;
    const iframeHeight = this.iframe.offsetHeight || this.iframe.clientHeight;

    console.debug(`Iframe dimensions: ${iframeWidth}x${iframeHeight}`);

    if (iframeWidth === 0 || iframeHeight === 0) {
      console.debug('Iframe has zero dimensions, skipping scale update');
      return;
    }

    // Calculate scale to fit iframe within container while maintaining aspect ratio
    const scaleX = containerWidth / iframeWidth;
    const scaleY = containerHeight / iframeHeight;
    const scale = Math.min(scaleX, scaleY); // Scale to fit available space

    console.debug(`Scale calculation: scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)}, final scale=${scale.toFixed(3)}`);

    this.currentScale = scale;

    // Apply scale to the player content
    const playerContent = this.shadowRoot.querySelector('.player-content') as HTMLElement;
    if (playerContent) {
      playerContent.style.transform = `scale(${scale})`;
      console.debug(`Applied transform: scale(${scale})`);
    } else {
      console.debug('Could not find .player-content element');
    }

    console.debug(`Scaled player: container=${containerWidth}x${containerHeight}, iframe=${iframeWidth}x${iframeHeight}, scale=${scale.toFixed(3)}`);
  }

  // Method to be called by PagePlayer when viewport dimensions change
  public onViewportChanged(): void {
    // Small delay to ensure iframe has been resized
    setTimeout(() => this.updateScale(), 10);
  }
}