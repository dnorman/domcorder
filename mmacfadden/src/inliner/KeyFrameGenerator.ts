/**
 * inline-snapshot-vdom.ts (streaming, zero-retention assets)
 *
 * Streaming inliner that:
 *  - Phase 1 (sync): builds VDOM, assigns **monotonic asset IDs**, rewrites
 *    DOM/CSS refs to `asset:<id>`, and emits `snapshotStarted`.
 *  - Phase 2 (async): cache-first fetches assets and emits an `asset` event per
 *    resolved asset **without retaining bytes**; when finished, emits
 *    `snapshotComplete` (no payload).
 *
 * Goal: do not keep all assets in memory at once.
 */

import type { NodeIdBiMap } from "../dom/NodeIdBiMap";
import { PendingAssets } from "./PendingAssets";
import type { VDocument, VNode, VStyleSheet } from "../dom/vdom";
import { collectCssUrlsAssign, fetchAssets, makeId, rewriteAllRefsToPendingIds, snapshotNode } from "./inline";
import type { Asset } from "./Asset";

export interface KeyFrameEventHandler {
  onSnapshotStarted: ({snapshot, assetCount}: {snapshot: VDocument, assetCount: number}) => void;
  onAsset: (asset: Asset) => void;
  onSnapshotComplete: () => void;
}

export interface KeyFrameGeneratorOptions {
  concurrency?: number;        // Max parallel fetches
  inlineCrossOrigin?: boolean; // Allow CORS inlining (default false)
  quietWindowMs?: number;      // Wait for DOM quiescence before snapshot
  freezeAnimations?: boolean;  // Disable animations during snapshot
}

export class KeyFrameGenerator {
  private doc: Document;
  private opts: Required<KeyFrameGeneratorOptions>;
  
  private _pending: PendingAssets;
  private nodeIdMap: NodeIdBiMap;
  private antiAnimationStylesheet: CSSStyleSheet | null = null;

  constructor(doc: Document = document, nodeIdMap: NodeIdBiMap, opts: KeyFrameGeneratorOptions = {}) {
    this.doc = doc;
    this.nodeIdMap = nodeIdMap;

    this.opts = {
      concurrency: opts.concurrency ?? 6,
      inlineCrossOrigin: !!opts.inlineCrossOrigin,
      quietWindowMs: opts.quietWindowMs ?? 200,
      freezeAnimations: opts.freezeAnimations ?? true,
    };
    this._pending = new PendingAssets();
  }

  /**
   * Starts the streaming inline process. Resolves when `snapshotComplete` fires.
   * No snapshot is returned from this method; consume events instead.
   */
  public async generateKeyFrame(handler: KeyFrameEventHandler): Promise<void> {
    try {
      this.antiAnimationStylesheet = this.opts.freezeAnimations ? injectAntiAnimationStyle(this.doc) : null;

      await waitForQuietWindow(this.doc, this.opts.quietWindowMs);

      // Phase 1: synchronous snapshot + assign ids + rewrite to asset:<id>
      const snap = snapshotVDomStreaming(this.doc, this.nodeIdMap, this.antiAnimationStylesheet);
      rewriteAllRefsToPendingIds(snap, this.doc.baseURI, this._pending); // proactive rewrite

      // Emit the structural snapshot right away
      handler.onSnapshotStarted({

        snapshot: snap,
        assetCount: this._pending.order.length
      });

      // Phase 2: cache-first fetch & stream assets one-by-one
      await fetchAssets(
        this.opts.concurrency, 
        this.opts.inlineCrossOrigin,
        this._pending,
        (asset) => handler.onAsset(asset));

      // All assets processed; signal completion (no payload)
      handler.onSnapshotComplete();
    } finally {
      if (this.antiAnimationStylesheet) {
        // Remove the anti-animation stylesheet from adopted stylesheets
        this.doc.adoptedStyleSheets = 
          this.doc.adoptedStyleSheets.filter((sheet: CSSStyleSheet) => sheet !== this.antiAnimationStylesheet);
      }
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
    id: nodeIdMap.getNodeId(doc)!,
    adoptedStyleSheets: adoptedStyleSheets,
    children: vChildren
  };
}