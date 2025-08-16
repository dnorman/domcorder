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
import type { AssetType } from "./AssetType";
import { Emitter } from "./Emitter";
import type { InlineEvent } from "./events";
import { PendingAssets } from "./PendingAssets";
import type { VCDATASection, VComment, VDocument, VDocumentType, VElement, VNode, VProcessingInstruction, VStyleSheet, VTextNode } from "../dom/vdom";


export interface InlineOptions {
  concurrency?: number;        // Max parallel fetches
  inlineCrossOrigin?: boolean; // Allow CORS inlining (default false)
  quietWindowMs?: number;      // Wait for DOM quiescence before snapshot
  freezeAnimations?: boolean;  // Disable animations during snapshot
}

export class InlineSnapshotStreamer {
  private doc: Document;
  private opts: Required<InlineOptions>;
  readonly events = new Emitter<InlineEvent>();
  private _pending: PendingAssets;
  private nodeIdMap: NodeIdBiMap;

  constructor(doc: Document = document, nodeIdMap: NodeIdBiMap, opts: InlineOptions = {}) {
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
  async start(): Promise<void> {
    const { doc, opts } = this;

    const antiAnim = opts.freezeAnimations ? injectAntiAnimationStyle(doc) : null;
    try {
      await waitForQuietWindow(doc, opts.quietWindowMs);

      // Phase 1: synchronous snapshot + assign ids + rewrite to asset:<id>
      const snap = snapshotVDomStreaming(doc, this.nodeIdMap);
      rewriteAllRefsToPendingIds(snap, this._pending); // proactive rewrite

      // Emit the structural snapshot right away
      this.events.emit({ type: "snapshotStarted", snapshot: snapshotView(snap) });

      // Phase 2: cache-first fetch & stream assets one-by-one
      await this.fetchAssetsStreaming(snap);

      // All assets processed; signal completion (no payload)
      this.events.emit({ type: "snapshotComplete" });
    } finally {
      if (antiAnim) antiAnim.remove();
    }
  }

  private async fetchAssetsStreaming(snap: VDocument): Promise<void> {
    const sem = makeSemaphore(this.opts.concurrency);
    const total = this._pending!.order.length;

    let index = 0;
    await Promise.all(
      this._pending!.order.map((pa) =>
        sem.run(async () => {
          const res = await fetchOriginalBytesAB(pa.url, this.opts.inlineCrossOrigin);
          // Even on failure we advance progress; consumers can reconcile missing assets by id
          const i = ++index;
          if (res.ok) {
            this.events.emit({
              type: "asset",
              asset: {
                id: pa.id,
                url: pa.url,
                assetType: pa.type,
                mime: res.mime,
                bytes: res.buf.byteLength,
                buf: res.buf,
                index: i,
                total,
              }
            });
          } else {
            // Optionally emit a separate failure event type; keeping it simple per ask
          }
        })
      )
    );

    // Drop internal state; we don't keep bytes in memory
    delete (snap as any)._pending;
  }
}

// Public-facing snapshot view (strip internals)
function snapshotView(snap: VDocument): VDocument {
  const { _pending, ...pub } = snap as any;
  return pub as VDocument;
}

function snapshotNode(node: Node, pending: PendingAssets, nodeIdMap: NodeIdBiMap): VNode {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      return snapElement(node as Element, pending, nodeIdMap);
    }
    
    case Node.TEXT_NODE: {
      const textNode: VTextNode = {
        id: nodeIdMap.getNodeId(node)!, nodeType: "text", text: node.nodeValue ?? ""
      } 
      return textNode;
    }
    
    case Node.DOCUMENT_NODE: {
      throw new Error("Not implemented");
    }

    case Node.DOCUMENT_FRAGMENT_NODE: {
      throw new Error("Not implemented");
    }

    case Node.ATTRIBUTE_NODE: {
      throw new Error("Not implemented");
    }

    case Node.CDATA_SECTION_NODE: {
      const cdataNode: VCDATASection = {
        id: nodeIdMap.getNodeId(node)!, nodeType: "cdata", data: node.nodeValue ?? ""
      }
      return cdataNode;
    }

    case Node.COMMENT_NODE: {
      const commentNode: VComment = {
        id: nodeIdMap.getNodeId(node)!, nodeType: "comment", data: node.nodeValue ?? ""
      }
      return commentNode;
    }

    case Node.PROCESSING_INSTRUCTION_NODE: {
      const piNode = node as ProcessingInstruction;
      const processingInstruction: VProcessingInstruction = {
        id: nodeIdMap.getNodeId(node)!, 
        nodeType: "processingInstruction", 
        target: piNode.target, 
        data: piNode.data
      }
      return processingInstruction;
    }

    case Node.DOCUMENT_TYPE_NODE: {
      const docTypeNode = node as DocumentType;
      const docType: VDocumentType = {
        id: nodeIdMap.getNodeId(node)!,
        nodeType: "documentType",
        name: docTypeNode.name,
        publicId: docTypeNode.publicId,
        systemId: docTypeNode.systemId
      }
      return docType;
    }

    case Node.NOTATION_NODE: {
      throw new Error("Not implemented");
    }

    default: {
      throw new Error("Not implemented");
    }
  }
}

// -------------------- Phase 1 (streaming variant) --------------------
function snapshotVDomStreaming(doc: Document, nodeIdMap: NodeIdBiMap): VDocument {
  const pending = new PendingAssets();

  const children = Array.from(doc.childNodes);
  const vChildren: VNode[] = [];
  for (const child of children) {
    vChildren.push(snapshotNode(child, pending, nodeIdMap));
  }

  // Handle adopted stylesheets
  const adoptedStyleSheets: VStyleSheet[] = [];
  if (doc.adoptedStyleSheets && doc.adoptedStyleSheets.length > 0) {
    for (let i = 0; i < doc.adoptedStyleSheets.length; i++) {
      const sheet = doc.adoptedStyleSheets[i];
      try {
        const rules = Array.from(sheet.cssRules);
        const text = rules.map(rule => rule.cssText).join('\n');
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
    baseURI: doc.baseURI,
    adoptedStyleSheets: adoptedStyleSheets,
    children: vChildren
  };
}

function snapshotScriptElement(el: Element, pending: PendingAssets, nodeIdMap: NodeIdBiMap): VElement {
  const vEl: VElement = {
    id: nodeIdMap.getNodeId(el)!,
    nodeType: "element",
    tag: "script",
    attrs: { },
    children: Array.from(el.childNodes).map(c => snapshotNode(c, pending, nodeIdMap))
  };
  
  for (const c of vEl.children!) {
    if (c.nodeType === "text") {
      c.text = "";
    }
  }

  return vEl;
}

function snapshotStyleElement(styleElement: Element, pending: PendingAssets, nodeIdMap: NodeIdBiMap): VElement {
  const vElement: VElement = {
    id: nodeIdMap.getNodeId(styleElement)!,
    nodeType: "element",
    tag: "style",
    attrs: { },
    children: Array.from(styleElement.childNodes).map(c => snapshotNode(c, pending, nodeIdMap))
  };
  
  const originalText = readStyleText(styleElement as HTMLStyleElement);
  if (originalText) {
    collectCssUrlsAssign(originalText, styleElement.baseURI || document.baseURI, pending);
    // Replace the text content with processed CSS
    for (const c of vElement.children!) {
      if (c.nodeType === "text") {
        c.text = originalText;
      }
    }
  }
  return vElement;
}

function snapshotLinkElement(linkElement: HTMLLinkElement, pending: PendingAssets, nodeIdMap: NodeIdBiMap): VElement {
  // Convert link element to style element with processed CSS
  let cssText: string | undefined;
  try {
    const sheet = linkElement.sheet as CSSStyleSheet | null;
    if (sheet) {
      cssText = cssRulesToText(sheet);
      if (cssText) {
        collectCssUrlsAssign(cssText, linkElement.baseURI || document.baseURI, pending);
      }
    }
  } catch (error) {
    console.warn('Failed to process stylesheet from link:', error);
  }

  // Create a style element instead of link
  const vElement: VElement = {
    id: nodeIdMap.getNodeId(linkElement)!,
    nodeType: "element",
    tag: "style",
    attrs: linkElement.media ? {
      media: linkElement.media
    } : undefined,
    children: cssText ? [{
      id: -1,
      nodeType: "text",
      text: cssText
    }] : []
  };

  return vElement;
}

function snapElement(el: Element, pending: PendingAssets, nodeIdMap: NodeIdBiMap): VElement {
  // Handling of special element types
  if (el instanceof HTMLScriptElement) {
    return snapshotScriptElement(el, pending, nodeIdMap);
  } else if (el instanceof HTMLStyleElement) {
    return snapshotStyleElement(el, pending, nodeIdMap);
  } else if (el instanceof HTMLLinkElement && el.rel === "stylesheet") {
    return snapshotLinkElement(el, pending, nodeIdMap);
  }

  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;

  // Queue asset-like attributes
  if (el instanceof HTMLImageElement) {
    const u = el.currentSrc || el.src;
    if (u) pending.assign(resolve(el, u), "image");
    if (attrs["srcset"]) assignSrcsetUrls(attrs["srcset"], el.baseURI || document.baseURI, pending);
  } else if (el instanceof HTMLLinkElement && /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(el.rel)) {
    if (el.href) pending.assign(resolve(el, el.href), "image");
  } else if (el instanceof HTMLVideoElement && el.poster) {
    pending.assign(resolve(el, el.poster), "image");
  }

  if (attrs["style"]) {
    collectCssUrlsAssign(attrs["style"], el.baseURI || document.baseURI, pending);
  }
  
  const id = nodeIdMap.getNodeId(el)!;
  const node: VElement = {
    id,
    nodeType: "element",
    tag: el.tagName.toLowerCase(),
    ns: el.namespaceURI || undefined,
    attrs: Object.keys(attrs).length ? attrs : undefined,
    children: [],
  };

  for (const child of Array.from(el.childNodes)) {
    const vChild = snapshotNode(child, pending, nodeIdMap);
    node.children!.push(vChild);
  }

  const sr = (el as HTMLElement).shadowRoot;
  if (sr) node.shadow = snapShadow(sr, pending, nodeIdMap);

  return node;
}

function snapShadow(sr: ShadowRoot, pending: PendingAssets, nodeIdMap: NodeIdBiMap): VNode[] {
  const out: VNode[] = [];
  for (const n of Array.from(sr.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) out.push({ id: nodeIdMap.getNodeId(n)!, nodeType: "text", text: n.nodeValue ?? "" });
    else if (n.nodeType === Node.ELEMENT_NODE) out.push(snapElement(n as Element, pending, nodeIdMap));
  }
  return out;
}

// Rewrite using provisional ids (before fetch)
function rewriteAllRefsToPendingIds(snap: VDocument, pending: PendingAssets) {
  // CSS - process adopted stylesheets
  snap.adoptedStyleSheets = snap.adoptedStyleSheets.map((s) => {
    if (!("text" in s) || !s.text) return s;
    const text = s.text.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g, (_m: string, q: string, raw: string) => {
      const id = idForUrl(raw, snap.baseURI, pending);
      return id ? `url(${q}asset:${id}${q})` : `url(${q}${raw}${q})`;
    });
    return { ...s, text } as VStyleSheet;
  });
  
  // Process all document children to rewrite URLs in style elements
  for (const child of snap.children) {
    if (child.nodeType === "element") {
      rewriteTreeUrlsToPendingIds(child, snap.baseURI, pending);
    }
  }
}

function rewriteTreeUrlsToPendingIds(node: VNode, base: string, pending: PendingAssets): void {
  if (node.nodeType !== "element") return;
  
  // Handle style elements specifically
  if (node.tag === "style") {
    // Process CSS content in style elements
    if (node.children) {
      for (const child of node.children) {
        if (child.nodeType === "text" && child.text) {
          child.text = child.text.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g, (_m: string, q: string, raw: string) => {
            const id = idForUrl(raw, base, pending);
            return id ? `url(${q}asset:${id}${q})` : `url(${q}${raw}${q})`;
          });
        }
      }
    }
  }
  
  if (node.attrs) {
    for (const key of ["src", "poster", "href", "xlink:href", "data-src"]) {
      const v = node.attrs[key];
      if (!v) continue;
      const id = idForUrl(v, base, pending);
      if (id) node.attrs[key] = `asset:${id}`;
    }
    if (node.attrs["srcset"]) node.attrs["srcset"] = rewriteSrcsetToPending(node.attrs["srcset"], base, pending);
    if (node.attrs["style"]) node.attrs["style"] = rewriteInlineStyleToPending(node.attrs["style"], base, pending);
  }
  node.children?.forEach((c) => rewriteTreeUrlsToPendingIds(c, base, pending));
  node.shadow?.forEach((c) => rewriteTreeUrlsToPendingIds(c, base, pending));
}

function rewriteSrcsetToPending(srcset: string, base: string, pending: PendingAssets): string {
  const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
  return parts
    .map((part) => {
      const [url, ...desc] = part.split(/\s+/);
      const id = idForUrl(url, base, pending);
      const u = id ? `asset:${id}` : url;
      return desc.length ? [u, ...desc].join(" ") : u;
    })
    .join(", ");
}

function rewriteInlineStyleToPending(css: string, base: string, pending: PendingAssets): string {
  return css.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g, (_m, q, raw) => {
    const id = idForUrl(raw, base, pending);
    return id ? `url(${q}asset:${id}${q})` : `url(${q}${raw}${q})`;
  });
}

function idForUrl(raw: string, base: string, pending: PendingAssets): number | null {
  if (/^(data:|asset:)/i.test(raw)) return null;
  const abs = safeAbs(raw, base);
  const pa = pending.byUrl.get(abs) || pending.assign(abs, guessType(abs));
  return pa.id;
}

function guessType(url: string): AssetType {
  if (/\.woff2?$/.test(url)) return "font";
  if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url)) return "image";
  return "binary";
}

// -------------------- Fetch (cache-first) --------------------

type FetchOutcome =
  | { ok: true; buf: ArrayBuffer; mime?: string }
  | { ok: false; reason: "opaque" | "network" | "http" };

async function fetchOriginalBytesAB(url: string, allowCrossOrigin: boolean): Promise<FetchOutcome> {
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    try {
      const r = await fetch(url);
      if (!r.ok) return { ok: false, reason: "http" };
      return { ok: true, buf: await r.arrayBuffer(), mime: r.headers.get("Content-Type") ?? undefined };
    } catch {
      return { ok: false, reason: "network" };
    }
  }
  try {
    const r = await fetch(url, {
      cache: "force-cache",
      mode: allowCrossOrigin ? "cors" : "same-origin",
      credentials: "include",
    } as RequestInit);
    if (r.type === "opaque") return { ok: false, reason: "opaque" };
    if (!r.ok) return { ok: false, reason: "http" };
    return { ok: true, buf: await r.arrayBuffer(), mime: r.headers.get("Content-Type") ?? undefined };
  } catch {
    return { ok: false, reason: "network" };
  }
}

// -------------------- Helpers & shared utilities --------------------
function readStyleText(styleEl: HTMLStyleElement): string {
  try {
    const sh = styleEl.sheet as CSSStyleSheet | null;
    if (sh) return cssRulesToText(sh);
  } catch {}
  return styleEl.textContent ?? "";
}

function cssRulesToText(sheet: CSSStyleSheet): string {
  return Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
}

function collectCssUrlsAssign(css: string, base: string, pending: PendingAssets) {
  const re = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const raw = m[2].trim();
    if (/^(data:|asset:)/i.test(raw)) continue;
    const abs = safeAbs(raw, base);
    pending.assign(abs, guessType(abs));
  }
}

function assignSrcsetUrls(srcset: string, base: string, pending: PendingAssets) {
  const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const [url] = part.split(/\s+/);
    pending.assign(safeAbs(url, base), "image");
  }
}

function mediaText(el: HTMLLinkElement | HTMLStyleElement): string | undefined {
  const m: any = (el as any).media;
  if (typeof m === "string") {
    const trimmed = m.trim();
    return trimmed ? trimmed : undefined;
  }
  if (m && typeof m === "object" && "mediaText" in m) {
    const trimmed = String(m.mediaText).trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}


function resolve(el: Element, url: string): string {
  try { return new URL(url, (el as any).baseURI || document.baseURI).href; } catch { return url; }
}

function safeAbs(raw: string, base: string): string {
  try { return new URL(raw, base).href; } catch { return raw; }
}

function makeId() { return Math.random().toString(36).slice(2); }

function injectAntiAnimationStyle(doc: Document): HTMLStyleElement {
  const style = doc.createElement("style");
  style.textContent = `*{animation:none!important;transition:none!important}`;
  doc.documentElement.appendChild(style);
  return style;
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

function makeSemaphore(max: number) {
  let active = 0;
  const q: Array<() => void> = [];
  const next = () => { active--; if (q.length) q.shift()!(); };
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= max) await new Promise<void>((r) => q.push(r));
      active++;
      try { return await fn(); } finally { next(); }
    },
  };
}
