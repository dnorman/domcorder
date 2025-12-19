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
  type TextOperationData,
  Timestamp,
  DomNodePropertyChanged,
  DomNodePropertyTextChanged,
  CanvasChanged,
  StyleSheetRuleDeleted,
  StyleSheetRuleInserted,
  StyleSheetReplaced
} from "@domcorder/proto-ts";
import { NodeIdBiMap } from "../common";
import type { DomOperation } from "../common/DomOperation";
import { getAdoptedStyleSheetId } from "../common/StyleSheetIdUtils";
import { StyleSheetWatcher, type StyleSheetWatcherEvent } from "./StyleSheetWatcher";
import { inlineAdoptedStyleSheet, type InlineAdoptedStyleSheetEvent } from "./inliner/inlineAdoptedStyleSheet";
import { AssetTracker } from "./inliner/AssetTracker";
import { CanvasChangedCallback, CanvasChangedEvent, CanvasTracker } from "./CanvasTracker";
import { FormFieldTracker } from "./FormFieldTracker";

export type FrameHandler = (frame: Frame) => Promise<void>;

export class PageRecorder {
  private sourceDocument: Document;

  private frameHandlers: FrameHandler[];

  private changeDetector: DomChangeDetector | null;
  private styleSheetWatcher: StyleSheetWatcher | null;
  private canvasTracker: CanvasTracker | null;
  private formFieldTracker: FormFieldTracker | null;
  private userInteractionTracker: UserInteractionTracker | null;
  private sourceDocNodeIdMap: NodeIdBiMap | null;
  private recordingEpoch: number;
  private readonly assetTracker: AssetTracker;
  
  constructor(sourceDocument: Document) {
    this.sourceDocument = sourceDocument;
    this.frameHandlers = [];

    this.changeDetector = null;
    this.styleSheetWatcher = null;
    this.userInteractionTracker = null;
    this.sourceDocNodeIdMap = null;
    this.canvasTracker = null;
    this.formFieldTracker = null;
    this.recordingEpoch = Date.now();
    this.assetTracker = new AssetTracker();
  }

  public addFrameHandler(handler: FrameHandler) {
    this.frameHandlers.push(handler);
  }

  public removeFrameHandler(handler: FrameHandler) {
    this.frameHandlers = this.frameHandlers.filter(h => h !== handler);
  }

  public getInitialUrl(): string {
    return this.sourceDocument.location.href;
  }

  private async emitFrame(frame: Frame, timestamp: boolean = true) {
    if (timestamp) {
      this.emitTimestampFrame();
    }

    for (const handler of this.frameHandlers) {
      try {
        await handler(frame);
      } catch (error) {
        console.error("Error handling frame:", error);
      }
    }
  }

  start() {
    this.recordingEpoch = Date.now();
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
      this.sourceDocument,
      this.sourceDocNodeIdMap, 
      this.createKeyFrameHandler(),
      this.assetTracker
    );

    this.changeDetector = new DomChangeDetector(
      this.sourceDocument,
      this.sourceDocNodeIdMap,
      async (operations) => {
        if (operations.length > 0) {
          // Collect all nodes from insert operations before processing
          // These are nodes that have been assigned IDs by DomChangeDetector but haven't been emitted yet
          // NOTE: This could be optimized by collecting nodes during operation creation in DomChangeDetector
          const pendingNewNodes = this.collectNodesFromInsertOperations(operations, this.sourceDocNodeIdMap!);
          if (pendingNewNodes.size > 0) {
            this.styleSheetWatcher?.addPendingNewNodes(pendingNewNodes);
          }
          
          this.emitTimestampFrame();
      
          for (const operation of operations) {
            await this.processOperation(operation, this.sourceDocNodeIdMap!);
          }
        }    
      },
      500,
      true  // Enable immediate processing to ensure DomNodeAdded frames are emitted before stylesheet mutations
    );

    this.styleSheetWatcher = new StyleSheetWatcher({
      patchCSSOM: true,
      root: this.sourceDocument,
      handler: this.createStyleSheetHandler(),
      nodeIdMap: this.sourceDocNodeIdMap
    });

    this.styleSheetWatcher.start();

    // Mark all nodes from the keyframe as already emitted
    // (they exist in the initial DOM snapshot, so no DomNodeAdded frames will be emitted for them)
    const allInitialNodes: Node[] = [];
    this.collectNodesFromDocumentRecursive(this.sourceDocument, allInitialNodes);
    this.styleSheetWatcher.markSubtreeEmitted(allInitialNodes);

    this.canvasTracker = new CanvasTracker(this.createCanvasHandler(), this.sourceDocNodeIdMap, {
      watch2D: true,
      watchWebGL: true,
      observeDom: true,
      includeDocuments: [this.sourceDocument],
      shadowRoots: [],
      processIntervalMs: 500,
    });
    this.canvasTracker.watch();

    // Setup form field tracking
    this.formFieldTracker = new FormFieldTracker(
      this.sourceDocument,
      this.sourceDocNodeIdMap,
      {
        onPropertyChanged: async (operations) => {
          if (operations.length > 0) {
            this.emitTimestampFrame();
            for (const operation of operations) {
              const op = new DomNodePropertyChanged(operation.nodeId, operation.propertyName, operation.propertyValue);
              this.emitFrame(op, false);
            }
          }
        },
        onTextChanged: async (operations) => {
          if (operations.length > 0) {
            this.emitTimestampFrame();
            for (const operation of operations) {
              // Convert StringMutationOperation to TextOperationData
              const textOps = operation.operations.map(op => {
                if (op.type === 'insert') {
                  return {
                    op: 'insert' as const,
                    index: op.index,
                    text: op.content
                  };
                } else {
                  return {
                    op: 'remove' as const,
                    index: op.index,
                    length: op.count
                  };
                }
              });
              
              const frame = new DomNodePropertyTextChanged(operation.nodeId, operation.propertyName, textOps);
              this.emitFrame(frame, false);
            }
          }
        }
      },
      {
        immediateMode: true
      }
    );
    this.formFieldTracker.start();
  }

  public stop() {
    this.userInteractionTracker?.stop();
    this.changeDetector?.disconnect();
    this.styleSheetWatcher?.stop();
    this.canvasTracker?.unwatch();
    this.formFieldTracker?.stop();
  }

  private emitTimestampFrame() {
    const relativeTime = Date.now() - this.recordingEpoch;
    const frame = new Timestamp(relativeTime);
    this.emitFrame(frame, false);
  }

  /**
   * Recursively collects all node IDs from a VNode tree
   */
  private collectNodeIds(vNode: any, nodeIds: number[]): void {
    if (vNode && typeof vNode.id === 'number') {
      nodeIds.push(vNode.id);
    }
    if (vNode.children) {
      for (const child of vNode.children) {
        this.collectNodeIds(child, nodeIds);
      }
    }
    if (vNode.shadow) {
      for (const shadowChild of vNode.shadow) {
        this.collectNodeIds(shadowChild, nodeIds);
      }
    }
  }

  /**
   * Recursively collects all node IDs from the live DOM document
   */
  private collectNodeIdsFromDocument(node: Node, nodeIds: number[]): void {
    const nodeId = this.sourceDocNodeIdMap?.getNodeId(node);
    if (nodeId !== undefined) {
      nodeIds.push(nodeId);
    }
    for (const child of Array.from(node.childNodes)) {
      this.collectNodeIdsFromDocument(child, nodeIds);
    }
  }

  /**
   * Recursively collects all nodes from the live DOM document
   */
  private collectNodesFromDocumentRecursive(node: Node, nodes: Node[]): void {
    nodes.push(node);
    for (const child of Array.from(node.childNodes)) {
      this.collectNodesFromDocumentRecursive(child, nodes);
    }
  }

  /**
   * Recursively collects all nodes from a subtree (starting from a cloned node with IDs).
   * Resolves each node ID to the corresponding live DOM node.
   * 
   * @param clonedNode The cloned node (from operation) that has IDs
   * @param nodeIdMap The NodeIdBiMap to resolve IDs to live nodes
   * @param nodes Set to collect the live nodes into
   */
  private collectNodesFromClonedNode(clonedNode: Node, nodeIdMap: NodeIdBiMap, nodes: Set<Node>): void {
    const nodeId = NodeIdBiMap.getNodeId(clonedNode);
    if (nodeId !== undefined) {
      const liveNode = nodeIdMap.getNodeById(nodeId);
      if (liveNode) {
        nodes.add(liveNode);
      }
    }
    
    // Recursively collect all child nodes
    for (const child of Array.from(clonedNode.childNodes)) {
      this.collectNodesFromClonedNode(child, nodeIdMap, nodes);
    }
  }

  /**
   * Collects all nodes from insert operations.
   * These are nodes that have been assigned IDs by DomChangeDetector but haven't been emitted yet.
   * 
   * NOTE: This could be optimized by collecting nodes during operation creation in DomChangeDetector,
   * but for now we traverse the operations after creation.
   * 
   * @param operations Array of operations from DomChangeDetector
   * @param nodeIdMap The NodeIdBiMap to resolve IDs to live nodes
   * @returns Set of live DOM nodes from insert operations
   */
  private collectNodesFromInsertOperations(operations: DomOperation[], nodeIdMap: NodeIdBiMap): Set<Node> {
    const nodes = new Set<Node>();
    
    for (const operation of operations) {
      if (operation.op === 'insert') {
        // Collect all nodes from the subtree (recursively)
        this.collectNodesFromClonedNode(operation.node, nodeIdMap, nodes);
      }
    }
    
    return nodes;
  }

  private async processOperation(
    operation: DomOperation,
    nodeIdMap: NodeIdBiMap
  ): Promise<void> {
    switch (operation.op) {
      case "insert":
        inlineSubTree(operation.node, nodeIdMap, this.assetTracker, {
          onInlineStarted: async (ev: InlineStartedEvent) => {
            const frame = new DomNodeAdded(operation.parentId, operation.index, ev.node);
            await this.emitFrame(frame, false);
            
            // Mark all nodes in this subtree as emitted so queued stylesheet mutations can be flushed
            // Collect the actual live DOM nodes from the cloned node (which has IDs)
            // Note: ev.node is a VNode, but operation.node is the actual DOM Node with IDs
            const nodesSet = new Set<Node>();
            this.collectNodesFromClonedNode(operation.node, nodeIdMap, nodesSet);
            this.styleSheetWatcher?.markSubtreeEmitted(Array.from(nodesSet));
          },
          onAsset: async (asset: InlinerAsset) => {
            const frame = new Asset(asset.id, asset.url, asset.mime, asset.buf);
            await this.emitFrame(frame, false);
          },
        });
        break;

      case "remove":
        const removeFrame = new DomNodeRemoved(operation.nodeId);
        await this.emitFrame(removeFrame, false);
        // Clean up stylesheet watcher tracking for this node
        // Resolve nodeId to live node
        const removedNode = nodeIdMap.getNodeById(operation.nodeId);
        if (removedNode) {
          this.styleSheetWatcher?.markNodeRemoved(removedNode);
        }
        break;

      case "updateAttribute":
        const updateAttrFrame = new DomAttributeChanged(operation.nodeId, operation.name, operation.value);
        await this.emitFrame(updateAttrFrame, false);
        break;

      case "removeAttribute":
        const removeAttrFrame = new DomAttributeRemoved(operation.nodeId, operation.name);
        await this.emitFrame(removeAttrFrame, false);
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
        await this.emitFrame(textFrame, false);
        break;


    } 
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
      onWindowFocus: (_) => {
        const frame = new WindowFocused();
        this.emitFrame(frame);
      },
      onWindowBlur: (_) => {
        const frame = new WindowBlurred();
        this.emitFrame(frame);
      }
    };
  }

  private createKeyFrameHandler() {
    return {
      onKeyFrameStarted: async (ev: KeyFrameStartedEvent) => {
        const keyframe = new Keyframe(ev.document, ev.viewportWidth, ev.viewportHeight);
        await this.emitFrame(keyframe);
      },
      onAsset: async (asset: InlinerAsset) => {
        const fetchError = (asset as any).fetchError || { type: 'none' };
        const assetFrame = new Asset(asset.id, asset.url, asset.mime, asset.buf, fetchError);
        await this.emitFrame(assetFrame, false);
      },
    };
  }

  private createStyleSheetHandler() {
    return async (event: StyleSheetWatcherEvent) => {
      if (event.type === 'adopted-style-sheets') {
        const frame = new AdoptedStyleSheetsChanged(
          event.now.map(sheet => getAdoptedStyleSheetId(sheet)),
          event.added.length
        );
        await this.emitFrame(frame);

        for (const sheet of event.added) {
          await inlineAdoptedStyleSheet(sheet, this.sourceDocument.baseURI, this.assetTracker, {
            onInlineStarted: (ev: InlineAdoptedStyleSheetEvent) => {
              const newStyleSheetFrame = new NewAdoptedStyleSheet(ev.styleSheet);
              this.emitFrame(newStyleSheetFrame, false);
            },
            onAsset: (asset: InlinerAsset) => {
              const assetFrame = new Asset(asset.id, asset.url, asset.mime, asset.buf);
              this.emitFrame(assetFrame, false);
            }
          });
        }
      } else if (event.type === 'sheet-rules-insert') {
        const frame = new StyleSheetRuleInserted(event.sheetId, event.index!, event.rule);
        this.emitFrame(frame);
      } else if (event.type === 'sheet-rules-delete') {
        const frame = new StyleSheetRuleDeleted(event.sheetId, event.index);
        this.emitFrame(frame);
      } else if (event.type === 'sheet-rules-replace') {
        const frame = new StyleSheetReplaced(event.sheetId, event.text);
        this.emitFrame(frame);
      }
    };
  }

  private createCanvasHandler(): CanvasChangedCallback {
    return (event: CanvasChangedEvent) => {
      const frame = new CanvasChanged(event.nodeId, event.mime, event.data);
      try {
      this.emitFrame(frame, true);
      } catch (error) {
        console.error('Error emitting canvas changed frame:', error);
      }
    };
  }
}