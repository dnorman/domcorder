import type { Frame } from "@domcorder/proto-ts";
import { Reader } from "@domcorder/proto-ts";
import { Deferred } from "../common/Deferred";
import { PagePlayer } from "./PagePlayer";

export class PagePlayerComponent {

  private player: PagePlayer | null;
  private readonly overlayElement: HTMLDivElement;
  private readonly typingSimulatorElement: HTMLDivElement;
  private readonly iframe: HTMLIFrameElement;

  private readonly frameQueue: Frame[] = [];
  private chunkController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private reader: Reader | null = null;

  private readonly readyPromise: Deferred<void>;

  constructor(container: HTMLElement) {
    this.readyPromise = new Deferred<void>();

    const shadow = container.attachShadow({ mode: 'closed' });

    this.overlayElement = container.ownerDocument.createElement("div");
    this.overlayElement.className = "iframe-overlay";
    this.typingSimulatorElement = container.ownerDocument.createElement("div");
    this.typingSimulatorElement.className = "typing-simulator-container";
    this.iframe = container.ownerDocument.createElement("iframe");
    this.iframe.className = "iframe";

    // Initialize iframe with proper DOCTYPE to ensure Standards Mode
    this.iframe.srcdoc = '<!DOCTYPE html><html><head></head><body></body></html>';

    shadow.appendChild(this.iframe);
    shadow.appendChild(this.overlayElement);
    shadow.appendChild(this.typingSimulatorElement);

    // Set up Reader for binary chunks
    const chunkStream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        console.log("ChunkStream controller started");
        this.chunkController = controller;
      },
      cancel: (reason) => {
        console.log("ChunkStream cancelled:", reason);
      }
    });

    console.log("Creating Reader...");
    const [reader, frameStream] = Reader.create(chunkStream, false); // false = no header expected
    this.reader = reader;
    console.log("Reader created, starting frame processing...");

    // Process frames from the reader
    void this.processFrameStream(frameStream);

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

      .typing-simulator-container .keyboard-simulator {
        bottom: 0;
        right: 0;
        scale: 0.7;
        transform-origin: bottom right;
      }
    `);

    shadow.adoptedStyleSheets = [sheet];

    this.player = null;

    // We have to wait for the iframe to load before we can create the player
    // because the player needs the iframe's contentDocument to be available
    // and the iframe's contentDocument is not available until the iframe has loaded.
    new Promise(res => this.iframe.addEventListener('load', res, { once: true })).then(() => {
      this.player = new PagePlayer(this.iframe, this.overlayElement, this.typingSimulatorElement);

      for (const frame of this.frameQueue) {
        this.player.handleFrame(frame);
      }

      this.frameQueue.length = 0;

      this.readyPromise.resolve();
    });
  }

  private async processFrameStream(frameStream: ReadableStream<Frame>): Promise<void> {
    console.log("processFrameStream started");
    const reader = frameStream.getReader();
    console.log("Got frameStream reader");

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log("Frame stream ended");
          break;
        }

        // Handle the decoded frame
        console.log("Received frame:", value);
        if (this.player) {
          this.player.handleFrame(value);
        } else {
          this.frameQueue.push(value);
        }
      }
    } catch (error) {
      console.error("Error processing frame stream:", error);
    } finally {
      reader.releaseLock();
    }
  }

  public handleChunk(chunk: Uint8Array): void {
    if (this.chunkController) {
      this.chunkController.enqueue(chunk);
    } else {
      console.log("ERROR: chunkController is null!");
    }
  }

  public ready(): Promise<void> {
    return this.readyPromise.promise();
  }
}