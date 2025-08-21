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

    `);

    shadow.adoptedStyleSheets = [sheet];
    
    this.player = new PagePlayer(this.iframe);
  }

  handleFrame(frame: Frame) {
    this.player.handleFrame(frame);
  }
}  


class HelloWorld extends HTMLElement {
  constructor() {
    super();
    // Attach a shadow DOM
    const shadow = this.attachShadow({ mode: 'open' });

    // Create some content
    const wrapper = document.createElement('div');
    wrapper.textContent = "Hello from a Web Component!";
    wrapper.style.padding = "10px";
    wrapper.style.background = "#f0f0f0";
    wrapper.style.border = "1px solid #ccc";

    // Attach it to the shadow DOM
    shadow.appendChild(wrapper);
  }
}