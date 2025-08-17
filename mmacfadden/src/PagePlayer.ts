import { DomMaterializer } from "./materializer";
import { NodeIdBiMap } from "./dom";
import { DomMutator } from "./mutation";
import { FrameType, type AssetData, type DocumentData, type Frame, type KeyframeData } from "./protocol";

export enum PagePlayerState {
  UNINITIALIZED,
  KEYFRAME_OPEN,
  INSERT_OPEN,
  IDLE
}

export class PagePlayer {
  private targetDocument: Document;
  private materializer: DomMaterializer;
  private state: PagePlayerState;

  private activeKeyFrame: {
    document: DocumentData,
    assets: AssetData[]
    assetCount: number;
  } | null;
  private mutator: DomMutator | null;


  constructor(targetDocument: Document) {
    this.targetDocument = targetDocument;
    this.materializer = new DomMaterializer(this.targetDocument);
    this.state = PagePlayerState.UNINITIALIZED;
    this.activeKeyFrame = null;
    this.mutator = null;
  }

  handleFrame(frame: Frame) {
    if (this.state === PagePlayerState.UNINITIALIZED && frame.frameType !== FrameType.Keyframe) {
      throw new Error("First frame must be a keyframe.");
    }

    switch (frame.frameType) {
      case FrameType.Keyframe:
        const keyframeData = frame.data as KeyframeData;
        this.activeKeyFrame = {
          document: keyframeData.document,
          assets: [],
          assetCount: keyframeData.assetCount,
        };
        this.state = PagePlayerState.KEYFRAME_OPEN;
      
        break;

      case FrameType.Asset:
        this._handleAssetFrame(frame.data as AssetData);
        break;
      }
  }

  private _handleAssetFrame(frame: AssetData) {
    if (this.state === PagePlayerState.KEYFRAME_OPEN && this.activeKeyFrame) {
      this.activeKeyFrame.assets.push(frame);
      if (this.activeKeyFrame.assets.length === this.activeKeyFrame.assetCount) {
        this._applyKeyFrame();
        this.state = PagePlayerState.IDLE;
      }
    }
  }

  private _applyKeyFrame() {
    const vdoc = this.activeKeyFrame!.document;
    const assets = this.activeKeyFrame!.assets;
    
    this.materializer.materialize(vdoc, assets);
    
    const targetDocNodeIdMap = new NodeIdBiMap();
    targetDocNodeIdMap.adoptNodesFromSubTree(this.targetDocument);

    this.mutator = new DomMutator(this.targetDocument.documentElement, targetDocNodeIdMap); 
  }
}