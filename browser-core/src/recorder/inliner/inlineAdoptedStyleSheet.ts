import { VStyleSheet } from "@domcorder/proto-ts";
import { collectCssUrlsAssign, fetchAssets, rewriteStyleSheetsToAssetIds } from "./inline";
import { AssetTracker } from "./AssetTracker";
import type { Asset } from "./Asset";

export interface InlineAdoptedStyleSheetEvent {
  styleSheet: VStyleSheet;
}

export interface InlineSubTreeHandler {
  onInlineStarted: (event: InlineAdoptedStyleSheetEvent) => void;
  onAsset: (asset: Asset) => void;
}

export async function inlineAdoptedStyleSheet(
  sheet: CSSStyleSheet,
  baseURI: string,
  assetTracker: AssetTracker,
  handler: InlineSubTreeHandler,
  concurrency: number = 6,
  inlineCrossOrigin: boolean = false) {


  try {
    const rules = Array.from(sheet.cssRules);
    const text = rules.map(rule => rule.cssText).join('\n');
    const vStyleSheet: VStyleSheet = new VStyleSheet(
      sheet.__adopted_stylesheet_id__!,
      text,
      sheet.media.mediaText || undefined
    );

    collectCssUrlsAssign(text, baseURI, assetTracker);
    const updated = rewriteStyleSheetsToAssetIds(vStyleSheet, baseURI, assetTracker);

    handler.onInlineStarted({ styleSheet: updated });

    await fetchAssets(
      concurrency,
      inlineCrossOrigin,
      assetTracker,
      (asset) => handler.onAsset(asset));

  } catch (error) {
    console.warn('Failed to process adopted stylesheet:', error);
  }
}