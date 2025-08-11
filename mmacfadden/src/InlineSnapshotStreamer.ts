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

// -------------------- Event types --------------------
export type SnapshotStartedEvt = { type: "snapshotStarted"; snapshot: VDomSnapshot };
export type AssetEvt = {
  type: "asset";
  id: number;                    // monotonic id assigned in Phase 1
  url: string;                   // resolved absolute
  assetType: AssetType;
  mime?: string;
  bytes?: number;
  buf: ArrayBuffer;              // raw data for this asset (not retained by streamer)
  index: number;                 // completion index (1..total)
  total: number;                 // total pending assets
};
export type SnapshotCompleteEvt = { type: "snapshotComplete" };
export type InlineEvent = SnapshotStartedEvt | AssetEvt | SnapshotCompleteEvt;

// Typed emitter (EventTarget-based)
class Emitter<T extends { type: string }> extends EventTarget {
  emit(payload: T) { this.dispatchEvent(new CustomEvent(payload.type, { detail: payload })); }
  on<K extends T["type"]>(type: K, fn: (ev: Extract<T, { type: K }>) => void) {
    const handler = (e: Event) => fn((e as CustomEvent).detail);
    this.addEventListener(type as string, handler as EventListener);
    return () => this.removeEventListener(type as string, handler as EventListener);
  }
}

// -------------------- Core types --------------------
export type VNode =
  | { kind: "text"; text: string }
  | {
      kind: "element";
      tag: string;
      ns?: string;
      attrs?: Record<string, string>;
      children?: VNode[];
      shadow?: VNode[]; // optional shadow DOM capture
    };

export type VStyle =
  | { kind: "inline"; id: string; media?: string; text: string }
  | { kind: "link"; id: string; media?: string; href: string; text?: string };

export type AssetType = "image" | "font" | "binary";

export interface VDomSnapshot {
  version: 3;                  // bump for zero-retention behavior
  baseURI: string;
  lang?: string | null;
  dir?: string | null;
  styles: VStyle[];
  tree: VNode;                 // rooted at <html>
  // Internal only:
  _pending?: PendingAssets;
}

type PendingAsset = { id: number; url: string; type: AssetType };
class PendingAssets {
  nextId = 1;
  byUrl = new Map<string, PendingAsset>();
  order: PendingAsset[] = [];
  assign(url: string, type: AssetType): PendingAsset {
    const existing = this.byUrl.get(url);
    if (existing) return existing;
    const pa = { id: this.nextId++, url, type };
    this.byUrl.set(url, pa);
    this.order.push(pa);
    return pa;
  }
}

// -------------------- Public streaming API --------------------
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

  constructor(doc: Document = document, opts: InlineOptions = {}) {
    this.doc = doc;
    this.opts = {
      concurrency: opts.concurrency ?? 6,
      inlineCrossOrigin: !!opts.inlineCrossOrigin,
      quietWindowMs: opts.quietWindowMs ?? 200,
      freezeAnimations: opts.freezeAnimations ?? true,
    };
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
      const snap = snapshotVDOMStreaming(doc);
      rewriteAllRefsToPendingIds(snap); // proactive rewrite

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

  private async fetchAssetsStreaming(snap: VDomSnapshot): Promise<void> {
    const sem = makeSemaphore(this.opts.concurrency);
    const pending = snap._pending!;
    const total = pending.order.length;

    let index = 0;
    await Promise.all(
      pending.order.map((pa) =>
        sem.run(async () => {
          const res = await fetchOriginalBytesAB(pa.url, this.opts.inlineCrossOrigin);
          // Even on failure we advance progress; consumers can reconcile missing assets by id
          const i = ++index;
          if (res.ok) {
            this.events.emit({
              type: "asset",
              id: pa.id,
              url: pa.url,
              assetType: pa.type,
              mime: res.mime,
              bytes: res.buf.byteLength,
              buf: res.buf,
              index: i,
              total,
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
function snapshotView(snap: VDomSnapshot): VDomSnapshot {
  const { _pending, ...pub } = snap as any;
  return pub as VDomSnapshot;
}

// -------------------- Phase 1 (streaming variant) --------------------
function snapshotVDOMStreaming(doc: Document): VDomSnapshot {
  const pending = new PendingAssets();

  const rootEl = doc.documentElement;
  const tree = snapElement(rootEl, pending);

  const styles: VStyle[] = [];
  for (const el of Array.from(doc.querySelectorAll('style,link[rel~="stylesheet"]'))) {
    if (el.tagName === "STYLE") {
      const styleEl = el as HTMLStyleElement;
      const text = readStyleText(styleEl);
      styles.push({ kind: "inline", id: makeId(), media: mediaText(styleEl), text });
      collectCssUrlsAssign(text, doc.baseURI, pending);
    } else {
      const linkEl = el as HTMLLinkElement;
      let text: string | undefined;
      try {
        const sheet = linkEl.sheet as CSSStyleSheet | null;
        if (sheet) text = cssRulesToText(sheet);
      } catch {}
      styles.push({ kind: "link", id: makeId(), media: mediaText(linkEl), href: linkEl.href, text });
      if (text) collectCssUrlsAssign(text, doc.baseURI, pending);
    }
  }

  const snap: VDomSnapshot = {
    version: 3,
    baseURI: doc.baseURI,
    lang: doc.documentElement.getAttribute("lang"),
    dir: doc.documentElement.getAttribute("dir"),
    styles,
    tree,
    _pending: pending,
  };
  return snap;
}

function snapElement(el: Element, pending: PendingAssets): VNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;

  // Queue asset-like attributes
  if (el instanceof HTMLImageElement) {
    const u = el.currentSrc || el.src;
    if (u) pending.assign(resolve(el, u), "image");
    if (attrs["srcset"]) assignSrcsetUrls(attrs["srcset"], el.baseURI || document.baseURI, pending);
  }
  if (el instanceof HTMLLinkElement && /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(el.rel)) {
    if (el.href) pending.assign(resolve(el, el.href), "image");
  }
  if (el instanceof HTMLVideoElement && el.poster) {
    pending.assign(resolve(el, el.poster), "image");
  }
  if (attrs["style"]) collectCssUrlsAssign(attrs["style"], el.baseURI || document.baseURI, pending);

  const node: VNode = {
    kind: "element",
    tag: el.tagName.toLowerCase(),
    ns: el.namespaceURI || undefined,
    attrs: Object.keys(attrs).length ? attrs : undefined,
    children: [],
  };

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) node.children!.push({ kind: "text", text: child.nodeValue ?? "" });
    else if (child.nodeType === Node.ELEMENT_NODE) node.children!.push(snapElement(child as Element, pending));
  }

  const sr = (el as HTMLElement).shadowRoot;
  if (sr) node.shadow = snapShadow(sr, pending);

  return node;
}

function snapShadow(sr: ShadowRoot, pending: PendingAssets): VNode[] {
  const out: VNode[] = [];
  for (const n of Array.from(sr.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) out.push({ kind: "text", text: n.nodeValue ?? "" });
    else if (n.nodeType === Node.ELEMENT_NODE) out.push(snapElement(n as Element, pending));
  }
  return out;
}

// Rewrite using provisional ids (before fetch)
function rewriteAllRefsToPendingIds(snap: VDomSnapshot) {
  const pending = snap._pending!;
  // CSS
  snap.styles = snap.styles.map((s) => {
    if (!("text" in s) || !s.text) return s;
    const text = s.text.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g, (_m, q, raw) => {
      const id = idForUrl(raw, snap.baseURI, pending);
      return id ? `url(${q}asset:${id}${q})` : `url(${q}${raw}${q})`;
    });
    return { ...s, text } as VStyle;
  });
  // HTML
  rewriteTreeUrlsToPendingIds(snap.tree, snap.baseURI, pending);
}

function rewriteTreeUrlsToPendingIds(node: VNode, base: string, pending: PendingAssets): void {
  if (node.kind === "text") return;
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
