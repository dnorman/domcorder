import { DomMaterializer } from "./DomMaterializer";
import { NodeIdBiMap } from "../common";
import { DomMutator } from "./DomMutator";
import { AssetManager } from "./AssetManager";
import {
  Frame,
  Asset,
  DomAttributeChanged,
  DomAttributeRemoved,
  DomNodeAdded,
  DomNodeRemoved,
  DomTextChanged,
  DomNodeResized,
  Keyframe,
  AdoptedStyleSheetsChanged,
  NewAdoptedStyleSheet,
  ScrollOffsetChanged,
  MouseMoved,
  MouseClicked,
  TextSelectionChanged,
  ElementScrolled,
  Timestamp,
  ViewportResized,
  KeyPressed,
  ElementFocused,
  ElementBlurred,
  WindowFocused,
  WindowBlurred,
  DomNodePropertyChanged,
  CanvasChanged
} from "@domcorder/proto-ts";
import type { StringMutationOperation } from "../common/StringMutationOperation";
import { StyleSheetWatcher, type StyleSheetWatcherEvent } from "../recorder/StyleSheetWatcher";
import { AdoptedStyleSheetMutator } from "./AdoptedStyleSheetMutator";
import { MouseSimulator } from "./MouseSimulator";
import { SelectionSimulator } from "./SelectionSimulator";
import { TypingSimulator } from "./TypingSimulator";
import { PlaybackQueue, PlayEvent } from "./PlaybackQueue";


export class PagePlayer {
  private readonly targetDocument: Document;
  private readonly materializer: DomMaterializer;
  private readonly assetManager: AssetManager;
  private readonly overlayElement: HTMLElement;
  private readonly typingSimulatorElement: HTMLElement;
  private readonly mouseSimulator: MouseSimulator;
  private readonly typingSimulator: TypingSimulator;
  private selectionSimulator: SelectionSimulator | null;

  private mutator: DomMutator | null;
  private readonly styleSheetWatcher: StyleSheetWatcher;
  private readonly adoptedStyleSheetMutator: AdoptedStyleSheetMutator;

  // Viewport dimensions
  private viewportWidth: number = 0;
  private viewportHeight: number = 0;
  private readonly targetIframe: HTMLIFrameElement;
  private readonly playerComponent?: any;

  private readonly playbackQueue: PlaybackQueue;

  constructor(
    targetIframe: HTMLIFrameElement,
    overlayElement: HTMLElement,
    typingSimulatorElement: HTMLElement,
    live: boolean,
    playerComponent?: any) {
    this.targetIframe = targetIframe;
    this.targetDocument = targetIframe.contentDocument!;
    this.assetManager = new AssetManager(this.targetDocument);
    this.materializer = new DomMaterializer(this.targetDocument, this.assetManager);
    this.overlayElement = overlayElement;
    this.typingSimulatorElement = typingSimulatorElement;
    this.mouseSimulator = new MouseSimulator(overlayElement);
    this.typingSimulator = new TypingSimulator(typingSimulatorElement);
  
    this.mutator = null;
    this.playerComponent = playerComponent;

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

    this.playbackQueue = new PlaybackQueue(live, (event: PlayEvent) => {
      for (const frame of event.frames) {
        this.handleFrame(frame);
      }
    });
  }

  public queueFrame(frame: Frame) {
    this.playbackQueue.enqueueFrame(frame);
  }

  private handleFrame(frame: Frame) {
    if (frame instanceof Keyframe) {
      this._handleKeyFrame(frame as Keyframe);
    } else if (frame instanceof Asset) {
      this._handleAssetFrame(frame as Asset);
    } else if (frame instanceof Timestamp) {
      this._handleTimestampFrame(frame);
    } else if (frame instanceof ViewportResized) {
      this._handleViewportResizedFrame(frame);
    } else if (frame instanceof KeyPressed) {
      this._handleKeyPressedFrame(frame);
    } else if (frame instanceof ElementFocused) {
      this._handleElementFocusedFrame(frame);
    } else if (frame instanceof ElementBlurred) {
      this._handleElementBlurredFrame(frame);
    } else if (frame instanceof WindowFocused) {
      this._handleWindowFocusedFrame(frame);
    } else if (frame instanceof WindowBlurred) {
      this._handleWindowBlurredFrame(frame);
    } else if (frame instanceof DomNodeResized) {
      this._handleDomNodeResizedFrame(frame);
    } else if (frame instanceof DomTextChanged) {
      this._handleTextChangedFrame(frame);
    } else if (frame instanceof DomNodeAdded) {
      this._handleNodeAddedFrame(frame);
    } else if (frame instanceof DomNodeRemoved) {
      this._handleNodeRemovedFrame(frame);
    } else if (frame instanceof DomAttributeChanged) {
      this._handleAttributeChangedFrame(frame);
    } else if (frame instanceof DomAttributeRemoved) {
      this._handleAttributeRemovedFrame(frame);
    } else if (frame instanceof DomNodePropertyChanged) {
      this._handleNodePropertyChangedFrame(frame);
    } else if (frame instanceof AdoptedStyleSheetsChanged) {
      this._handleAdoptedStyleSheetsChangedFrame(frame);
    } else if (frame instanceof NewAdoptedStyleSheet) {
      this._handleAdoptedStyleSheetAddedFrame(frame);
    } else if (frame instanceof ScrollOffsetChanged) {
      this._handleWindowScrolledFrame(frame);
    } else if (frame instanceof ElementScrolled) {
      this._handleElementScrolledFrame(frame);
    } else if (frame instanceof MouseMoved) {
      this._handleMouseMovedFrame(frame);
    } else if (frame instanceof MouseClicked) {
      this._handleMouseClickedFrame(frame);
    } else if (frame instanceof TextSelectionChanged) {
      this._handleTextSelectionChangedFrame(frame);
    } else if (frame instanceof CanvasChanged) {
      this._handleCanvasChangedFrame(frame);
    } else {
      console.warn('Unhandled frame type:', frame.constructor.name);
    }
  }
  
  private _handleCanvasChangedFrame(frame: CanvasChanged) {
    this.mutator?.updateCanvas(frame.nodeId, frame.mimeType, frame.data);
  }

  private _handleElementScrolledFrame(frame: ElementScrolled) {
    this.mutator!.updateElementScrollPosition(frame.node_id, frame.scrollXOffset, frame.scrollYOffset);

    if (this.selectionSimulator) {
      this.selectionSimulator.updateElementScrollPosition(frame.node_id, frame.scrollXOffset, frame.scrollYOffset);
    }
  }

  private _handleWindowScrolledFrame(scrollFrame: ScrollOffsetChanged) {
    this.targetDocument.defaultView!.scrollTo(scrollFrame.scrollXOffset, scrollFrame.scrollYOffset);
    if (this.selectionSimulator) {
      this.selectionSimulator.updateScrollPosition(scrollFrame.scrollXOffset, scrollFrame.scrollYOffset);
    }
  }

  private _handleAdoptedStyleSheetAddedFrame(frame: NewAdoptedStyleSheet) {
    this.adoptedStyleSheetMutator.receiveAdoptedStyleSheet(frame.styleSheet);
  }

  private _handleAdoptedStyleSheetsChangedFrame(frame: AdoptedStyleSheetsChanged) {
    this.adoptedStyleSheetMutator.updateAdoptedStyleSheets(frame.styleSheetIds);
  }

  private _handleKeyFrame(keyframeData: Keyframe) {
    // Update viewport dimensions from keyframe
    this.viewportWidth = keyframeData.viewportWidth;
    this.viewportHeight = keyframeData.viewportHeight;
    this._updateIframeSize();

    this.materializer.materializeDocument(keyframeData.vDocument);

    const targetDocNodeIdMap = new NodeIdBiMap();
    targetDocNodeIdMap.adoptNodesFromSubTree(this.targetDocument);

    this.mutator = new DomMutator(targetDocNodeIdMap);

    // Update the SelectionSimulator with the new NodeIdBiMap
    this.selectionSimulator = new SelectionSimulator(this.overlayElement, targetDocNodeIdMap, this.targetDocument);
  }

  private _handleNodeAddedFrame(domNodeAddedData: DomNodeAdded) {
    const materializedNode = this.materializer.materializeNode(domNodeAddedData.vNode);

    this.mutator!.applyOps([{
      op: 'insert',
      node: materializedNode,
      index: domNodeAddedData.index,
      parentId: domNodeAddedData.parentNodeId,
    }]);
  }

  private _handleNodeRemovedFrame(domNodeRemovedData: DomNodeRemoved) {
    this.mutator!.applyOps([{
      op: 'remove',
      nodeId: domNodeRemovedData.nodeId
    }]);
  }

  private _handleAttributeRemovedFrame(attributeRemovedData: DomAttributeRemoved) {
    this.mutator!.applyOps([{
      op: 'removeAttribute',
      nodeId: attributeRemovedData.nodeId,
      name: attributeRemovedData.attributeName
    }]);
  }

  private _handleAttributeChangedFrame(attributeChangedData: DomAttributeChanged) {
    this.mutator!.applyOps([{
      op: 'updateAttribute',
      nodeId: attributeChangedData.nodeId,
      name: attributeChangedData.attributeName,
      value: attributeChangedData.attributeValue
    }]);
  }

  private _handleTextChangedFrame(textChangedData: DomTextChanged) {
    if (!this.mutator) {
      return;
    }

    const node = this.mutator.getNodeById(textChangedData.nodeId);
    if (!node) {
      console.error('Node not found with ID:', textChangedData.nodeId);
      return;
    }

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

    this.mutator.applyOps([{
      op: 'updateText',
      nodeId: textChangedData.nodeId,
      ops
    }]);
  }

  private _handleNodePropertyChangedFrame(frame: DomNodePropertyChanged) {
    this.mutator!.applyOps([{
      op: 'propertyChanged',
      nodeId: frame.nodeId,
      property: frame.propertyName,
      value: frame.propertyValue
    }]);
  }

  private _handleAssetFrame(frame: Asset) {
    // Add the asset to the AssetManager
    this.assetManager.receiveAsset(frame);
  } 

  /**
   * Clean up the AssetManager when the player is disposed
   */
  public dispose(): void {
    this.assetManager.dispose();
    this.mouseSimulator.stop();
  }

  private _handleMouseMovedFrame(mouseMovedData: MouseMoved): void {
    this.mouseSimulator.moveTo(mouseMovedData.x, mouseMovedData.y);
  }

  private _handleMouseClickedFrame(mouseClickedData: MouseClicked): void {
    this.mouseSimulator.click(mouseClickedData.x, mouseClickedData.y);
  }

  private _handleTextSelectionChangedFrame(textSelectionChangedData: TextSelectionChanged): void {
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

  private _handleTimestampFrame(frame: Timestamp): void {
    // NoOp
  }

  private _handleViewportResizedFrame(frame: ViewportResized): void {
    // Update viewport dimensions and resize iframe
    this.viewportWidth = frame.width;
    this.viewportHeight = frame.height;
    this._updateIframeSize();
    console.debug('Viewport resized:', frame.width, 'x', frame.height);
  }

  private _handleKeyPressedFrame(frame: KeyPressed): void {
    this.typingSimulator.simulateKeyPress(frame);
  }

  private _updateIframeSize(): void {
    if (this.viewportWidth > 0 && this.viewportHeight > 0) {
      this.targetIframe.style.width = `${this.viewportWidth}px`;
      this.targetIframe.style.height = `${this.viewportHeight}px`;

      console.debug('Updated iframe size to:', this.viewportWidth, 'x', this.viewportHeight);

      // Notify player component to update scaling
      if (this.playerComponent && this.playerComponent.onViewportChanged) {
        this.playerComponent.onViewportChanged();
      }
    }
  }

  private _handleElementFocusedFrame(frame: ElementFocused): void {
    // Focus the specified element
    const element = this.mutator?.getElementByNodeId(frame.node_id);
    if (element && element instanceof HTMLElement) {
      element.focus();
    }
  }

  private _handleElementBlurredFrame(frame: ElementBlurred): void {
    // Blur the specified element
    const element = this.mutator?.getElementByNodeId(frame.node_id);
    if (element && element instanceof HTMLElement) {
      element.blur();
    }
  }

  private _handleWindowFocusedFrame(frame: WindowFocused): void {
    // Focus the target window/document
    if (this.targetDocument.defaultView) {
      this.targetDocument.defaultView.focus();
    }
  }

  private _handleWindowBlurredFrame(frame: WindowBlurred): void {
    // Blur the target window/document
    if (this.targetDocument.defaultView) {
      this.targetDocument.defaultView.blur();
    }
  }

  private _handleDomNodeResizedFrame(frame: DomNodeResized): void {
    // Handle DOM node resize events
    console.debug('DOM node resized:', frame.nodeId, frame.width, 'x', frame.height);
    // TODO: Implement node resize handling if needed (might involve ResizeObserver simulation)
  }
}