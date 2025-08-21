import type { AssetData } from "../common";

interface AssetEntry {
  blob: Blob;
  url: string;
  referenceCount: number;
  elements: Set<Element>;
  adoptedStyleSheets: Set<CSSStyleSheet>;
}

export class AssetManager {
  private assets = new Map<number, AssetEntry>();
  private elementToAssets = new WeakMap<Element, Set<number>>();
  private adoptedStyleSheetToAssets = new WeakMap<CSSStyleSheet, Set<number>>();
  private mutationObserver: MutationObserver;
  private targetWindow: Window & typeof globalThis;

  constructor(targetDocument: Document) {
    this.targetWindow = targetDocument.defaultView!;

    // Set up a single mutation observer for the entire class
    this.mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node instanceof this.targetWindow.Element) {
            this.handleElementRemoval(node);
          }
        });
      });
    });

    // Start observing the document body
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Handles the removal of an element from the DOM
   */
  private handleElementRemoval(element: Element): void {
    const assetIds = this.elementToAssets.get(element);
    if (assetIds) {
      // Release all assets associated with this element
      assetIds.forEach(assetId => {
        this.releaseAssetFromElement(assetId, element);
      });
      // Clean up the WeakMap entry
      this.elementToAssets.delete(element);
    }

    // Also check if any child elements were removed
    const childElements = element.querySelectorAll('*');
    childElements.forEach(child => {
      this.handleElementRemoval(child);
    });
  }

  /**
   * Adds an asset to the manager, creating a blob and object URL
   */
  public addAsset(asset: AssetData): void {
    if (this.assets.has(asset.id)) {
      // Asset already exists, don't recreate
      return;
    }

    const blob = new Blob([asset.buf], { type: asset.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    
    this.assets.set(asset.id, {
      blob,
      url,
      referenceCount: 0,
      elements: new Set(),
      adoptedStyleSheets: new Set()
    });
  }

  /**
   * Returns the blob URL for an asset and sets up reference counting for an element
   * @param assetId The ID of the asset to use
   * @param element The element that will use this asset
   * @returns The blob URL for the asset
   */
  public useAssetInElement(assetId: number, element: Element): string {
    const asset = this.assets.get(assetId);
    if (!asset) {
      throw new Error(`Asset with ID ${assetId} not found`);
    }

    // Increment reference count and track element
    asset.referenceCount++;
    asset.elements.add(element);

    // Track this element's association with this asset
    let elementAssets = this.elementToAssets.get(element);
    if (!elementAssets) {
      elementAssets = new Set();
      this.elementToAssets.set(element, elementAssets);
    }
    elementAssets.add(assetId);

    // Set up event listeners to detect when element no longer needs the asset
    this.setupElementCleanup(assetId, element);

    return asset.url;
  }

  /**
   * Returns the blob URL for an asset and sets up reference counting for an adopted stylesheet
   * @param assetId The ID of the asset to use
   * @param adoptedStyleSheet The adopted stylesheet that will use this asset
   * @returns The blob URL for the asset
   */
  public useAssetInStyleSheet(assetId: number, adoptedStyleSheet: CSSStyleSheet): string {
    const asset = this.assets.get(assetId);
    if (!asset) {
      throw new Error(`Asset with ID ${assetId} not found`);
    }

    // Increment reference count and track adopted stylesheet
    asset.referenceCount++;
    asset.adoptedStyleSheets.add(adoptedStyleSheet);

    // Track this adopted stylesheet's association with this asset
    let styleSheetAssets = this.adoptedStyleSheetToAssets.get(adoptedStyleSheet);
    if (!styleSheetAssets) {
      styleSheetAssets = new Set();
      this.adoptedStyleSheetToAssets.set(adoptedStyleSheet, styleSheetAssets);
    }
    styleSheetAssets.add(assetId);

    return asset.url;
  }

  /**
   * Called when an adopted stylesheet is removed from the page
   * @param adoptedStyleSheet The adopted stylesheet that was removed
   */
  public adoptedStyleSheetRemoved(adoptedStyleSheet: CSSStyleSheet): void {
    const assetIds = this.adoptedStyleSheetToAssets.get(adoptedStyleSheet);
    if (assetIds) {
      // Release all assets associated with this adopted stylesheet
      assetIds.forEach(assetId => {
        this.releaseAssetFromStyleSheet(assetId, adoptedStyleSheet);
      });
      // Clean up the WeakMap entry
      this.adoptedStyleSheetToAssets.delete(adoptedStyleSheet);
    }
  }

  /**
   * Sets up event listeners to detect when an element no longer needs an asset
   */
  private setupElementCleanup(assetId: number, element: Element): void {
    const asset = this.assets.get(assetId);
    if (!asset) return;

    if (element instanceof this.targetWindow.HTMLImageElement) {
      const handleEvent = () => {
        this.releaseAssetFromElement(assetId, element);
      };

      element.addEventListener('load', handleEvent, { once: true });
      element.addEventListener('error', handleEvent, { once: true });
    }

    // Otherwise we hang on to the asset until the element is removed from the DOM.
  }

  /**
   * Releases an asset reference for a specific element
   */
  private releaseAssetFromElement(assetId: number, element: Element): void {
    console.log("releaseAssetFromElement", assetId, element);
    const asset = this.assets.get(assetId);
    if (!asset) return;

    // Remove element from tracking
    asset.elements.delete(element);
    asset.referenceCount--;

    // Remove from element-to-assets mapping
    const elementAssets = this.elementToAssets.get(element);
    if (elementAssets) {
      elementAssets.delete(assetId);
      if (elementAssets.size === 0) {
        this.elementToAssets.delete(element);
      }
    }

    if (asset.referenceCount <= 0) {
      this.releaseAssetById(assetId);
    }
  }

  /**
   * Releases an asset reference for a specific adopted stylesheet
   */
  private releaseAssetFromStyleSheet(assetId: number, adoptedStyleSheet: CSSStyleSheet): void {
    const asset = this.assets.get(assetId);
    if (!asset) return;

    // Remove adopted stylesheet from tracking
    asset.adoptedStyleSheets.delete(adoptedStyleSheet);
    asset.referenceCount--;

    // Remove from adopted-stylesheet-to-assets mapping
    const styleSheetAssets = this.adoptedStyleSheetToAssets.get(adoptedStyleSheet);
    if (styleSheetAssets) {
      styleSheetAssets.delete(assetId);
      if (styleSheetAssets.size === 0) {
        this.adoptedStyleSheetToAssets.delete(adoptedStyleSheet);
      }
    }

    if (asset.referenceCount <= 0) {
      this.releaseAssetById(assetId);
    }
  }

  /**
   * Manually release an asset (useful for cleanup)
   */
  public releaseAssetById(assetId: number): void {
    const asset = this.assets.get(assetId);
    console.log("releaseAssetById", asset);
    if (!asset) return;

    // Remove all element associations
    asset.elements.forEach(element => {
      const elementAssets = this.elementToAssets.get(element);
      if (elementAssets) {
        elementAssets.delete(assetId);
        if (elementAssets.size === 0) {
          this.elementToAssets.delete(element);
        }
      }
    });

    // Remove all adopted stylesheet associations
    asset.adoptedStyleSheets.forEach(adoptedStyleSheet => {
      const styleSheetAssets = this.adoptedStyleSheetToAssets.get(adoptedStyleSheet);
      if (styleSheetAssets) {
        styleSheetAssets.delete(assetId);
        if (styleSheetAssets.size === 0) {
          this.adoptedStyleSheetToAssets.delete(adoptedStyleSheet);
        }
      }
    });

    URL.revokeObjectURL(asset.url);
    this.assets.delete(assetId);
  }

  /**
   * Get the current reference count for an asset
   */
  public getReferenceCount(assetId: number): number {
    const asset = this.assets.get(assetId);
    return asset ? asset.referenceCount : 0;
  }

  /**
   * Clean up assets that have zero reference counts (unused assets)
   */
  public cleanupUnusedAssets(): void {
    const assetsToRemove: number[] = [];
    
    for (const [assetId, asset] of this.assets) {
      if (asset.referenceCount <= 0) {
        assetsToRemove.push(assetId);
      }
    }
    
    // Remove the unused assets
    assetsToRemove.forEach(assetId => {
      this.releaseAssetById(assetId);
    });
  }

  /**
   * Clean up all assets and revoke all blob URLs
   */
  public dispose(): void {
    // Disconnect the mutation observer
    this.mutationObserver.disconnect();
    
    // Clean up all assets
    for (const [_, asset] of this.assets) {
      URL.revokeObjectURL(asset.url);
    }
    this.assets.clear();
    
    // Clear the WeakMaps (though they will be garbage collected automatically)
    this.elementToAssets = new WeakMap();
    this.adoptedStyleSheetToAssets = new WeakMap();
  }
}