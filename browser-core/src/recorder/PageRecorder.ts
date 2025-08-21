import { generateKeyFrame, inlineSubTree, type InlineStartedEvent, type KeyFrameStartedEvent } from "./inliner";
import type { Asset } from "./inliner/Asset";
import { DomChangeDetector } from "./DomChangeDetector";
import {
  FrameType,
  type AdoptedStyleSheetAddedData,
  type AdoptedStyleSheetsChangedData,
  type AssetData,
  type DomAttributeChangedData,
  type DomAttributeRemovedData,
  type DomNodeAddedData,
  type DomNodeRemovedData,
  type DomTextChangedData,
  type Frame,
  type KeyframeData,
  type TextOperationData
} from "../common/protocol";
import {
  Writer,
  KeyframeDataEnc,
  AssetDataEnc,
  DomNodeAddedDataEnc,
  DomNodeRemovedDataEnc,
  DomAttributeChangedDataEnc,
  DomAttributeRemovedDataEnc,
  DomTextChangedDataEnc,
  type TextInsertOperationData,
  type TextRemoveOperationData
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
  private writer: Writer;
  private stream: ReadableStream<Uint8Array>;

  constructor(sourceDocument: Document, frameHandler: FrameHandler) {
    this.sourceDocument = sourceDocument;
    this.frameHandler = frameHandler;
    this.pendingAssets = false;
    this.operationQueue = [];
    this.changeDetector = null;
    this.styleSheetWatcher = null;

    // Create Writer and stream
    const [writer, stream] = Writer.create(16 * 1024); // 16KB chunks
    this.writer = writer;
    this.stream = stream;
  }

  start() {
    const sourceDocNodeIdMap = new NodeIdBiMap();
    sourceDocNodeIdMap.assignNodeIdsToSubTree(this.sourceDocument);

    // Start server stream
    this.startServerStream();

    generateKeyFrame(
      this.sourceDocument, sourceDocNodeIdMap, {
      onKeyFrameStarted: async (ev: KeyFrameStartedEvent) => {
        // Keep existing frameHandler call
        this.frameHandler({
          frameType: FrameType.Keyframe,
          data: {
            document: ev.document,
            assetCount: ev.assetCount,
          } as KeyframeData,
        });

        // Additionally encode to server stream
        await KeyframeDataEnc.encode(this.writer, ev.document);

        this.pendingAssets = ev.assetCount > 0;
      },
      onAsset: async (asset: Asset) => {
        // Keep existing frameHandler call
        this.frameHandler({
          frameType: FrameType.Asset,
          data: {
            id: asset.id,
            url: asset.url,
            assetType: asset.assetType,
            mime: asset.mime,
            buf: asset.buf
          } as AssetData,
        });

        // Additionally encode to server stream
        await AssetDataEnc.encode(this.writer, asset.id, asset.url, asset.assetType, asset.mime, asset.buf);
      },
      onKeyFrameComplete: () => {
        this.pendingAssets = false;
      },
    });

    this.changeDetector = new DomChangeDetector(this.sourceDocument, sourceDocNodeIdMap, async (operations) => {
      for (const operation of operations) {
        if (this.pendingAssets) {
          this.operationQueue.push(operation);
        } else {
          await this.processOperation(operation, sourceDocNodeIdMap, this.frameHandler);
        }
      }
    });

    this.styleSheetWatcher = new StyleSheetWatcher({
      patchCSSOM: true,
      root: this.sourceDocument,
      handler: async (event: StyleSheetWatcherEvent) => {
        if (event.type === 'adopted-style-sheets') {
          this.frameHandler({
            frameType: FrameType.AdoptedStyleSheetsChanged,
            data: {
              styleSheetIds: event.now.map(sheet => getStyleSheetId(sheet)),
              addedCount: event.added.length,
            } as AdoptedStyleSheetsChangedData
          });
          
          for (const sheet of event.added) {
            await inlineAdoptedStyleSheet(sheet, this.sourceDocument.baseURI, {
              onInlineStarted: (ev: InlineAdoptedStyleSheetEvent) => {
                this.frameHandler({
                  frameType: FrameType.AdoptedStyleSheetAdded,
                  data: {
                    styleSheet: ev.styleSheet,
                    assetCount: ev.assetCount,
                  } as AdoptedStyleSheetAddedData
                });
              },
              onAsset: (asset: Asset) => {
                this.frameHandler({
                  frameType: FrameType.Asset,
                  data: {
                    id: asset.id,
                    url: asset.url,
                    assetType: asset.assetType,
                    mime: asset.mime,
                    buf: asset.buf
                  } as AssetData,
                });
              },
              onInlineComplete: () => { }
            });
          }
        }
      }
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

            // Keep existing frameHandler call
            frameHandler({
              frameType: FrameType.DomNodeAdded,
              data: {
                parentNodeId: operation.parentId,
                index: operation.index,
                node: ev.node,
                assetCount: ev.assetCount,
              } as DomNodeAddedData,
            });

            // Additionally encode to server stream
            await DomNodeAddedDataEnc.encode(this.writer, operation.parentId, operation.index, ev.node);
          },
          onAsset: async (asset: Asset) => {
            // Keep existing frameHandler call
            frameHandler({
              frameType: FrameType.Asset,
              data: {
                id: asset.id,
                url: asset.url,
                assetType: asset.assetType,
                mime: asset.mime,
                buf: asset.buf
              } as AssetData,
            });

            // Additionally encode to server stream
            await AssetDataEnc.encode(this.writer, asset.id, asset.url, asset.assetType, asset.mime, asset.buf);
          },
          onInlineComplete: () => { }
        });
        break;

      case "remove":
        // Keep existing frameHandler call
        frameHandler({
          frameType: FrameType.DomNodeRemoved,
          data: {
            nodeId: operation.nodeId
          } as DomNodeRemovedData,
        });

        // Additionally encode to server stream
        await DomNodeRemovedDataEnc.encode(this.writer, operation.nodeId);
        break;

      case "updateAttribute":
        // Keep existing frameHandler call
        frameHandler({
          frameType: FrameType.DomAttributeChanged,
          data: {
            nodeId: operation.nodeId,
            attributeName: operation.name,
            attributeValue: operation.value
          } as DomAttributeChangedData,
        });

        // Additionally encode to server stream
        await DomAttributeChangedDataEnc.encode(this.writer, operation.nodeId, operation.name, operation.value);
        break;

      case "removeAttribute":
        // Keep existing frameHandler call
        frameHandler({
          frameType: FrameType.DomAttributeRemoved,
          data: {
            nodeId: operation.nodeId,
            attributeName: operation.name,
          } as DomAttributeRemovedData,
        });

        // Additionally encode to server stream
        await DomAttributeRemovedDataEnc.encode(this.writer, operation.nodeId, operation.name);
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

        // Keep existing frameHandler call
        frameHandler({
          frameType: FrameType.DomTextChanged,
          data: {
            nodeId: operation.nodeId,
            operations
          } as DomTextChangedData,
        });

        // Additionally encode to server stream - use the rich operations data
        await DomTextChangedDataEnc.encode(this.writer, operation.nodeId, operations);
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
      const reader = this.stream.getReader();
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
}