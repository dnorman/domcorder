import type { NodeIdBiMap } from "../dom/NodeIdBiMap";
import { PendingAssets } from "./PendingAssets";
import type { VDocument, VNode, VStyleSheet } from "../dom/vdom";
import { 
  collectCssUrlsAssign,
  fetchAssets,
  makeId,
  rewriteAllRefsToPendingIds,
  snapshotNode
} from "./inline";
import type { Asset } from "./Asset";

export interface KeyFrameStartedEvent {
  document: VDocument;
  assetCount: number;
}

export interface KeyFrameEventHandler {
  onKeyFrameStarted: (event: KeyFrameStartedEvent) => void;
  onAsset: (asset: Asset) => void;
  onKeyFrameComplete: () => void;
}

export interface KeyFrameGenerationOptions {
  concurrency?: number;        // Max parallel fetches
  inlineCrossOrigin?: boolean; // Allow CORS inlining (default false)
  quietWindowMs?: number;      // Wait for DOM quiescence before snapshot
  freezeAnimations?: boolean;  // Disable animations during snapshot
}

export async function generateKeyFrame(
  doc: Document = document,
  nodeIdMap: NodeIdBiMap, 
  handler: KeyFrameEventHandler,
  opts: KeyFrameGenerationOptions = {}
): Promise<void> {
  
  const antiAnimationStylesheet = opts.freezeAnimations ? injectAntiAnimationStyle(doc) : null;
  
  try {
    if (opts.quietWindowMs) {
      await waitForQuietWindow(doc, opts.quietWindowMs);
    }

    const pendingAssets = new PendingAssets();

    // Phase 1: synchronous snapshot + assign ids + rewrite to asset:<id>
    const snap = snapshotVDomStreaming(doc, nodeIdMap, antiAnimationStylesheet);
    rewriteAllRefsToPendingIds(snap, doc.baseURI, pendingAssets); // proactive rewrite

    // Emit the structural snapshot right away
    handler.onKeyFrameStarted({
      document: snap,
      assetCount: pendingAssets.order.length
    });

    // Phase 2: cache-first fetch & stream assets one-by-one
    await fetchAssets(
      opts.concurrency || 6, 
      opts.inlineCrossOrigin || false,
      pendingAssets,
      (asset) => handler.onAsset(asset));

    // All assets processed; signal completion (no payload)
    handler.onKeyFrameComplete();
  
  } finally {
    if (antiAnimationStylesheet) {
      // Remove the anti-animation stylesheet from adopted stylesheets
      doc.adoptedStyleSheets = 
        doc.adoptedStyleSheets.filter((sheet: CSSStyleSheet) => sheet !== antiAnimationStylesheet);
    }
  }
}

function injectAntiAnimationStyle(doc: Document): CSSStyleSheet {
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(`*{animation:none!important;transition:none!important}`);
  
  // Add to adopted stylesheets
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, stylesheet];
  
  return stylesheet;
}

async function waitForQuietWindow(doc: Document, ms: number): Promise<void> {
  if (!ms || ms <= 0) return; // no-op
  await new Promise<void>((resolve) => {
    let timer = window.setTimeout(done, ms);
    const mo = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(done, ms);
    });
    function done() { mo.disconnect(); resolve(); }
    mo.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}

function snapshotVDomStreaming(doc: Document, nodeIdMap: NodeIdBiMap, antiAnimationStylesheet: CSSStyleSheet | null = null): VDocument {
  const pending = new PendingAssets();

  const children = Array.from(doc.childNodes);
  const vChildren: VNode[] = [];
  for (const child of children) {
    vChildren.push(snapshotNode(child, pending, nodeIdMap));
  }

  // Handle adopted stylesheets (excluding anti-animation stylesheet)
  const adoptedStyleSheets: VStyleSheet[] = [];
  if (doc.adoptedStyleSheets && doc.adoptedStyleSheets.length > 0) {
    for (let i = 0; i < doc.adoptedStyleSheets.length; i++) {
      const sheet = doc.adoptedStyleSheets[i];
      
      // Skip the anti-animation stylesheet
      if (antiAnimationStylesheet && sheet === antiAnimationStylesheet) {
        continue;
      }
      
      try {
        const rules = Array.from(sheet.cssRules);
        const text = rules.map(rule => rule.cssText).join('\n');
        // FIXME_MM the ids here needs to be linked to the
        // stylesheet object and can be monotonically incremented
        // just like node ids.
        adoptedStyleSheets.push({ 
          id: makeId(), 
          media: sheet.media.mediaText || undefined, 
          text 
        });
        collectCssUrlsAssign(text, doc.baseURI, pending);
      } catch (error) {
        console.warn('Failed to process adopted stylesheet:', error);
      }
    }
  }

  return {
    id: nodeIdMap.getNodeId(doc),
    adoptedStyleSheets: adoptedStyleSheets,
    children: vChildren
  };
}