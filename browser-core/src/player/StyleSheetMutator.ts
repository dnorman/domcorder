import { NodeIdBiMap } from "../common";
import { getAdoptedStyleSheetId, getNonAdoptedStyleSheetId } from "../common/StyleSheetIdUtils";
import type { AssetManager } from "./AssetManager";

/**
 * StyleSheetMutator provides methods to mutate stylesheets during playback.
 * 
 * It handles both adopted stylesheets (document.adoptedStyleSheets) and
 * regular stylesheets (document.styleSheets), finding them by their unique ID
 * that was assigned during recording.
 */
export class StyleSheetMutator {
  private readonly targetDocument: Document;
  private readonly assetManager: AssetManager;
  private static readonly MAX_RETRIES = 50;
  private static readonly RETRY_DELAY_MS = 10;
  private static readonly MAX_RETRY_TIME_MS = 5000; // 5 seconds max

  constructor(targetDocument: Document, assetManager: AssetManager) {
    this.targetDocument = targetDocument;
    this.assetManager = assetManager;
  }

  /**
   * Finds a stylesheet by its ID, searching both adoptedStyleSheets and document.styleSheets
   * Returns null if not found
   */
  private findStyleSheetById(styleSheetId: number): CSSStyleSheet | null {
    return this.findStyleSheetByIdSync(styleSheetId);
  }

  /**
   * Waits for a stylesheet to become available by retrying with exponential backoff
   */
  private async waitForStyleSheet(styleSheetId: number, startTime: number, retryCount: number): Promise<CSSStyleSheet> {
    const sheet = this.findStyleSheetById(styleSheetId);
    if (sheet) {
      return sheet;
    }

    // Check if we've exceeded retry limits
    const elapsed = Date.now() - startTime;
    if (retryCount >= StyleSheetMutator.MAX_RETRIES || elapsed >= StyleSheetMutator.MAX_RETRY_TIME_MS) {
      // Provide diagnostic information about what exists
      const diagnostic = this.getDiagnosticInfo(styleSheetId);
      throw new Error(
        `Stylesheet with ID ${styleSheetId} not found after ${retryCount} retries (${elapsed}ms). ` +
        `Diagnostics: ${diagnostic}`
      );
    }

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, StyleSheetMutator.RETRY_DELAY_MS));
    return this.waitForStyleSheet(styleSheetId, startTime, retryCount + 1);
  }

  /**
   * Collects diagnostic information about stylesheet availability
   */
  private getDiagnosticInfo(styleSheetId: number): string {
    const info: string[] = [];
    
    // Check if node exists
    const allNodes = this.targetDocument.querySelectorAll('*');
    let nodeExists = false;
    const styleElements: Array<{ tag: string; nodeId: number | undefined }> = [];
    
    allNodes.forEach(node => {
      const nodeId = NodeIdBiMap.getNodeId(node);
      if (nodeId === styleSheetId) {
        nodeExists = true;
      }
      if (node instanceof HTMLStyleElement) {
        styleElements.push({ tag: node.tagName, nodeId });
      } else if (node instanceof HTMLLinkElement && node.rel !== 'icon') {
        styleElements.push({ tag: node.tagName, nodeId });
      }
    });
    
    info.push(`Node ${styleSheetId} exists: ${nodeExists}`);
    info.push(`Style elements found: ${styleElements.length}`);
    if (styleElements.length > 0) {
      info.push(`Style element IDs: [${styleElements.map(e => e.nodeId ?? 'undefined').join(', ')}]`);
    }
    info.push(`document.styleSheets.length: ${this.targetDocument.styleSheets.length}`);
    info.push(`adoptedStyleSheets.length: ${this.targetDocument.adoptedStyleSheets.length}`);
    
    // Check ownerNode IDs of stylesheets in document.styleSheets
    const stylesheetOwnerNodeIds: Array<number | null> = [];
    try {
      for (const sheet of this.targetDocument.styleSheets) {
        try {
          if (sheet.ownerNode) {
            const ownerNodeId = NodeIdBiMap.getNodeId(sheet.ownerNode);
            stylesheetOwnerNodeIds.push(ownerNodeId ?? null);
          } else {
            stylesheetOwnerNodeIds.push(null);
          }
        } catch (e) {
          stylesheetOwnerNodeIds.push(null); // Cross-origin or inaccessible
        }
      }
      if (stylesheetOwnerNodeIds.length > 0) {
        info.push(`Stylesheet ownerNode IDs: [${stylesheetOwnerNodeIds.map(id => id ?? 'null').join(', ')}]`);
      }
    } catch (e) {
      info.push(`Error checking stylesheet ownerNodes: ${e}`);
    }
    
    return info.join('; ');
  }

  private findStyleSheetByIdSync(styleSheetId: number): CSSStyleSheet | null {
    // Check adopted stylesheets first (they use auto-incremented IDs)
    for (const sheet of this.targetDocument.adoptedStyleSheets) {
      try {
        if (getAdoptedStyleSheetId(sheet) === styleSheetId) {
          return sheet;
        }
      } catch (e) {
        console.warn(`StyleSheetMutator: Failed to get adopted stylesheet ID ${styleSheetId}:`, e);
        // Some stylesheets may throw when accessed
        continue;
      }
    }

    // Check regular document stylesheets (non-adopted, use ownerNode ID)
    for (const sheet of this.targetDocument.styleSheets) {
      try {
        // For non-adopted stylesheets, check by ownerNode ID
        if (sheet.ownerNode) {
          const id = getNonAdoptedStyleSheetId(sheet);
          if (id === styleSheetId) {
            return sheet;
          }
        }
      } catch (e) {
        console.warn(`StyleSheetMutator: Failed to get stylesheet ID for sheet with ownerNode:`, e);
        // Some stylesheets (e.g., cross-origin) may throw when accessed
        continue;
      }
    }

    // Also check style and link elements directly if not found in document.styleSheets
    // This handles cases where the stylesheet hasn't been added to document.styleSheets yet
    // (e.g., link elements that are still loading, or style elements that haven't been parsed yet)
    const allStyleElements = this.targetDocument.querySelectorAll('style, link[rel="stylesheet"]');
    for (const element of allStyleElements) {
      const nodeId = NodeIdBiMap.getNodeId(element);
      if (nodeId === styleSheetId) {
        // Try to get the stylesheet from the element
        if (element instanceof HTMLStyleElement && element.sheet) {
          return element.sheet;
        }
        if (element instanceof HTMLLinkElement && element.sheet) {
          return element.sheet;
        }
      }
    }

    return null;
  }

  /**
   * Processes CSS text to replace asset: references with blob URLs
   */
  private processAssetsInRuleText(cssText: string, sheet: CSSStyleSheet): string {
    // Look for url() references and replace them with blob URLs if the asset exists
    const detectedAssetIds = new Set<number>();
    
    return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, raw) => {
      const url = raw.trim();
      const assetMatch = /^asset:(\d+)$/.exec(url);
      if (assetMatch) {
        const assetId = parseInt(assetMatch[1], 10);
        const asset = (this.assetManager as any).getOrCreateAssetEntry(assetId);
        const pendingBlobUrl = asset.resolvedUrl || asset.pendingBlobUrl!;
        
        // Register the asset for this stylesheet only once per unique assetId
        if (!detectedAssetIds.has(assetId)) {
          detectedAssetIds.add(assetId);
          
          this.assetManager.useAssetInStyleSheet(assetId, sheet, () => {
            // When asset is loaded, we need to update the entire sheet
            // since we can't update a single rule in place
            const currentContent = Array.from(sheet.cssRules).map(rule => rule.cssText).join("\n");
            const updatedContent = currentContent.replaceAll(asset.pendingBlobUrl!, asset.resolvedUrl!);
            sheet.replaceSync(updatedContent);
          });
        }
        
        // Always replace the asset: URL with the blob URL, even if we've already registered
        return `url(${pendingBlobUrl})`;
      }
      return match;
    });
  }

  /**
   * Inserts a CSS rule at the specified index
   * Resolves only when the operation is successfully applied
   */
  async insertRule(styleSheetId: number, ruleIndex: number, ruleContent: string): Promise<void> {
    const startTime = Date.now();
    const sheet = await this.waitForStyleSheet(styleSheetId, startTime, 0);
    try {
      const processedContent = this.processAssetsInRuleText(ruleContent, sheet);
      sheet.insertRule(processedContent, ruleIndex);
    } catch (e) {
      console.error(`StyleSheetMutator: Failed to insert rule at index ${ruleIndex}:`, e);
      throw e;
    }
  }

  /**
   * Deletes a CSS rule at the specified index
   * Resolves only when the operation is successfully applied
   */
  async deleteRule(styleSheetId: number, ruleIndex: number): Promise<void> {
    const startTime = Date.now();
    const sheet = await this.waitForStyleSheet(styleSheetId, startTime, 0);

    try {
      sheet.deleteRule(ruleIndex);
    } catch (e) {
      console.error(`StyleSheetMutator: Failed to delete rule at index ${ruleIndex}:`, e);
      throw e;
    }
  }

  /**
   * Replaces the entire content of a stylesheet
   * Resolves only when the operation is successfully applied
   */
  async replaceSheet(styleSheetId: number, content: string): Promise<void> {
    const startTime = Date.now();
    const sheet = await this.waitForStyleSheet(styleSheetId, startTime, 0);

    try {
      // Process assets in the content and bind them to the stylesheet
      this.assetManager.bindAssetsToStyleSheet(sheet, content);
    } catch (e) {
      console.error(`StyleSheetMutator: Failed to replace stylesheet content:`, e);
      throw e;
    }
  }
}

