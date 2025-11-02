import { NodeIdBiMap } from '../common/NodeIdBiMap';
import type { VDocument, VNode, VElement, VTextNode, VCDATASection, VComment, VProcessingInstruction, VDocumentType, VStyleSheet } from '@domcorder/proto-ts';
import { AssetManager } from './AssetManager';
import { setAdoptedStyleSheetId, ASSET_CONTAINING_ATTRIBUTES } from '../common';

/**
 * DomMaterializer recreates an HTML document from a VDocument and associated assets.
 * 
 * This class takes a virtual DOM representation (VDocument) and an AssetManager
 * containing binary data (images, fonts, etc.) and materializes them into a real DOM Document.
 * 
 * The materialization process:
 * 1. Creates a new Document instance
 * 2. Reconstructs all document children (including DOCTYPE, HTML element, etc.)
 * 3. Applies adopted stylesheets with inlined asset data
 * 4. Handles "asset:<id>" references by using the AssetManager to get blob URLs
 * 
 * The VDocument contains "asset:<id>" URLs that reference assets by their ID,
 * which are resolved to actual blob URLs from the AssetManager.
 * 
 * Regular stylesheets from <style> and <link> elements are processed and kept as
 * <style> elements in the DOM with their processed CSS content.
 */
export class DomMaterializer {
  private document: Document;
  private assetManager: AssetManager;
  private currentStyleElement: HTMLStyleElement | null = null;
  private targetWindow: (Window & typeof globalThis);

  constructor(document: Document, assetManager: AssetManager) {
    this.document = document;
    this.assetManager = assetManager;
    this.targetWindow = this.document.defaultView!;
  }

  /**
   * Materializes a VDocument into a real DOM Document
   * @param vdoc The virtual document representation
   */
  public materializeDocument(vdoc: VDocument): void {
    // Clear existing document children
    this.clearDocumentChildren();

    // Process all document children
    this.processDocument(vdoc);

    // Apply adopted stylesheets
    this.applyAdoptedStylesheets(vdoc.adoptedStyleSheets);

    // Clean up
    this.clear();
  }

  public materializeNode(vNode: VNode): Node {
    const node = this.createNode(vNode);
    if (!node) {
      throw new Error(`Failed to materialize node ${vNode.id}`);
    }
    this.clear();
    return node;
  }

  /**
   * Clears all existing children from the document
   */
  private clearDocumentChildren(): void {
    // Remove all child nodes from the document
    while (this.document.firstChild) {
      this.document.removeChild(this.document.firstChild);
    }
  }

  

  /**
   * Recursively creates a DOM element from a VElement
   */
  private createElement(vElement: VElement): Element {
    const element = vElement.ns ? this.document.createElementNS(vElement.ns, vElement.tag) : this.document.createElement(vElement.tag);

    // Set attributes
    if (vElement.attrs) {
      for (const [property, value] of Object.entries(vElement.attrs)) {
        this.assetManager.findAndBindAssetToElementProperty(element, property, value);
      }
    }

    // Process children
    if (vElement.children) {
      for (const child of vElement.children) {
        const childNode = this.createNode(child);
        if (childNode) {
          element.appendChild(childNode);
        }
      }
    }

    if (element instanceof this.targetWindow.HTMLStyleElement) {
      this.assetManager.bindAssetsToStyleElement(element);
    }

    // Handle shadow DOM
    if (vElement.shadow) {
      const shadowRoot = element.attachShadow({ mode: 'closed' });
      for (const shadowChild of vElement.shadow) {
        const shadowNode = this.createNode(shadowChild);
        if (shadowNode) {
          shadowRoot.appendChild(shadowNode);
        }
      }
    }

    return element;
  }

 
  /**
   * Processes all document children and adds them to the document
   */
  private processDocument(vdoc: VDocument): void {
    NodeIdBiMap.setNodeId(this.document, vdoc.id);

    for (const child of vdoc.children) {
      const node = this.createNode(child);
      if (node) {
        this.document.appendChild(node);
      }
    }
  }

  /**
   * Creates a text node, processing CSS if inside a style element
   */
  private createTextNode(vnode: VTextNode): Node {
    return this.document.createTextNode(vnode.text);
  }

  /**
   * Creates a DOM node from a VNode (handles all node types)
   */
  private createNode(vNode: VNode): Node | null {
    let node: Node | null = null;

    switch (vNode.nodeType) {
      case 'text':
        node = this.createTextNode(vNode as VTextNode);
        break;
      case 'element':
        node = this.createElement(vNode as VElement);
        break;
      case 'cdata':
        node = this.document.createCDATASection((vNode as VCDATASection).data);
        break;
      case 'comment':
        node = this.document.createComment((vNode as VComment).data);
        break;
      case 'processingInstruction':
        node = this.document.createProcessingInstruction((vNode as VProcessingInstruction).target, (vNode as VProcessingInstruction).data);
        break;
      case 'documentType':
        node = this.document.implementation.createDocumentType((vNode as VDocumentType).name, (vNode as VDocumentType).publicId || '', (vNode as VDocumentType).systemId || '');
        break;
      default:
        return null;
    }

    if (node) {
      NodeIdBiMap.setNodeId(node, vNode.id);
    }

    return node;
  }

  /**
   * Applies adopted stylesheets to the document programmatically, inlining asset data where needed
   */
  private applyAdoptedStylesheets(adoptedStyleSheets: VStyleSheet[]): void {
    for (const sheet of adoptedStyleSheets) {
      if (!sheet.text) continue;

      // Create a new stylesheet using CSSOM API
      const targetWindow = this.document.defaultView!;
      const stylesheet = new targetWindow.CSSStyleSheet();
      setAdoptedStyleSheetId(stylesheet, sheet.id);

      this.assetManager.bindAssetsToStyleSheet(stylesheet, sheet.text);
      
      // Set media if specified
      if (sheet.media) {
        stylesheet.media.mediaText = sheet.media;
      } 

      // Add the stylesheet to the document's stylesheet collection
      this.document.adoptedStyleSheets = [
        ...this.document.adoptedStyleSheets,
        stylesheet
      ];
    }
  }

  /**
   * Gets the materialized document
   */
  getDocument(): Document {
    return this.document;
  }

  /**
   * Clears the materializer state
   */
  clear(): void {
    this.currentStyleElement = null;
  }
}
