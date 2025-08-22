import type { Frame } from "../common";
import { PagePlayer } from "./PagePlayer";

export class PagePlayerComponent {
  private player: PagePlayer;
  overlayElement: HTMLDivElement;
  iframe: HTMLIFrameElement;

  constructor(container: HTMLElement) {

    const shadow = container.attachShadow({ mode: 'closed' });
    
    this.overlayElement = container.ownerDocument.createElement("div");
    this.overlayElement.className = "iframe-overlay";
    this.iframe = container.ownerDocument.createElement("iframe");
    this.iframe.className = "iframe";
    
    shadow.appendChild(this.overlayElement);
    shadow.appendChild(this.iframe);

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      iframe {
        width: 100%;
        height: 100%;
        border: none;
      }

      .iframe-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1000;
      }

      ::selection {
        background: #3399ff;   /* highlight background */
        color: white;          /* text color while selected */
      }
    `);

    shadow.adoptedStyleSheets = [sheet];
    
    this.player = new PagePlayer(this.iframe, this.overlayElement);
  }

  handleFrame(frame: Frame) {
    this.player.handleFrame(frame);
  }
}