import { NodeIdBiMap } from '../common/NodeIdBiMap';
import type { VDocument, VNode, VElement, VTextNode, VCDATASection, VComment, VProcessingInstruction, VDocumentType, VStyleSheet } from '@domcorder/proto-ts';
import { AssetManager } from './AssetManager';
import { setStyleSheetId } from '../recorder/StyleSheetWatcher';

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
  private currentStyleElement: Element | null = null;
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
      for (const [key, value] of Object.entries(vElement.attrs)) {
        // Handle "asset:" URLs in attributes
        const processedValue = this.processAttributeValue(key, value, element);
        if (key !== "contenteditable") {
          element.setAttribute(key, processedValue);
        }
      }
    }

    // Track if we're entering a style element
    const previousStyleElement = this.currentStyleElement;
    if (vElement.tag === 'style') {
      this.currentStyleElement = element;
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

    // Restore previous state
    this.currentStyleElement = previousStyleElement;

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
   * Processes attribute values to handle "asset:" URLs
   */
  private processAttributeValue(key: string, value: string, element: Element): string {
    // Handle attributes that commonly contain URLs
    const urlAttributes = ['src', 'href', 'poster', 'xlink:href', 'data-src'];
    if (urlAttributes.includes(key)) {
      const assetMatch = value.match(/^asset:(\d+)$/);
      if (assetMatch) {
        const assetId = parseInt(assetMatch[1], 10);
        try {
          return this.assetManager.useAssetInElement(assetId, element);
        } catch (error) {
          console.warn(`Asset ${assetId} not found in AssetManager`);
          return value; // Return original value if asset not found
        }
      }
    }

    // Handle srcset attribute (multiple URLs)
    if (key === 'srcset') {
      return this.processSrcsetValue(value, element);
    }

    // Handle style attribute (inline CSS)
    if (key === 'style') {
      return DomMaterializer.processCssText(value, this.assetManager, this.targetWindow, element);
    }

    return value;
  }

  /**
   * Processes srcset attribute to handle "asset:" URLs
   */
  private processSrcsetValue(srcset: string, element: Element): string {
    const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
    return parts
      .map(part => {
        const [url, ...desc] = part.split(/\s+/);
        const assetMatch = url.match(/^asset:(\d+)$/);
        if (assetMatch) {
          const assetId = parseInt(assetMatch[1], 10);
          try {
            const blobUrl = this.assetManager.useAssetInElement(assetId, element);
            return desc.length ? [blobUrl, ...desc].join(' ') : blobUrl;
          } catch (error) {
            console.warn(`Asset ${assetId} not found in AssetManager for srcset`);
            return part; // Keep original if asset not found
          }
        }
        return part; // Keep original if asset not found
      })
      .join(', ');
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
    if (this.currentStyleElement) {
      // Process CSS content to replace asset URLs using the current style element as context
      const processedText = DomMaterializer.processCssText(vnode.text, this.assetManager, this.targetWindow, this.currentStyleElement);
      return this.document.createTextNode(processedText);
    } else {
      return this.document.createTextNode(vnode.text);
    }
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
      const win = this.document.defaultView!;
      const stylesheet = DomMaterializer.createStyleSheet(sheet, this.assetManager, win);

      // Add the stylesheet to the document's stylesheet collection
      this.document.adoptedStyleSheets = [
        ...this.document.adoptedStyleSheets,
        stylesheet
      ];
    }
  }

  public static createStyleSheet(
    sheet: VStyleSheet, 
    assetManager: AssetManager,
    targetWindow: Window & typeof globalThis): CSSStyleSheet {
    
    const stylesheet = new targetWindow.CSSStyleSheet();
    
    const processedText = DomMaterializer.processCssText(sheet.text, assetManager, targetWindow, stylesheet);
    stylesheet.replaceSync(processedText);

    setStyleSheetId(stylesheet, sheet.id);
    
    // Set media if specified
    if (sheet.media) {
      stylesheet.media.mediaText = sheet.media;
    }

    return stylesheet;
  }

  /**
   * Processes CSS text to replace asset URLs with blob URLs
   * @param cssText The CSS text to process
   * @param consumer Optional element or adopted stylesheet context for asset reference tracking
   */
  private static processCssText(
    cssText: string,
    assetManager: AssetManager,
    targetWindow: Window & typeof globalThis,
    consumer?: Element | CSSStyleSheet): string {
    // This is a simplified implementation - in practice, you might want to use a CSS parser
    // to properly handle all URL references in CSS

    // Look for url() references and replace them with blob URLs if the asset exists
    return cssText.replace(/url\(['"]?([^'"]+)['"]?\)/g, (match, url) => {
      // Handle "asset:<id>" format
      const assetMatch = url.match(/^asset:(\d+)$/);
      if (assetMatch) {
        const assetId = parseInt(assetMatch[1], 10);
        try {
          if (consumer) {
            // Use the appropriate method based on the consumer type
            if (consumer instanceof targetWindow.Element) {
              const blobUrl = assetManager.useAssetInElement(assetId, consumer);
              return `url(${blobUrl})`;
            } else if (consumer instanceof targetWindow.CSSStyleSheet) {
              const blobUrl = assetManager.useAssetInStyleSheet(assetId, consumer);
              return `url(${blobUrl})`;
            }
          }
          // If no consumer provided, skip asset processing
          return match;
        } catch (error) {
          console.warn(`Asset ${assetId} not found in AssetManager for CSS`);
          return match; // Keep original if asset not found
        }
      }
      return match; // Keep original if asset not found
    });
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
