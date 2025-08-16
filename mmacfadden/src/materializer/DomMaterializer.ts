import type { VDocument, VNode, VElement, VTextNode, VStyleSheet } from '../dom/vdom';
import type { Asset } from '../inliner/events';

/**
 * DomMaterializer recreates an HTML document from a VDocument and associated assets.
 * 
 * This class takes a virtual DOM representation (VDocument) and an array of asset events
 * containing binary data (images, fonts, etc.) and materializes them into a real DOM Document.
 * 
 * The materialization process:
 * 1. Creates a new Document instance
 * 2. Reconstructs the document element and all child nodes
 * 3. Applies stylesheets with inlined asset data
 * 4. Handles "asset:<id>" references by creating data URLs from binary buffers
 * 
 * The VDocument contains "asset:<id>" URLs that reference assets by their ID,
 * which are resolved to actual binary data from the AssetEvt array.
 */
export class DomMaterializer {
  private document: Document;
  private assetMap: Map<number, Asset>;

  constructor(document: Document) {
    this.document = document;
    this.assetMap = new Map();
  }

  /**
   * Materializes a VDocument into a real DOM Document
   * @param vdoc The virtual document representation
   * @param assets Array of asset events containing binary data
   * @returns A fully materialized Document instance
   */
  public materialize(vdoc: VDocument, assets: Asset[]): void {
    // Build asset map for quick lookup
    this.buildAssetMap(assets);
    
    // Set document properties
    this.setDocumentProperties(vdoc);
    
    // Create and append the document element
    const documentElement = this.createElement(vdoc.documentElement);
    this.document.removeChild(this.document.documentElement);
    this.document.appendChild(documentElement);
    
    // Apply stylesheets
    this.applyStylesheets(vdoc.styleSheets);
  }

  /**
   * Builds a map of asset IDs to their assets for quick lookup
   */
  private buildAssetMap(assets: Asset[]): void {
    this.assetMap.clear();
    for (const asset of assets) {
      this.assetMap.set(asset.id, asset);
    }
  }

  /**
   * Sets document-level properties like base URI, language, and direction
   */
  private setDocumentProperties(vdoc: VDocument): void {
    // Set base URI
    if (vdoc.baseURI) {
      const baseElement = this.document.createElement('base');
      baseElement.href = vdoc.baseURI;
      this.document.head?.appendChild(baseElement);
    }

    // Set document language and direction
    if (vdoc.lang) {
      this.document.documentElement?.setAttribute('lang', vdoc.lang);
    }
    if (vdoc.dir) {
      this.document.documentElement?.setAttribute('dir', vdoc.dir);
    }
  }

  /**
   * Recursively creates a DOM element from a VElement
   */
  private createElement(vElement: VElement): Element {
    const element = this.document.createElementNS(vElement.ns || null, vElement.tag);
    
    // Set attributes
    if (vElement.attrs) {
      for (const [key, value] of Object.entries(vElement.attrs)) {
        // Handle "asset:" URLs in attributes
        const processedValue = this.processAttributeValue(key, value);
        element.setAttribute(key, processedValue);
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
  private processAttributeValue(key: string, value: string): string {
    // Handle attributes that commonly contain URLs
    const urlAttributes = ['src', 'href', 'poster', 'xlink:href', 'data-src'];
    if (urlAttributes.includes(key)) {
      const assetMatch = value.match(/^asset:(\d+)$/);
      if (assetMatch) {
        const assetId = parseInt(assetMatch[1], 10);
        const asset = this.assetMap.get(assetId);
        if (asset) {
          const base64 = this.arrayBufferToBase64(asset.buf);
          const mimeType = asset.mime || this.detectMimeType(asset.url);
          return `data:${mimeType};base64,${base64}`;
        }
      }
    }
    
    // Handle srcset attribute (multiple URLs)
    if (key === 'srcset') {
      return this.processSrcsetValue(value);
    }
    
    // Handle style attribute (inline CSS)
    if (key === 'style') {
      return this.processCssText(value);
    }
    
    return value;
  }

  /**
   * Processes srcset attribute to handle "asset:" URLs
   */
  private processSrcsetValue(srcset: string): string {
    const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
    return parts
      .map(part => {
        const [url, ...desc] = part.split(/\s+/);
        const assetMatch = url.match(/^asset:(\d+)$/);
        if (assetMatch) {
          const assetId = parseInt(assetMatch[1], 10);
          const asset = this.assetMap.get(assetId);
          if (asset) {
            const base64 = this.arrayBufferToBase64(asset.buf);
            const mimeType = asset.mime || this.detectMimeType(asset.url);
            const dataUrl = `data:${mimeType};base64,${base64}`;
            return desc.length ? [dataUrl, ...desc].join(' ') : dataUrl;
          }
        }
        return part; // Keep original if asset not found
      })
      .join(', ');
  }

  /**
   * Creates a DOM node from a VNode (either text or element)
   */
  private createNode(vnode: VNode): Node | null {
    switch (vnode.nodeType) {
      case 'text':
        return this.document.createTextNode(vnode.text);
      case 'element':
        return this.createElement(vnode);
      default:
        return null;
    }
  }

  /**
   * Applies stylesheets to the document programmatically, inlining asset data where needed
   */
  private applyStylesheets(styleSheets: VStyleSheet[]): void {
    for (const sheet of styleSheets) {
      if (!sheet.text) continue;
      
      // Process the CSS text to inline asset data
      const processedText = this.processCssText(sheet.text);
      
      // Create a new stylesheet using CSSOM API
      const win = this.document.defaultView!;

      if (win.CSSStyleSheet) {
        const stylesheet = new win.CSSStyleSheet();
        
        // Set the CSS text content
        try {
          stylesheet.replaceSync(processedText);
        } catch (error) {
          console.warn('Failed to parse CSS stylesheet:', error);
          continue;
        }
        
        // Set media if specified
        if (sheet.media) {
          stylesheet.media.mediaText = sheet.media;
        }
        
        // Add the stylesheet to the document's stylesheet collection
        this.document.adoptedStyleSheets = [
          ...this.document.adoptedStyleSheets,
          stylesheet
        ];
      } else {
        const styleElement = this.document.createElement('style');
      
        if (sheet.id) {
          styleElement.id = sheet.id;
        }
        
        if (sheet.media) {
          styleElement.setAttribute('media', sheet.media);
        }
        
        if (processedText) {
          styleElement.textContent = processedText;
        }
        
        this.document.head?.appendChild(styleElement);
      }
    }
  }

  /**
   * Processes CSS text to replace asset URLs with data URLs
   */
  private processCssText(cssText: string): string {
    // This is a simplified implementation - in practice, you might want to use a CSS parser
    // to properly handle all URL references in CSS
    
    // Look for url() references and replace them with data URLs if the asset exists
    return cssText.replace(/url\(['"]?([^'"]+)['"]?\)/g, (match, url) => {
      // Handle "asset:<id>" format
      const assetMatch = url.match(/^asset:(\d+)$/);
      if (assetMatch) {
        const assetId = parseInt(assetMatch[1], 10);
        const asset = this.assetMap.get(assetId);
        if (asset) {
          // Convert ArrayBuffer to base64 data URL
          const base64 = this.arrayBufferToBase64(asset.buf);
          const mimeType = asset.mime || this.detectMimeType(asset.url);
          return `url(data:${mimeType};base64,${base64})`;
        }
      }
      return match; // Keep original if asset not found
    });
  }

  /**
   * Converts an ArrayBuffer to a base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Detects MIME type based on file extension or asset ID
   */
  private detectMimeType(url: string): string {
    // Handle "asset:" URLs - we can't determine MIME type from these
    // In practice, the AssetEvt should contain the mime type
    if (url.startsWith('asset:')) {
      return 'application/octet-stream'; // Default fallback
    }
    
    const extension = url.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'svg':
        return 'image/svg+xml';
      case 'webp':
        return 'image/webp';
      case 'woff':
        return 'font/woff';
      case 'woff2':
        return 'font/woff2';
      case 'ttf':
        return 'font/ttf';
      case 'otf':
        return 'font/otf';
      case 'eot':
        return 'application/vnd.ms-fontobject';
      default:
        return 'application/octet-stream';
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
    this.document = new Document();
    this.assetMap.clear();
  }
}
