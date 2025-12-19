import { DomMaterializer } from "./DomMaterializer";
import { NodeIdBiMap } from "../common";
import { DomMutator } from "./DomMutator";
import { AssetManager } from "./AssetManager";
import {
  Frame,
  Asset,
  AssetReference,
  PlaybackConfig,
  RecordingMetadata,
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
  DomNodePropertyTextChanged,
  CanvasChanged,
  StyleSheetRuleInserted,
  StyleSheetRuleDeleted,
  StyleSheetReplaced
} from "@domcorder/proto-ts";
import type { StringMutationOperation } from "../common/StringMutationOperation";
import { StyleSheetWatcher, type StyleSheetWatcherEvent } from "../recorder/StyleSheetWatcher";
import { AdoptedStyleSheetsMutator } from "./AdoptedStyleSheetMutator";
import { StyleSheetMutator } from "./StyleSheetMutator";
import { MouseSimulator } from "./MouseSimulator";
import { SelectionSimulator } from "./SelectionSimulator";
import { TypingSimulator } from "./TypingSimulator";
import { PlaybackQueue } from "./PlaybackQueue";
import { UrlResolver, createUrlResolver } from "./UrlResolver";


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
  private readonly adoptedStyleSheetMutator: AdoptedStyleSheetsMutator;
  private readonly styleSheetMutator: StyleSheetMutator;

  // Viewport dimensions
  private viewportWidth: number = 0;
  private viewportHeight: number = 0;
  private readonly targetIframe: HTMLIFrameElement;
  private readonly playerComponent?: any;

  private readonly playbackQueue: PlaybackQueue;
  private urlResolver: UrlResolver | null = null;

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

    this.adoptedStyleSheetMutator = new AdoptedStyleSheetsMutator(this.targetDocument, this.assetManager);
    this.styleSheetMutator = new StyleSheetMutator(this.targetDocument, this.assetManager);
    this.selectionSimulator = null;
    this.mouseSimulator.start();

    this.targetDocument.defaultView!.addEventListener('scroll', () => {
      if (this.selectionSimulator) {
        this.selectionSimulator!.updateScrollPosition(this.targetDocument.defaultView!.scrollX, this.targetDocument.defaultView!.scrollY);
      }
    });

    this.playbackQueue = new PlaybackQueue(live, async (frame: Frame, timestamp: number) => {
      await this.handleFrame(frame);
    });
  }

  public queueFrame(frame: Frame) {
    this.playbackQueue.enqueueFrame(frame);
  }

  private async handleFrame(frame: Frame): Promise<void> {
    try {
      if (frame instanceof PlaybackConfig) {
        await this._handlePlaybackConfigFrame(frame as PlaybackConfig);
      } else if (frame instanceof RecordingMetadata) {
        // RecordingMetadata is sent during recording for site identification
        // During playback, we can safely ignore it
        // No action needed
      } else if (frame instanceof Keyframe) {
        await this._handleKeyFrame(frame as Keyframe);
      } else if (frame instanceof Asset) {
        await this._handleAssetFrame(frame as Asset);
      } else if (frame instanceof AssetReference) {
        await this._handleAssetReferenceFrame(frame as AssetReference);
      } else if (frame instanceof Timestamp) {
      await this._handleTimestampFrame(frame);
    } else if (frame instanceof ViewportResized) {
      await this._handleViewportResizedFrame(frame);
    } else if (frame instanceof KeyPressed) {
      await this._handleKeyPressedFrame(frame);
    } else if (frame instanceof ElementFocused) {
      await this._handleElementFocusedFrame(frame);
    } else if (frame instanceof ElementBlurred) {
      await this._handleElementBlurredFrame(frame);
    } else if (frame instanceof WindowFocused) {
      await this._handleWindowFocusedFrame(frame);
    } else if (frame instanceof WindowBlurred) {
      await this._handleWindowBlurredFrame(frame);
    } else if (frame instanceof DomNodeResized) {
      await this._handleDomNodeResizedFrame(frame);
    } else if (frame instanceof DomTextChanged) {
      await this._handleTextChangedFrame(frame);
    } else if (frame instanceof DomNodeAdded) {
      await this._handleNodeAddedFrame(frame);
    } else if (frame instanceof DomNodeRemoved) {
      await this._handleNodeRemovedFrame(frame);
    } else if (frame instanceof DomAttributeChanged) {
      await this._handleAttributeChangedFrame(frame);
    } else if (frame instanceof DomAttributeRemoved) {
      await this._handleAttributeRemovedFrame(frame);
    } else if (frame instanceof DomNodePropertyChanged) {
      await this._handleNodePropertyChangedFrame(frame);
    } else if (frame instanceof DomNodePropertyTextChanged) {
      await this._handleNodePropertyTextChangedFrame(frame);
    } else if (frame instanceof AdoptedStyleSheetsChanged) {
      await this._handleAdoptedStyleSheetsChangedFrame(frame);
    } else if (frame instanceof StyleSheetRuleInserted) {
      await this._handleStyleSheetRuleInsertedFrame(frame);
    } else if (frame instanceof StyleSheetRuleDeleted) {
      await this._handleStyleSheetRuleDeletedFrame(frame);
    } else if (frame instanceof StyleSheetReplaced) {
      await this._handleStyleSheetReplacedFrame(frame);
    }
    else if (frame instanceof NewAdoptedStyleSheet) {
      await this._handleAdoptedStyleSheetAddedFrame(frame);
    } else if (frame instanceof ScrollOffsetChanged) {
      await this._handleWindowScrolledFrame(frame);
    } else if (frame instanceof ElementScrolled) {
      await this._handleElementScrolledFrame(frame);
    } else if (frame instanceof MouseMoved) {
      await this._handleMouseMovedFrame(frame);
    } else if (frame instanceof MouseClicked) {
      await this._handleMouseClickedFrame(frame);
    } else if (frame instanceof TextSelectionChanged) {
      await this._handleTextSelectionChangedFrame(frame);
    } else if (frame instanceof CanvasChanged) {
      await this._handleCanvasChangedFrame(frame);
    } else {
      console.warn('Unhandled frame type:', frame.constructor.name);
    }
    } catch (error) {
      console.error(`[PagePlayer] Error handling frame:`, error);
      throw error;
    }
  }
  
  private _handleCanvasChangedFrame(frame: CanvasChanged) {
    this.mutator?.updateCanvas(frame.nodeId, frame.mimeType, frame.data);
  }

  private _handleElementScrolledFrame(frame: ElementScrolled) {
    this.mutator!.updateElementScrollPosition(frame.node_id, frame.scrollXOffset, frame.scrollYOffset);
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

    this.mutator = new DomMutator(targetDocNodeIdMap, this.assetManager);

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
    this.mutator!.updateNodeProperty(frame.nodeId, frame.propertyName, frame.propertyValue);
  }

  private _handleNodePropertyTextChangedFrame(frame: DomNodePropertyTextChanged) {
    // Convert TextOperationData back to StringMutationOperation
    const stringOps: StringMutationOperation[] = frame.operations.map(op => {
      if (op.op === 'insert') {
        return {
          type: 'insert',
          index: op.index,
          content: op.text
        };
      } else {
        return {
          type: 'remove',
          index: op.index,
          count: op.length
        };
      }
    });

    this.mutator!.updateNodePropertyWithTextOperations(frame.nodeId, frame.propertyName, stringOps);
  }

  private _handleAssetFrame(frame: Asset) {
    // Add the asset to the AssetManager
    this.assetManager.receiveAsset(frame);
  }

  /**
   * Handle AssetReference frame by converting it to an Asset with HTTP URL
   * The server should have resolved the SHA-256 to random_id and provided an HTTP URL,
   * but if not, we'll construct one based on the server's asset endpoint.
   */
  /**
   * Handle PlaybackConfig frame to initialize URL resolver
   */
  private async _handlePlaybackConfigFrame(frame: PlaybackConfig): Promise<void> {
    try {
      this.urlResolver = createUrlResolver(frame.storage_type, frame.config_json);
      console.debug(`📦 PlaybackConfig: storage_type=${frame.storage_type}`);
    } catch (error) {
      console.error('Failed to create URL resolver:', error);
      throw error;
    }
  }

  /**
   * Handle AssetReference frame separately from Asset frames
   * Uses the URL resolver to convert the random_id to an HTTP URL.
   */
  private async _handleAssetReferenceFrame(frame: AssetReference): Promise<void> {
    if (!this.urlResolver) {
      throw new Error('URL resolver not initialized. PlaybackConfig frame must be received first.');
    }
    
    // Validate hash is not empty
    if (!frame.hash || frame.hash.length === 0) {
      console.warn(`⚠️ AssetReference ${frame.asset_id} has empty hash, skipping`);
      return;
    }
    
    try {
      // Resolve random_id to HTTP URL
      const httpUrl = this.urlResolver.resolveUrl(frame.hash);
      
      // Use the dedicated method for AssetReference (preserves original URL as sourceUrl)
      this.assetManager.receiveAssetReference(frame, httpUrl);
    } catch (error) {
      console.error(`❌ Failed to resolve AssetReference ${frame.asset_id}:`, error);
      // Don't throw - allow playback to continue with other assets
    }
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
  }

  private _handleKeyPressedFrame(frame: KeyPressed): void {
    this.typingSimulator.simulateKeyPress(frame);
  }

  private _updateIframeSize(): void {
    if (this.viewportWidth > 0 && this.viewportHeight > 0) {
      this.targetIframe.style.width = `${this.viewportWidth}px`;
      this.targetIframe.style.height = `${this.viewportHeight}px`;

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
    // TODO: Implement node resize handling if needed (might involve ResizeObserver simulation)
  }

  private async _handleStyleSheetRuleInsertedFrame(frame: StyleSheetRuleInserted): Promise<void> {
    // Check if the node exists before attempting to find the stylesheet
    const node = this.mutator?.getElementByNodeId(frame.styleSheetId);
    if (!node && frame.styleSheetId >= 0) {
      // Only log for non-negative IDs (negative IDs are used for temporary nodes)
      console.warn(
        `[PagePlayer] StyleSheetRuleInserted frame for stylesheet ID ${frame.styleSheetId}, ` +
        `but corresponding DOM node does not exist. This may indicate a missing DomNodeAdded frame.`
      );
    }
    await this.styleSheetMutator.insertRule(frame.styleSheetId, frame.ruleIndex, frame.content);
  }

  private async _handleStyleSheetRuleDeletedFrame(frame: StyleSheetRuleDeleted): Promise<void> {
    await this.styleSheetMutator.deleteRule(frame.styleSheetId, frame.ruleIndex);
  }

  private async _handleStyleSheetReplacedFrame(frame: StyleSheetReplaced): Promise<void> {
    await this.styleSheetMutator.replaceSheet(frame.styleSheetId, frame.content);
  }
}