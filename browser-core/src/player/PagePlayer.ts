import { DomMaterializer } from "./DomMaterializer";
import { NodeIdBiMap } from "../common";
import { DomMutator } from "./DomMutator";
import { AssetManager } from "./AssetManager";
import { 
  FrameType,
  type AssetData,
  type DomAttributeChangedData,
  type DomAttributeRemovedData,
  type DomNodeAddedData,
  type DomNodeRemovedData,
  type DomTextChangedData,
  type Frame,
  type KeyframeData
} from "../common/protocol";
import type { StringMutationOperation } from "../common/StringMutationOperation";
import type { VDocument, VNode } from "@domcorder/proto-ts";
import { StyleSheetWatcher, type StyleSheetWatcherEvent } from "../recorder/StyleSheetWatcher";

export enum PagePlayerState {
  UNINITIALIZED,
  KEYFRAME_OPEN,
  ADD_NODE_OPEN,
  IDLE
}

export class PagePlayer {
  private targetDocument: Document;
  private materializer: DomMaterializer;
  private assetManager: AssetManager;
  private state: PagePlayerState;

  private activeKeyFrame: {
    document: VDocument,
    assetCount: number;
    receivedAssets: Set<number>;
  } | null;

  private activeAddNode: {
    parentId: number,
    index: number,
    node: VNode,
    assetCount: number;
    receivedAssets: Set<number>;
  } | null;

  private mutator: DomMutator | null; 
  styleSheetWatcher: StyleSheetWatcher;

  constructor(targetDocument: Document) {
    this.targetDocument = targetDocument;
    this.assetManager = new AssetManager(this.targetDocument);
    this.materializer = new DomMaterializer(this.targetDocument, this.assetManager);
    this.state = PagePlayerState.UNINITIALIZED;
    this.activeKeyFrame = null;
    this.activeAddNode = null;
    this.mutator = null;

    this.styleSheetWatcher = new StyleSheetWatcher({
      root: this.targetDocument,
      handler: (event: StyleSheetWatcherEvent) => {
        if (event.type === 'adopted-style-sheets') {
          event.removed.forEach(sheet => {
            this.assetManager.adoptedStyleSheetRemoved(sheet);
          });
        }
      }
    });
    this.styleSheetWatcher.start();
  }

  handleFrame(frame: Frame) {
    if (this.state === PagePlayerState.UNINITIALIZED && frame.frameType !== FrameType.Keyframe) {
      throw new Error("First frame must be a keyframe.");
    }

    switch (frame.frameType) {
      case FrameType.Keyframe:
        this._handleKeyFrame(frame.data as KeyframeData);
        break;

      case FrameType.Asset:
        this._handleAssetFrame(frame.data as AssetData);
        break;

      case FrameType.DomTextChanged:
        this._handleTextChangedFrame(frame.data as DomTextChangedData);
        break;

      case FrameType.DomNodeAdded:
        this._handleNodeAddedFrame(frame.data as DomNodeAddedData);
        break;

      case FrameType.DomNodeRemoved:
        this._handleNodeRemovedFrame(frame.data as DomNodeRemovedData);
        break;

      case FrameType.DomAttributeChanged:
        this._handleAttributeChangedFrame(frame.data as DomAttributeChangedData);
        break;

      case FrameType.DomAttributeRemoved:
        this._handleAttributeRemovedFrame(frame.data as DomAttributeRemovedData);
        break;

    }
  }

  private _handleKeyFrame(keyframeData: KeyframeData) {
      this.activeKeyFrame = {
        document: keyframeData.document,
        assetCount: keyframeData.assetCount,
        receivedAssets: new Set(),
      };
      this.state = PagePlayerState.KEYFRAME_OPEN;

      if (keyframeData.assetCount === 0) {
        this._applyKeyFrame();
      }
  }

  private _handleNodeAddedFrame(domNodeAddedData: DomNodeAddedData) {
    this.activeAddNode = {
      parentId: domNodeAddedData.parentNodeId,
      index: domNodeAddedData.index,
      node: domNodeAddedData.node,
      assetCount: domNodeAddedData.assetCount,
      receivedAssets: new Set(),
    };
    this.state = PagePlayerState.ADD_NODE_OPEN;

    if (domNodeAddedData.assetCount === 0) {
      this._applyAddNode();
    }
  }

  private _handleNodeRemovedFrame(domNodeRemovedData: DomNodeRemovedData) {
    this.mutator!.applyOps([{
      op: 'remove',
      nodeId: domNodeRemovedData.nodeId
    }]);
  }

  private _handleAttributeRemovedFrame(attributeRemovedData: DomAttributeRemovedData) {
    this.mutator!.applyOps([{
      op: 'removeAttribute',
      nodeId: attributeRemovedData.nodeId,
      name: attributeRemovedData.attributeName
    }]);
  }

  private _handleAttributeChangedFrame(attributeChangedData: DomAttributeChangedData) {
    this.mutator!.applyOps([{
      op: 'updateAttribute',
      nodeId: attributeChangedData.nodeId,
      name: attributeChangedData.attributeName,
      value: attributeChangedData.attributeValue
    }]);
  }

  private _handleTextChangedFrame(textChangedData: DomTextChangedData) {
    const ops: StringMutationOperation[] = textChangedData.operations.map(op => {
      switch (op.op) {
        case 'insert':
          return {
            type: 'insert',
            index: op.index,
            content: op.text
          };
        case 'remove':
          return {
            type: 'remove',
            index: op.index,
            count: op.length
          };
      }
    });

    this.mutator!.applyOps([{
      op: 'updateText',
      nodeId: textChangedData.nodeId,
      ops
    }]);
  }

  private _handleAssetFrame(frame: AssetData) {
    // Add the asset to the AssetManager
    this.assetManager.addAsset(frame);

    if (this.state === PagePlayerState.KEYFRAME_OPEN && this.activeKeyFrame) {
      this.activeKeyFrame.receivedAssets.add(frame.id);
      if (this.activeKeyFrame.receivedAssets.size === this.activeKeyFrame.assetCount) {
        this._applyKeyFrame();
      }
    } else if (this.state === PagePlayerState.ADD_NODE_OPEN && this.activeAddNode) {
      this.activeAddNode.receivedAssets.add(frame.id);
      if (this.activeAddNode.receivedAssets.size === this.activeAddNode.assetCount) {
        this._applyAddNode();
      }
    }
  }

  private _applyAddNode() {
    const { parentId, index, node } = this.activeAddNode!;
    const materializedNode = this.materializer.materializeNode(node);

    this.mutator!.applyOps([{
      op: 'insert',
      node: materializedNode,
      index,
      parentId,
    }]);
    
    this.state = PagePlayerState.IDLE;
    this.activeAddNode = null;
  }

  private _applyKeyFrame() {
    const vdoc = this.activeKeyFrame!.document;
    
    this.materializer.materializeDocument(vdoc);
    
    const targetDocNodeIdMap = new NodeIdBiMap();
    targetDocNodeIdMap.adoptNodesFromSubTree(this.targetDocument);

    this.mutator = new DomMutator(targetDocNodeIdMap); 
    this.state = PagePlayerState.IDLE;
    this.activeKeyFrame = null;
  }

  /**
   * Clean up the AssetManager when the player is disposed
   */
  public dispose(): void {
    this.assetManager.dispose();
  }
}