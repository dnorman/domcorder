import type { Frame } from "../common";
import { Deferred } from "../common/Deferred";
import { PagePlayer } from "./PagePlayer";

export class PagePlayerComponent {

  private player: PagePlayer | null;
  private readonly overlayElement: HTMLDivElement;
  private readonly iframe: HTMLIFrameElement;

  private readonly frameQueue: Frame[] = [];

  private readonly readyPromise: Deferred<void>;

  constructor(container: HTMLElement) {
    this.readyPromise = new Deferred<void>();
    
    const shadow = container.attachShadow({ mode: 'closed' });
    
    this.overlayElement = container.ownerDocument.createElement("div");
    this.overlayElement.className = "iframe-overlay";
    this.iframe = container.ownerDocument.createElement("iframe");
    this.iframe.className = "iframe";
    
    shadow.appendChild(this.iframe);
    shadow.appendChild(this.overlayElement);

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      iframe {
        width: 100%;
        flex: 1;
        border: none;
        box-sizing: border-box;
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
    `);

    shadow.adoptedStyleSheets = [sheet];
    
    this.player = null;

    // We have to wait for the iframe to load before we can create the player
    // because the player needs the iframe's contentDocument to be available
    // and the iframe's contentDocument is not available until the iframe has loaded.
    new Promise(res => this.iframe.addEventListener('load', res, { once: true })).then(() => {
      this.player = new PagePlayer(this.iframe, this.overlayElement);

      for (const frame of this.frameQueue) {
        this.player.handleFrame(frame);
      }

      this.frameQueue.length = 0;

      this.readyPromise.resolve();
    });
  }

  public handleFrame(frame: Frame): void {
    if (this.player) {
      this.player.handleFrame(frame);
    } else {
      this.frameQueue.push(frame);
    }
  }

  public ready(): Promise<void> {
    return this.readyPromise.promise();
  }
}