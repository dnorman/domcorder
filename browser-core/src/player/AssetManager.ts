import type { Asset } from "@domcorder/proto-ts";

export type AssetLoadedHandler = (asset: AssetEntry) => void;

interface AssetEntry {
  sourceUrl?: string;
  blob?: Blob;
  pendingBlobUrl?: string;
  resolvedUrl?: string;
  referenceCount: number;
  assetRequestors: Set<AssetLoadedHandler>;
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
  public receiveAsset(asset: Asset): void {
    let assetEntry = this.assets.get(asset.asset_id);
    if (!assetEntry) {
      assetEntry = this.addAssetEntry(asset.asset_id, asset.url);
    }

    if (!assetEntry.resolvedUrl) {
      let blob: Blob | undefined;
      let objectUrl: string | undefined;

      if (asset.buf.byteLength > 0) {
        blob = new Blob([asset.buf], { type: asset.mime || 'application/octet-stream' });
        objectUrl = URL.createObjectURL(blob);
      } else {
        objectUrl = asset.url;
      }

      assetEntry.blob = blob;
      assetEntry.resolvedUrl = objectUrl;
    }

    if (assetEntry.assetRequestors.size > 0) {
      assetEntry.assetRequestors.forEach(requestor => {
        requestor(assetEntry);
      });
      assetEntry.assetRequestors.clear();
    }

    if (assetEntry.pendingBlobUrl) {
      URL.revokeObjectURL(assetEntry.pendingBlobUrl!);
      assetEntry.pendingBlobUrl = undefined;
    }
  }

  private getOrCreateAssetEntry(assetId: number): AssetEntry {
    let assetEntry = this.assets.get(assetId);
    if (!assetEntry) {
      assetEntry = this.addAssetEntry(assetId);
    }
    return assetEntry;
  }

  private addAssetEntry(assetId: number, sourceUrl?: string): AssetEntry {
    const pendingBlobUrl = URL.createObjectURL(new Blob([]));

    const assetEntry: AssetEntry = {
      sourceUrl,
      pendingBlobUrl,      
      blob: undefined,
      resolvedUrl: undefined,
      referenceCount: 0,
      elements: new Set<Element>(),
      assetRequestors: new Set<AssetLoadedHandler>(),
      adoptedStyleSheets: new Set()
    };
    this.assets.set(assetId, assetEntry);
    return assetEntry;
  }

  public findAndBindAssetToElementProperty(
    element: Element,
    property: string
  ): void {
    const value = element.getAttribute(property);
    if (!value) return;

    const detectedAssetIds = new Set<number>();
    const assetMatch = value.matchAll(/asset:(?<assetId>\d+)/g);
    
    for (const match of assetMatch) {
      const assetId = match.groups!.assetId ? parseInt(match.groups!.assetId, 10) : undefined;
      if (!assetId || detectedAssetIds.has(assetId)) continue;

      detectedAssetIds.add(assetId);
      this.bindAssetToElementProperty(assetId, element, property);
    }
  }

  private bindAssetToElementProperty(
    assetId: number,
    element: Element,
    property: string
  ): void {
    const asset = this.getOrCreateAssetEntry(assetId);
    const pendingBlobUrl = asset.pendingBlobUrl!;
    
    const value = element.getAttribute(property);
    if (!value) return;

    if (property === 'srcset') {
      const parts = value.split(',').map(s => s.trim()).filter(Boolean);
      const processedParts = parts
        .map(part => {
          const [url, ...desc] = part.split(/\s+/);
          const assetMatch = url.match(/^asset:(\d+)$/);
          if (assetMatch) {
            const matchedAssetId = parseInt(assetMatch[1], 10);
            if (matchedAssetId === assetId) {
              // This part matched the asset id so fill in the asset url.
              return desc.length ? [pendingBlobUrl, ...desc].join(' ') : pendingBlobUrl;
            } 
          }
          // Keep original if asset not found
          return part; 
        })
        .join(', ');
        element.setAttribute(property, processedParts);
    } else if (property === 'style') {
      const processedCssText = this.replaceAssetInCssText(value, assetId, pendingBlobUrl);
      element.setAttribute(property, processedCssText);
    } else {
      element.setAttribute(property, pendingBlobUrl);
    }

    this.useAssetInElement(assetId, element, (asset) => {
      const resolvedUrl = asset.resolvedUrl!;
      const currentValue = element.getAttribute(property);
        if (currentValue) {
          const newValue = currentValue.replaceAll(asset.pendingBlobUrl!, resolvedUrl);
          element.setAttribute(property, newValue);
        } 
    });
  }

  public bindAssetsToStyleSheet(styleSheet: CSSStyleSheet, cssText: string) {
    const processedCssText = this.processAssetsInCssText(cssText, (assetId, asset) => {
      this.useAssetInStyleSheet(assetId, styleSheet, () => {
        const resolvedUrl = asset.resolvedUrl!;
        const currentValue = Array.from(styleSheet.cssRules).map(rule => rule.cssText).join("\n");
        if (currentValue) {
          const newValue = currentValue.replaceAll(asset.pendingBlobUrl!, resolvedUrl);
          styleSheet.replaceSync(newValue);
        }
      });
    });

    styleSheet.replaceSync(processedCssText);
  }

  private replaceAssetInCssText(cssText: string, assetId: number, newUrl: string): string {
    return cssText.replace(/url\(['"]?([^'"]+)['"]?\)/g, (_, url) => {
      const assetMatch = url.match(/^asset:(\d+)$/);
      if (assetMatch) {
        const matchedAssetId = parseInt(assetMatch[1], 10);
        if (matchedAssetId === assetId) {
          return `url(${newUrl})`;
        } else {
          return `url(${url})`;
        }
      } else {
        return `url(${url})`;
      }
    });
  }

  /**
   * Returns the blob URL for an asset and sets up reference counting for an element
   * @param assetId The ID of the asset to use
   * @param element The element that will use this asset
   * @returns The blob URL for the asset
   */
  public useAssetInElement(
    assetId: number,
    element: Element,
    onAssetLoaded: AssetLoadedHandler
  ): void {
    const asset = this.getOrCreateAssetEntry(assetId);

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

    if (asset.resolvedUrl) {
      setTimeout(() => {
        onAssetLoaded(asset);
      }, 0);
    } else {
      asset.assetRequestors.add(onAssetLoaded);
    }  
  }

  public bindAssetsToStyleElement(styleElement: HTMLStyleElement): void { 
    const processedCssText = this.processAssetsInCssText(styleElement.textContent || "", (assetId, asset) => {
      this.useAssetInElement(assetId, styleElement, () => {
        const resolvedUrl = asset.resolvedUrl!;
        const currentValue = styleElement.textContent;
        if (currentValue) {
          const newValue = currentValue.replaceAll(asset.pendingBlobUrl!, resolvedUrl);
          styleElement.childNodes.item(0)!.textContent = newValue;
        }
      });
    });

    styleElement.childNodes.item(0)!.textContent = processedCssText;
  }

  private processAssetsInCssText(cssText: string, registrationCallback: (id: number, asset: AssetEntry) => void): string {
    // FIXME update asset counts and references.
    const detectedAssetIds = new Set<number>();

    // Look for url() references and replace them with blob URLs if the asset exists
    const processedCssText = cssText.replace(/url\(['"]?([^'"]+)['"]?\)/g, (match, url) => {
      const assetMatch = url.match(/^asset:(\d+)$/);
      if (assetMatch) {
        const assetId = parseInt(assetMatch[1], 10);
        if (!detectedAssetIds.has(assetId)) {
          detectedAssetIds.add(assetId);
          const asset = this.getOrCreateAssetEntry(assetId);
          const pendingBlobUrl = asset.pendingBlobUrl!;
          registrationCallback(assetId, asset);
          return `url(${pendingBlobUrl})`;
        } else {
          return match;
        }
      }
      return match;
    });

    return processedCssText;
  }

  /**
   * Returns the blob URL for an asset and sets up reference counting for an adopted stylesheet
   * @param assetId The ID of the asset to use
   * @param adoptedStyleSheet The adopted stylesheet that will use this asset
   * @returns The blob URL for the asset
   */
  public useAssetInStyleSheet(
    assetId: number,
    adoptedStyleSheet: CSSStyleSheet,
    onAssetLoaded: AssetLoadedHandler
  ): void {
    const asset = this.getOrCreateAssetEntry(assetId);

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

    if (asset.resolvedUrl) {
      setTimeout(() => {
        onAssetLoaded(asset);
      }, 0);
    } else {
      asset.assetRequestors.add(onAssetLoaded);
    } 
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

    // For now, we are skipping this.
    // if (asset.referenceCount <= 0) {
    //   this.releaseAssetById(assetId);
    // }
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

    if (asset.resolvedUrl) {
      URL.revokeObjectURL(asset.resolvedUrl);
    }
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
      if (asset.resolvedUrl) {
        URL.revokeObjectURL(asset.resolvedUrl);
      }
    }
    this.assets.clear();

    // Clear the WeakMaps (though they will be garbage collected automatically)
    this.elementToAssets = new WeakMap();
    this.adoptedStyleSheetToAssets = new WeakMap();
  }
}