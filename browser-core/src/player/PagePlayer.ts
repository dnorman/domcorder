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
  type KeyframeData,
  type AdoptedStyleSheetsChangedData,
  type NewAdoptedStyleSheetData,
  type WindowScrolledData,
  type MouseMovedData,
  type MouseClickedData,
  type TextSelectionChangedData,
  type ElementScrolledData
} from "../common/protocol";
import type { StringMutationOperation } from "../common/StringMutationOperation";
import type { VDocument, VNode, VStyleSheet } from "@domcorder/proto-ts";
import { StyleSheetWatcher, type StyleSheetWatcherEvent } from "../recorder/StyleSheetWatcher";
import { AdoptedStyleSheetMutator } from "./AdoptedStyleSheetMutator";
import { MouseSimulator } from "./MouseSimulator";
import { SelectionSimulator } from "./SelectionSimulator";


export type OpenFrame = {
  type: 'keyframe',
  document: VDocument,
  assetCount: number;
  receivedAssets: Set<number>;
} | {
  type: 'add-node',
  parentId: number,
  index: number,
  node: VNode,
  assetCount: number;
  receivedAssets: Set<number>;
} | {
  type: 'adopted-style-sheets-changed',
  stylesheets: number[],
  addedCount: number;
  receivedSheets: Set<VStyleSheet>;
} | {
  type: 'adopted-style-sheet-added',
  stylesheet: VStyleSheet,
  assetCount: number;
  receivedAssets: Set<number>;
}

export class PagePlayer {
  private readonly targetDocument: Document;
  private readonly materializer: DomMaterializer;
  private readonly assetManager: AssetManager;
  private readonly overlayElement: HTMLElement;
  private readonly mouseSimulator: MouseSimulator;
  private selectionSimulator: SelectionSimulator | null;
  
  private readonly openFrameStack: OpenFrame[];

  private mutator: DomMutator | null; 
  private readonly styleSheetWatcher: StyleSheetWatcher;
  private readonly adoptedStyleSheetMutator: AdoptedStyleSheetMutator;

  constructor(targetIframe: HTMLIFrameElement, overlayElement: HTMLElement) {
    this.targetDocument = targetIframe.contentDocument!;
    this.assetManager = new AssetManager(this.targetDocument);
    this.materializer = new DomMaterializer(this.targetDocument, this.assetManager);
    this.overlayElement = overlayElement;
    this.mouseSimulator = new MouseSimulator(overlayElement);
    this.openFrameStack = [];
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

    this.adoptedStyleSheetMutator = new AdoptedStyleSheetMutator(this.targetDocument, this.assetManager);
    this.selectionSimulator = null;
    this.mouseSimulator.start();

    this.targetDocument.defaultView!.addEventListener('scroll', () => {
      if (this.selectionSimulator) {
        this.selectionSimulator!.updateScrollPosition(this.targetDocument.defaultView!.scrollX, this.targetDocument.defaultView!.scrollY);
      }
    });
  }

  handleFrame(frame: Frame) {
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

      case FrameType.AdoptedStyleSheetsChanged:
        this._handleAdoptedStyleSheetsChangedFrame(frame.data as AdoptedStyleSheetsChangedData);
        break;

      case FrameType.AdoptedStyleSheetAdded:
        this._handleAdoptedStyleSheetAddedFrame(frame.data as NewAdoptedStyleSheetData);
        break;

      case FrameType.WindowScrolled:
        this._handleWindowScrolledFrame(frame.data as WindowScrolledData);
        break;

      case FrameType.ElementScrolled:
        this._handleElementScrolledFrame(frame.data as ElementScrolledData);
        break;

      case FrameType.MouseMoved:
        this._handleMouseMovedFrame(frame.data as MouseMovedData);
        break;

      case FrameType.MouseClicked:
        this._handleMouseClickedFrame(frame.data as MouseClickedData);
        break;

      case FrameType.TextSelectionChanged:
        this._handleTextSelectionChangedFrame(frame.data as TextSelectionChangedData);
        break;
    }
  }

  private _handleElementScrolledFrame(frame: ElementScrolledData) {
    this.mutator!.updateElementScrollPosition(frame.id, frame.scrollXOffset, frame.scrollYOffset);
    
    if (this.selectionSimulator) {
      this.selectionSimulator.updateElementScrollPosition(frame.id, frame.scrollXOffset, frame.scrollYOffset);
    }
  }

  private _handleWindowScrolledFrame(scrollFrame: WindowScrolledData) {
    this.targetDocument.defaultView!.scrollTo(scrollFrame.scrollXOffset, scrollFrame.scrollYOffset);
    if (this.selectionSimulator) {
      this.selectionSimulator.updateScrollPosition(scrollFrame.scrollXOffset, scrollFrame.scrollYOffset);
    }
  }

  private _handleAdoptedStyleSheetAddedFrame(frame: NewAdoptedStyleSheetData) {
    this.openFrameStack.push({
      type: 'adopted-style-sheet-added',
      stylesheet: frame.styleSheet,
      assetCount: frame.assetCount,
      receivedAssets: new Set(),
    });

    if (frame.assetCount === 0) {
      this._applyAdoptedStyleSheetAdded();
    }
  }

  private _handleAdoptedStyleSheetsChangedFrame(frame: AdoptedStyleSheetsChangedData) {
    this.openFrameStack.push({
      type: 'adopted-style-sheets-changed',
      stylesheets: frame.styleSheetIds,
      addedCount: frame.addedCount,
      receivedSheets: new Set(),
    });
    
    if (frame.addedCount === 0) {
      this._applyAdoptedStyleSheets();
    }
  }

  private _handleKeyFrame(keyframeData: KeyframeData) {
      const activeKeyFrame: OpenFrame = {
        type: 'keyframe',
        document: keyframeData.document,
        assetCount: keyframeData.assetCount,
        receivedAssets: new Set(),
      };

      this.openFrameStack.push(activeKeyFrame);

      if (keyframeData.assetCount === 0) {
        this._applyKeyFrame();
      }
  }

  private _handleNodeAddedFrame(domNodeAddedData: DomNodeAddedData) {
    const activeAddNode: OpenFrame = {
      type: 'add-node',
      parentId: domNodeAddedData.parentNodeId,
      index: domNodeAddedData.index,
      node: domNodeAddedData.node,
      assetCount: domNodeAddedData.assetCount,
      receivedAssets: new Set(),
    };
    this.openFrameStack.push(activeAddNode);

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

    const activeFrame = this.openFrameStack[this.openFrameStack.length - 1];

    if (activeFrame?.type === 'keyframe') {
      activeFrame.receivedAssets.add(frame.id);
      if (activeFrame.receivedAssets.size === activeFrame.assetCount) {
        this._applyKeyFrame();
      }
    } else if (activeFrame?.type === 'add-node') {
      activeFrame.receivedAssets.add(frame.id);
      if (activeFrame.receivedAssets.size === activeFrame.assetCount) {
        this._applyAddNode();
      }
    } else if (activeFrame?.type === 'adopted-style-sheet-added') {
      activeFrame.receivedAssets.add(frame.id);
      if (activeFrame.receivedAssets.size === activeFrame.assetCount) {
        this._applyAdoptedStyleSheetAdded();
      }
    } else {
      throw new Error("Expected keyframe, add-node, or added-style-sheet frame");
    }
  }

  private _applyAdoptedStyleSheetAdded() {
    const activeAddNode = this.openFrameStack.pop();
    if (activeAddNode?.type !== 'adopted-style-sheet-added') {
      throw new Error("Expected adopted-style-sheet-added frame");
    }

    const activeFrame = this.openFrameStack[this.openFrameStack.length - 1];
    if (activeFrame?.type !== 'adopted-style-sheets-changed') {
      throw new Error("Expected adopted-style-sheets frame");
    }

    activeFrame.receivedSheets.add(activeAddNode.stylesheet);
    if (activeFrame.receivedSheets.size === activeFrame.addedCount) {
      this._applyAdoptedStyleSheets();
    }
  }

  private _applyAdoptedStyleSheets() {
    const activeFrame = this.openFrameStack.pop();
    if (activeFrame?.type !== 'adopted-style-sheets-changed') {
      throw new Error("Expected adopted-style-sheets-changed frame");
    }

    const { stylesheets } = activeFrame;
    
    this.adoptedStyleSheetMutator.updateAdoptedStyleSheets(stylesheets, activeFrame.receivedSheets);
  }

  private _applyAddNode() {
    const activeAddNode = this.openFrameStack.pop();

    if (activeAddNode?.type !== 'add-node') {
      throw new Error("Expected add-node frame");
    }

    const { parentId, index, node } = activeAddNode;
    const materializedNode = this.materializer.materializeNode(node);

    this.mutator!.applyOps([{
      op: 'insert',
      node: materializedNode,
      index,
      parentId,
    }]);
  }

  private _applyKeyFrame() {
    const activeKeyFrame = this.openFrameStack.pop();
    if (activeKeyFrame?.type !== 'keyframe') {
      throw new Error("Expected keyframe frame");
    }

    const vdoc = activeKeyFrame.document;
    
    this.materializer.materializeDocument(vdoc);
    
    const targetDocNodeIdMap = new NodeIdBiMap();
    targetDocNodeIdMap.adoptNodesFromSubTree(this.targetDocument);

    this.mutator = new DomMutator(targetDocNodeIdMap);
    
    // Update the SelectionSimulator with the new NodeIdBiMap
    this.selectionSimulator = new SelectionSimulator(this.overlayElement, targetDocNodeIdMap, this.targetDocument);
  }

  /**
   * Clean up the AssetManager when the player is disposed
   */
  public dispose(): void {
    this.assetManager.dispose();
    this.mouseSimulator.stop();
  }

  private _handleMouseMovedFrame(mouseMovedData: MouseMovedData): void {
    this.mouseSimulator.moveTo(mouseMovedData.x, mouseMovedData.y);
  }

  private _handleMouseClickedFrame(mouseClickedData: MouseClickedData): void {
    this.mouseSimulator.click(mouseClickedData.x, mouseClickedData.y);
  }

  private _handleTextSelectionChangedFrame(textSelectionChangedData: TextSelectionChangedData): void {
    if (!this.selectionSimulator) {
      // SelectionSimulator is not available yet (no keyframe has been applied)
      return;
    }

    this.selectionSimulator.setSelection(
      textSelectionChangedData.selectionStartNodeId,
      textSelectionChangedData.selectionStartOffset,
      textSelectionChangedData.selectionEndNodeId,
      textSelectionChangedData.selectionEndOffset
    );
  }
}