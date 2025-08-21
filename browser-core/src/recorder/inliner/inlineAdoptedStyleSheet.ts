import type { VStyleSheet } from "@domcorder/proto-ts";
import { collectCssUrlsAssign, fetchAssets } from "./inline";
import { PendingAssets } from "./PendingAssets";
import type { Asset } from "./Asset";

export interface InlineAdoptedStyleSheetEvent {
  styleSheet: VStyleSheet;
  assetCount: number;
}

export interface InlineSubTreeHandler {
  onInlineStarted: (event: InlineAdoptedStyleSheetEvent) => void;
  onAsset: (asset: Asset) => void;
  onInlineComplete: () => void;
}

export async function inlineAdoptedStyleSheet(
  sheet: CSSStyleSheet,
  baseURI: string,
  handler: InlineSubTreeHandler, 
  concurrency: number = 6,
  inlineCrossOrigin: boolean = false) {
  const pendingAssets = new PendingAssets();


  try {
    const rules = Array.from(sheet.cssRules);
    const text = rules.map(rule => rule.cssText).join('\n');
    const vStyleSheet: VStyleSheet = {
      id: (sheet as any).__css_stylesheet_id__,
      media: sheet.media.mediaText || undefined,
      text
    };

    collectCssUrlsAssign(text, baseURI, pendingAssets);

    handler.onInlineStarted({
      styleSheet: vStyleSheet,
      assetCount: pendingAssets.order.length
    });

    await fetchAssets(
      concurrency, 
      inlineCrossOrigin,
      pendingAssets,
      (asset) => handler.onAsset(asset));

    handler.onInlineComplete();
  } catch (error) {
    console.warn('Failed to process adopted stylesheet:', error);
  }
}