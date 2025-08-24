import { generateKeyFrame, inlineSubTree, type InlineStartedEvent, type KeyFrameStartedEvent } from "./inliner";
import type { Asset as InlinerAsset } from "./inliner/Asset";
import { DomChangeDetector } from "./DomChangeDetector";
import { UserInteractionTracker, type UserInteractionEventHandler } from "./UserInteractionTracker";
import {
  FrameType,
  Frame,
  Writer,
  Keyframe,
  Asset,
  DomNodeAdded,
  DomNodeRemoved,
  DomAttributeChanged,
  DomAttributeRemoved,
  DomTextChanged,
  NewAdoptedStyleSheet,
  AdoptedStyleSheetsChanged,
  MouseMoved,
  MouseClicked,
  KeyPressed,
  ViewportResized,
  ScrollOffsetChanged,
  ElementScrolled,
  ElementFocused,
  ElementBlurred,
  TextSelectionChanged,
  WindowFocused,
  WindowBlurred,
  type TextInsertOperationData,
  type TextRemoveOperationData,
  type TextOperationData
} from "@domcorder/proto-ts";
import { NodeIdBiMap } from "../common";
import type { DomOperation } from "../common/DomOperation";
import { getStyleSheetId, StyleSheetWatcher, type StyleSheetWatcherEvent } from "./StyleSheetWatcher";
import { inlineAdoptedStyleSheet, type InlineAdoptedStyleSheetEvent } from "./inliner/inlineAdoptedStyleSheet";

// This 100% no matter how far we refactor this.. should
// def be the real binary frame.
export type FrameHandler = (frame: Frame) => void;

export class PageRecorder {
  private sourceDocument: Document;
  private frameHandler: FrameHandler;

  private pendingAssets: boolean;
  private operationQueue: DomOperation[];
  private changeDetector: DomChangeDetector | null;
  private styleSheetWatcher: StyleSheetWatcher | null;
  private userInteractionTracker: UserInteractionTracker | null;
  private writer: Writer;
  private stream: ReadableStream<Uint8Array>;
  private serverStream: ReadableStream<Uint8Array>;
  private parentStream: ReadableStream<Uint8Array>;

  constructor(sourceDocument: Document, frameHandler: FrameHandler) {
    this.sourceDocument = sourceDocument;
    this.frameHandler = (frame: Frame) => {
      frameHandler(frame);
    };
    this.pendingAssets = false;
    this.operationQueue = [];
    this.changeDetector = null;
    this.styleSheetWatcher = null;
    this.userInteractionTracker = null;

    // Create Writer and stream
    const [writer, stream] = Writer.create(512 * 1024); // 256KB chunks
    this.writer = writer;
    this.stream = stream;

    // Tee the stream for server and parent
    const [serverStream, parentStream] = stream.tee();
    this.serverStream = serverStream;
    this.parentStream = parentStream;
  }

  getParentStream(): ReadableStream<Uint8Array> {
    return this.parentStream;
  }

  start() {
    const sourceDocNodeIdMap = new NodeIdBiMap();
    sourceDocNodeIdMap.assignNodeIdsToSubTree(this.sourceDocument);

    // Start server stream
    this.startServerStream();

    // Setup user interaction tracking
    this.userInteractionTracker = new UserInteractionTracker(
      window,
      sourceDocNodeIdMap,
      this.createUserInteractionHandler()
    );
    this.userInteractionTracker.start();

    generateKeyFrame(
      this.sourceDocument, sourceDocNodeIdMap, this.createKeyFrameHandler()
    );

    this.changeDetector = new DomChangeDetector(this.sourceDocument, sourceDocNodeIdMap, async (operations) => {
      for (const operation of operations) {
        if (this.pendingAssets) {
          this.operationQueue.push(operation);
        } else {
          await this.processOperation(operation, sourceDocNodeIdMap, this.frameHandler);
        }
      }
    }, 1000);

    this.styleSheetWatcher = new StyleSheetWatcher({
      patchCSSOM: true,
      root: this.sourceDocument,
      handler: this.createStyleSheetHandler()
    });

    this.styleSheetWatcher.start();
  }

  private async processOperation(
    operation: DomOperation,
    nodeIdMap: NodeIdBiMap,
    frameHandler: FrameHandler
  ): Promise<void> {
    switch (operation.op) {
      case "insert":
        inlineSubTree(operation.node, nodeIdMap, {
          onInlineStarted: async (ev: InlineStartedEvent) => {
            this.pendingAssets = ev.assetCount > 0;

            // Create frame instance and call frameHandler
            const frame = new DomNodeAdded(operation.parentId, operation.index, ev.node, ev.assetCount);
            frameHandler(frame);

            // Additionally encode to server stream
            await frame.encode(this.writer);
          },
          onAsset: async (asset: InlinerAsset) => {
            // Create frame instance and call frameHandler
            const frame = new Asset(asset.id, asset.url, asset.mime, asset.buf);
            frameHandler(frame);

            // Additionally encode to server stream
            await frame.encode(this.writer);
          },
          onInlineComplete: () => { }
        });
        break;

      case "remove":
        // Create frame instance and call frameHandler
        const removeFrame = new DomNodeRemoved(operation.nodeId);
        frameHandler(removeFrame);

        // Additionally encode to server stream
        await removeFrame.encode(this.writer);
        break;

      case "updateAttribute":
        // Create frame instance and call frameHandler
        const updateAttrFrame = new DomAttributeChanged(operation.nodeId, operation.name, operation.value);
        frameHandler(updateAttrFrame);

        // Additionally encode to server stream
        await updateAttrFrame.encode(this.writer);
        break;

      case "removeAttribute":
        // Create frame instance and call frameHandler
        const removeAttrFrame = new DomAttributeRemoved(operation.nodeId, operation.name);
        frameHandler(removeAttrFrame);

        // Additionally encode to server stream
        await removeAttrFrame.encode(this.writer);
        break;

      case "updateText":
        const operations: TextOperationData[] = operation.ops.map(op => {
          switch (op.type) {
            case "insert":
              return {
                op: "insert",
                index: op.index,
                text: op.content
              } as TextInsertOperationData;
            case "remove":
              return {
                op: "remove",
                index: op.index,
                length: op.count
              } as TextRemoveOperationData;
            default:
              throw new Error(`Unknown operation type: ${(op as any).type}`);
          }
        });

        // Create frame instance and call frameHandler
        const textFrame = new DomTextChanged(operation.nodeId, operations);
        frameHandler(textFrame);

        // Additionally encode to server stream
        await textFrame.encode(this.writer);
        break;
    }
  }

  private async startServerStream(): Promise<void> {
    // Use WebSocket for streaming instead of fetch
    console.log('🔌 Connecting to WebSocket server...');
    try {
      const ws = new WebSocket('ws://localhost:8723/ws/record');

      ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        this.streamToWebSocket(ws);
      };

      ws.onmessage = (event) => {
        console.log('📨 Server message:', event.data);
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket closed');
      };

    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
    }
  }

  private async streamToWebSocket(ws: WebSocket): Promise<void> {
    try {
      const reader = this.serverStream.getReader();
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('📡 Stream finished, closing WebSocket');
          ws.close();
          break;
        }

        if (value) {
          ws.send(value);
        }
      }

    } catch (error) {
      console.error('Error streaming to WebSocket:', error);
    }
  }

  private createUserInteractionHandler(): UserInteractionEventHandler {
    return {
      onMouseMove: (event) => {
        const frame = new MouseMoved(event.x, event.y);
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onMouseClick: (event) => {
        const frame = new MouseClicked(event.x, event.y);
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onKeyPress: (event) => {
        const frame = new KeyPressed(event.code, event.altKey, event.ctrlKey, event.metaKey, event.shiftKey);
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onWindowResize: (event) => {
        const frame = new ViewportResized(event.width, event.height);
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onScroll: (event) => {
        const frame = new ScrollOffsetChanged(event.scrollX, event.scrollY);
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onElementScroll: (event) => {
        const frame = new ElementScrolled(event.elementId, event.scrollLeft, event.scrollTop);
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onElementFocus: (event) => {
        const frame = new ElementFocused(event.elementId);
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onElementBlur: (event) => {
        const frame = new ElementBlurred(event.elementId);
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onTextSelection: (event) => {
        const frame = new TextSelectionChanged(event.startNodeId, event.startOffset, event.endNodeId, event.endOffset);
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onWindowFocus: (event) => {
        const frame = new WindowFocused();
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      },
      onWindowBlur: (event) => {
        const frame = new WindowBlurred();
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode
      }
    };
  }

  private createKeyFrameHandler() {
    return {
      onKeyFrameStarted: async (ev: KeyFrameStartedEvent) => {
        // Create frame instance and call frameHandler
        const keyframe = new Keyframe(ev.document, ev.assetCount);
        console.log("PageRecorder: Creating keyframe", keyframe);
        this.frameHandler(keyframe);

        // Additionally encode to server stream
        await keyframe.encode(this.writer);

        this.pendingAssets = ev.assetCount > 0;
      },
      onAsset: async (asset: InlinerAsset) => {
        // Create frame instance and call frameHandler
        const assetFrame = new Asset(asset.id, asset.url, asset.mime, asset.buf);
        this.frameHandler(assetFrame);

        // Additionally encode to server stream
        await assetFrame.encode(this.writer);
      },
      onKeyFrameComplete: () => {
        this.pendingAssets = false;
      },
    };
  }

  private createStyleSheetHandler() {
    return async (event: StyleSheetWatcherEvent) => {
      if (event.type === 'adopted-style-sheets') {
        const frame = new AdoptedStyleSheetsChanged(
          event.now.map(sheet => getStyleSheetId(sheet)),
          event.added.length
        );
        this.frameHandler(frame);
        frame.encode(this.writer); // Background encode

        for (const sheet of event.added) {
          await inlineAdoptedStyleSheet(sheet, this.sourceDocument.baseURI, {
            onInlineStarted: (ev: InlineAdoptedStyleSheetEvent) => {
              const newStyleSheetFrame = new NewAdoptedStyleSheet(ev.styleSheet, ev.assetCount);
              this.frameHandler(newStyleSheetFrame);
              newStyleSheetFrame.encode(this.writer); // Background encode
            },
            onAsset: (asset: InlinerAsset) => {
              const assetFrame = new Asset(asset.id, asset.url, asset.mime, asset.buf);
              this.frameHandler(assetFrame);
              assetFrame.encode(this.writer); // Background encode
            },
            onInlineComplete: () => { }
          });
        }
      }
    };
  }
}