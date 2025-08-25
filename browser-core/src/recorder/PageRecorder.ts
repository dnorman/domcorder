import { generateKeyFrame, inlineSubTree, type InlineStartedEvent, type KeyFrameStartedEvent } from "./inliner";
import type { Asset as InlinerAsset } from "./inliner/Asset";
import { DomChangeDetector } from "./DomChangeDetector";
import { UserInteractionTracker, type UserInteractionEventHandler } from "./UserInteractionTracker";
import {
  Frame,
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

export type FrameHandler = (frame: Frame) => Promise<void>;

export class PageRecorder {
  private sourceDocument: Document;

  private frameHandlers: FrameHandler[];

  private pendingAssets: boolean;
  private operationQueue: DomOperation[];
  private changeDetector: DomChangeDetector | null;
  private styleSheetWatcher: StyleSheetWatcher | null;
  private userInteractionTracker: UserInteractionTracker | null;
  private sourceDocNodeIdMap: NodeIdBiMap | null;

  constructor(sourceDocument: Document) {
    this.sourceDocument = sourceDocument;
    this.frameHandlers = [];

    this.pendingAssets = false;
    this.operationQueue = [];
    this.changeDetector = null;
    this.styleSheetWatcher = null;
    this.userInteractionTracker = null;
    this.sourceDocNodeIdMap = null;
  }

  public addFrameHandler(handler: FrameHandler) {
    this.frameHandlers.push(handler);
  }

  public removeFrameHandler(handler: FrameHandler) {
    this.frameHandlers = this.frameHandlers.filter(h => h !== handler);
  }

  private async emitFrame(frame: Frame) {
    for (const handler of this.frameHandlers) {
      try {
       await handler(frame);
      } catch (error) {
        console.error("Error handling frame:", error);
      }
    }
  }

  start() {
    this.sourceDocNodeIdMap = new NodeIdBiMap();
    this.sourceDocNodeIdMap.assignNodeIdsToSubTree(this.sourceDocument);

    // Setup user interaction tracking
    this.userInteractionTracker = new UserInteractionTracker(
      window,
      this.sourceDocNodeIdMap,
      this.createUserInteractionHandler()
    );
    this.userInteractionTracker.start();

    generateKeyFrame(
      this.sourceDocument, this.sourceDocNodeIdMap, this.createKeyFrameHandler()
    );

    this.changeDetector = new DomChangeDetector(this.sourceDocument, this.sourceDocNodeIdMap, async (operations) => {
      for (const operation of operations) {
        if (this.pendingAssets) {
          this.operationQueue.push(operation);
        } else {
          await this.processOperation(operation, this.sourceDocNodeIdMap!);
        }
      }
    }, 500);

    this.styleSheetWatcher = new StyleSheetWatcher({
      patchCSSOM: true,
      root: this.sourceDocument,
      handler: this.createStyleSheetHandler()
    });

    this.styleSheetWatcher.start();
  }

  public stop() {
    this.userInteractionTracker?.stop();
    this.changeDetector?.disconnect();
    this.styleSheetWatcher?.stop();
  }

  private async processOperation(
    operation: DomOperation,
    nodeIdMap: NodeIdBiMap
  ): Promise<void> {
    switch (operation.op) {
      case "insert":
        inlineSubTree(operation.node, nodeIdMap, {
          onInlineStarted: async (ev: InlineStartedEvent) => {
            this.pendingAssets = ev.assetCount > 0;
            const frame = new DomNodeAdded(operation.parentId, operation.index, ev.node, ev.assetCount);
            await this.emitFrame(frame);
          },
          onAsset: async (asset: InlinerAsset) => {
            const frame = new Asset(asset.id, asset.url, asset.mime, asset.buf);
            await this.emitFrame(frame);
          },
          onInlineComplete: () => {
            this.pendingAssetsComplete();
           }
        });
        break;

      case "remove":
        const removeFrame = new DomNodeRemoved(operation.nodeId);
        await this.emitFrame(removeFrame);
        break;

      case "updateAttribute":
        const updateAttrFrame = new DomAttributeChanged(operation.nodeId, operation.name, operation.value);
        await this.emitFrame(updateAttrFrame);
        break;

      case "removeAttribute":
        const removeAttrFrame = new DomAttributeRemoved(operation.nodeId, operation.name);
        await this.emitFrame(removeAttrFrame);
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

        const textFrame = new DomTextChanged(operation.nodeId, operations);
        await this.emitFrame(textFrame);
        break;
    }
  }

  pendingAssetsComplete() {
    this.pendingAssets = false;
    for (const operation of this.operationQueue) {
      this.processOperation(operation, this.sourceDocNodeIdMap!);
    }
    this.operationQueue = [];
  }


  private createUserInteractionHandler(): UserInteractionEventHandler {
    return {
      onMouseMove: (event) => {
        const frame = new MouseMoved(event.x, event.y);
        this.emitFrame(frame);
      },
      onMouseClick: (event) => {
        const frame = new MouseClicked(event.x, event.y);
        this.emitFrame(frame);
      },
      onKeyPress: (event) => {
        const frame = new KeyPressed(event.code, event.altKey, event.ctrlKey, event.metaKey, event.shiftKey);
        this.emitFrame(frame);
      },
      onWindowResize: (event) => {
        const frame = new ViewportResized(event.width, event.height);
        this.emitFrame(frame);
      },
      onScroll: (event) => {
        const frame = new ScrollOffsetChanged(event.scrollX, event.scrollY);
        this.emitFrame(frame);
      },
      onElementScroll: (event) => {
        const frame = new ElementScrolled(event.elementId, event.scrollLeft, event.scrollTop);
        this.emitFrame(frame);
      },
      onElementFocus: (event) => {
        const frame = new ElementFocused(event.elementId);
        this.emitFrame(frame);
      },
      onElementBlur: (event) => {
        const frame = new ElementBlurred(event.elementId);
        this.emitFrame(frame);
      },
      onTextSelection: (event) => {
        const frame = new TextSelectionChanged(event.startNodeId, event.startOffset, event.endNodeId, event.endOffset);
        this.emitFrame(frame);
      },
      onWindowFocus: (event) => {
        const frame = new WindowFocused();
        this.emitFrame(frame);
      },
      onWindowBlur: (event) => {
        const frame = new WindowBlurred();
        this.emitFrame(frame);
      }
    };
  }

  private createKeyFrameHandler() {
    return {
      onKeyFrameStarted: async (ev: KeyFrameStartedEvent) => {
        const keyframe = new Keyframe(ev.document, ev.assetCount, ev.viewportWidth, ev.viewportHeight);
        await this.emitFrame(keyframe);

        this.pendingAssets = ev.assetCount > 0;
      },
      onAsset: async (asset: InlinerAsset) => {
        const assetFrame = new Asset(asset.id, asset.url, asset.mime, asset.buf);
        await this.emitFrame(assetFrame);
      },
      onKeyFrameComplete: () => {
        this.pendingAssetsComplete();
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
        await this.emitFrame(frame);

        for (const sheet of event.added) {
          await inlineAdoptedStyleSheet(sheet, this.sourceDocument.baseURI, {
            onInlineStarted: (ev: InlineAdoptedStyleSheetEvent) => {
              this.pendingAssets = ev.assetCount > 0;
              const newStyleSheetFrame = new NewAdoptedStyleSheet(ev.styleSheet, ev.assetCount);
              this.emitFrame(newStyleSheetFrame);
            },
            onAsset: (asset: InlinerAsset) => {
              const assetFrame = new Asset(asset.id, asset.url, asset.mime, asset.buf);
              this.emitFrame(assetFrame);
            },
            onInlineComplete: () => { 
              this.pendingAssetsComplete();
            }
          });
        }
      }
    };
  }
}