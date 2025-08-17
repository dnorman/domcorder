import { NodeIdBiMap } from "./dom";
import { generateKeyFrame, inlineSubTree, type InlineStartedEvent, type KeyFrameStartedEvent } from "./inliner";
import type { Asset } from "./inliner/Asset";
import { DomChangeDetector, StyleSheetWatcher, type DomOperation, type StyleSheetWatcherEvent } from "./mutation";
import { 
  FrameType, 
  type AssetData, 
  type DomAttributeChangedData, 
  type DomAttributeRemovedData, 
  type DomNodeAddedData, 
  type DomNodeRemovedData, 
  type DomTextChangedData, 
  type Frame, 
  type KeyframeData,
  type TextOperationData
} from "./protocol";

export type FrameHandler = (frame: Frame) => void;

export class PageRecorder {
  private sourceDocument: Document;
  private frameHandler: FrameHandler;

  private pendingAssets: boolean;
  private operationQueue: DomOperation[];
  private changeDetector: DomChangeDetector | null;
  private styleSheetWatcher: StyleSheetWatcher | null;

  constructor(sourceDocument: Document, frameHandler: FrameHandler) {
    this.sourceDocument = sourceDocument;
    this.frameHandler = frameHandler;
    this.pendingAssets = false;
    this.operationQueue = [];
    this.changeDetector = null;
    this.styleSheetWatcher = null;
  }

  start() {
    const sourceDocNodeIdMap = new NodeIdBiMap();
    sourceDocNodeIdMap.assignNodeIdsToSubTree(this.sourceDocument);

    generateKeyFrame(
      this.sourceDocument, sourceDocNodeIdMap, {
      onKeyFrameStarted: (ev: KeyFrameStartedEvent) => {
        this.frameHandler({
          frameType: FrameType.Keyframe,
          data: {
            document: ev.document,
            assetCount: ev.assetCount,
          } as KeyframeData,
        });
        this.pendingAssets = ev.assetCount > 0;
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
      onKeyFrameComplete: () => {
        this.pendingAssets = false;
      },
    });
    
    this.changeDetector = new DomChangeDetector(this.sourceDocument, sourceDocNodeIdMap, (operations) => {
      for (const operation of operations) {
        if (this.pendingAssets) {
          this.operationQueue.push(operation);
        } else {
          this.processOperation(operation, sourceDocNodeIdMap, this.frameHandler);
        }
      }
    });

    this.styleSheetWatcher = new StyleSheetWatcher({
      patchCSSOM: true,
      handler: (event: StyleSheetWatcherEvent) => {
        console.log("style sheet watcher event", event);
      }
    });
  }

  private processOperation(
    operation: DomOperation, 
    nodeIdMap: NodeIdBiMap,
    frameHandler: FrameHandler
  ): void {
    switch (operation.op) {
      case "insert":
        inlineSubTree(operation.node, nodeIdMap, {
          onInlineStarted: (ev: InlineStartedEvent) => {
            this.pendingAssets = ev.assetCount > 0;
            frameHandler({
              frameType: FrameType.DomNodeAdded,
              data: {
                parentNodeId: operation.parentId,
                index: operation.index,
                node: ev.node,
                assetCount: ev.assetCount,
              } as DomNodeAddedData,
            });
          },
          onAsset: (asset: Asset) => {
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
          },
          onInlineComplete: () => {}
        });
       break;

      case "remove":
        frameHandler({
          frameType: FrameType.DomNodeRemoved,
          data: {
            nodeId: operation.nodeId
          } as DomNodeRemovedData,
        });
        break;

      case "updateAttribute":
        frameHandler({
          frameType: FrameType.DomAttributeChanged,
          data: {
            nodeId: operation.nodeId,
            attributeName: operation.name,
            attributeValue: operation.value
          } as DomAttributeChangedData,
        });
        break;

      case "removeAttribute":
        frameHandler({
          frameType: FrameType.DomAttributeRemoved,
          data: {
            nodeId: operation.nodeId,
            attributeName: operation.name,
          } as DomAttributeRemovedData,
        });
        break;

      case "updateText":
        const operations: TextOperationData[] = operation.ops.map(op => {
          switch (op.type) {
            case "insert":
              return {
                op: "insert",
                index: op.index,
                text: op.content
              };
            case "remove":
              return {
                op: "remove",
                index: op.index,
                length: op.count
              };
            }
        });
        
        frameHandler({
          frameType: FrameType.DomTextChanged,
          data: {
            nodeId: operation.nodeId,
            operations
          } as DomTextChangedData,
        });
        break;
    }
  }
}