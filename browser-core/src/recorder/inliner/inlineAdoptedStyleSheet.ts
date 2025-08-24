import { VStyleSheet } from "@domcorder/proto-ts";
import { collectCssUrlsAssign, fetchAssets, rewriteStyleSheetsToPendingIds } from "./inline";
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
    const vStyleSheet: VStyleSheet = new VStyleSheet(
      (sheet as any).__css_stylesheet_id__,
      text,
      sheet.media.mediaText || undefined
    );

    collectCssUrlsAssign(text, baseURI, pendingAssets);
    const updated = rewriteStyleSheetsToPendingIds(vStyleSheet, baseURI, pendingAssets);

    handler.onInlineStarted({
      styleSheet: updated,
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