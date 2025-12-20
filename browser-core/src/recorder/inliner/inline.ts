import {
  VNode,
  VCDATASection,
  VComment,
  VDocument,
  VDocumentType,
  VElement,
  VProcessingInstruction,
  VStyleSheet,
  VTextNode
} from "@domcorder/proto-ts";
import type { NodeIdBiMap } from "../../common";
import type { Asset } from "./Asset";
import { AssetTracker } from "./AssetTracker";

export async function fetchAssets(
  concurrency: number,
  inlineCrossOrigin: boolean,
  assetTracker: AssetTracker,
  assetHandler: (asset: Asset) => void): Promise<void> {
  const sem = makeSemaphore(concurrency);

  let index = 0;
  await Promise.all(
    assetTracker.take().map((pa) =>
      sem.run(async () => {
        const partialAsset: Partial<Asset> = {
          id: pa.id,
          url: pa.url,
          mime: pa.mime,
          buf: pa.data,
        };

        if (!partialAsset.buf) {
          try {
            const res = await fetchOriginalBytesAB(pa.url, inlineCrossOrigin);
            // Even on failure we advance progress; consumers can reconcile missing assets by id
            const i = ++index;
            if (res.ok) {
              partialAsset.mime = res.mime;
              partialAsset.buf = res.buf;
              partialAsset.fetchError = { type: 'none' };
            } else {
              // Map fetch failure reason to fetch_error
              if (res.reason === 'opaque') {
                partialAsset.fetchError = { type: 'cors' };
              } else if (res.reason === 'network') {
                partialAsset.fetchError = { type: 'network' };
              } else if (res.reason === 'http') {
                partialAsset.fetchError = { type: 'http' };
              } else {
                partialAsset.fetchError = { type: 'unknown', message: res.reason || 'unexpected error' };
              }
              partialAsset.buf = new ArrayBuffer(0);
            }
          } catch (error) {
            console.error('Error fetching asset:', error);
            partialAsset.fetchError = { 
              type: 'unknown', 
              message: error instanceof Error ? error.message : String(error) 
            };
            partialAsset.buf = new ArrayBuffer(0);
          }

          if (!partialAsset.buf) {
            partialAsset.buf = new ArrayBuffer(0);
          }
        } else {
          // Asset already has data (from snapshot), no fetch error
          partialAsset.fetchError = { type: 'none' };
        }

        assetHandler(partialAsset as Asset);
      })
    )
  );
}

export function snapshotNode(node: Node, assetTracker: AssetTracker, nodeIdMap: NodeIdBiMap): VNode {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      return snapElement(node as Element, assetTracker, nodeIdMap);
    }

    case Node.TEXT_NODE: {
      return new VTextNode(
        nodeIdMap.getNodeId(node)!,
        node.nodeValue ?? ""
      );
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
      return new VCDATASection(
        nodeIdMap.getNodeId(node)!,
        node.nodeValue ?? ""
      );
    }

    case Node.COMMENT_NODE: {
      return new VComment(
        nodeIdMap.getNodeId(node)!,
        node.nodeValue ?? ""
      );
    }

    case Node.PROCESSING_INSTRUCTION_NODE: {
      const piNode = node as ProcessingInstruction;
      return new VProcessingInstruction(
        nodeIdMap.getNodeId(node)!,
        piNode.target,
        piNode.data
      );
    }

    case Node.DOCUMENT_TYPE_NODE: {
      const docTypeNode = node as DocumentType;
      return new VDocumentType(
        nodeIdMap.getNodeId(node)!,
        docTypeNode.name,
        docTypeNode.publicId || undefined,
        docTypeNode.systemId || undefined
      );
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


function snapshotScriptElement(el: HTMLScriptElement, assetTracker: AssetTracker, nodeIdMap: NodeIdBiMap): VElement {
  const children = Array.from(el.childNodes).map(c => snapshotNode(c, assetTracker, nodeIdMap));

  // Clear text content from script children
  for (const c of children) {
    if (c.nodeType === "text") {
      (c as VTextNode).text = "";
    }
  }

  return new VElement(
    nodeIdMap.getNodeId(el)!,
    "script",
    undefined,
    { "data-orig-src": el.src },
    children
  );
}

function snapshotStyleElement(styleElement: Element, assetTracker: AssetTracker, nodeIdMap: NodeIdBiMap): VElement {
  const children = Array.from(styleElement.childNodes).map(c => snapshotNode(c, assetTracker, nodeIdMap));

  const originalText = readStyleText(styleElement as HTMLStyleElement);
  if (originalText) {
    collectCssUrlsAssign(originalText, styleElement.baseURI || document.baseURI, assetTracker);
    // Replace the text content with processed CSS
    for (const c of children) {
      if (c.nodeType === "text") {
        (c as VTextNode).text = originalText;
      }
    }
  }

  return new VElement(
    nodeIdMap.getNodeId(styleElement)!,
    "style",
    undefined,
    {},
    children
  );
}

function snapshotLinkElement(
  linkElement: HTMLLinkElement,
  assetTracker: AssetTracker,
  nodeIdMap: NodeIdBiMap
): VElement {
  
  const attrs: Record<string, string> = {};
  for (const attr of linkElement.attributes as NamedNodeMap){
    attrs[attr.name] = attr.value;
  }

  // Convert link element to style element with processed CSS
  let cssText: string | undefined;
  try {
    const sheet = linkElement.sheet as CSSStyleSheet | null;
    if (sheet) {
      cssText = cssRulesToText(sheet);
      if (cssText) {
        collectCssUrlsAssign(cssText, linkElement.baseURI || document.baseURI, assetTracker);
      }
    }
  } catch (error) {
    console.warn('Failed to process stylesheet from link:', error);
  }


  let data: ArrayBuffer | undefined;
  if (cssText) {
    cssText = rewriteUrlsInCssText(cssText, linkElement.baseURI || document.baseURI, assetTracker);
    data = cssText ? new TextEncoder().encode(cssText).buffer as ArrayBuffer : undefined;
  }
  
  const asset = assetTracker.assign(linkElement.href, data, "text/css");

  return new VElement(
    nodeIdMap.getNodeId(linkElement)!,
    "link",
    undefined,
    {
      ...attrs,
      "href": `asset:${asset.id}`,
      "data-link-href": linkElement.href,
    },
    []
  );
}

function snapshotPrefetchLinkElement(
  linkElement: HTMLLinkElement,
  nodeIdMap: NodeIdBiMap
): VElement {
  // Resource hints (prefetch, preload, modulepreload, dns-prefetch, preconnect, prerender) 
  // are just performance optimizations - they don't affect rendering.
  // Preserve the original attributes for reference but don't collect as assets
  const attrs: Record<string, string> = {};
  for (const attr of linkElement.attributes as NamedNodeMap) {
    attrs[attr.name] = attr.value;
  }

  return new VElement(
    nodeIdMap.getNodeId(linkElement)!,
    "link",
    undefined,
    {
      ...attrs,
      "data-orig-rel": linkElement.rel,
      "data-orig-href": linkElement.href,
      // Remove the href to prevent any asset collection or fetching
      "href": "",
      // Remove rel to prevent browser from acting on it during playback
      "rel": "",
    },
    []
  );
}

function snapElement(el: Element, assetTracker: AssetTracker, nodeIdMap: NodeIdBiMap): VElement {
  // Handling of special element types
  if (el instanceof HTMLScriptElement) {
    return snapshotScriptElement(el, assetTracker, nodeIdMap);
  } else if (el instanceof HTMLStyleElement) {
    return snapshotStyleElement(el, assetTracker, nodeIdMap);
  } else if (el instanceof HTMLLinkElement && el.rel === "stylesheet") {
    return snapshotLinkElement(el, assetTracker, nodeIdMap);
  } else if (el instanceof HTMLLinkElement && /(^|\s)(prefetch|preload|modulepreload|dns-prefetch|preconnect|prerender)(\s|$)/i.test(el.rel)) {
    // Handle resource hints - they're just performance optimizations, not assets
    return snapshotPrefetchLinkElement(el, nodeIdMap);
  }

  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;

  // Queue asset-like attributes
  if (el instanceof HTMLImageElement) {
    const u = el.currentSrc || el.src;
    if (u) assetTracker.assign(resolve(el, u));
    if (attrs["srcset"]) assignSrcsetUrls(attrs["srcset"], el.baseURI || document.baseURI, assetTracker);
  } else if (el instanceof HTMLLinkElement && /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(el.rel)) {
    if (el.href) assetTracker.assign(resolve(el, el.href));
  } else if (el instanceof HTMLVideoElement && el.poster) {
    assetTracker.assign(resolve(el, el.poster));
  }

  if (attrs["style"]) {
    collectCssUrlsAssign(attrs["style"], el.baseURI || document.baseURI, assetTracker);
  }

  const id = nodeIdMap.getNodeId(el)!;
  const children: VNode[] = [];

  for (const child of Array.from(el.childNodes)) {
    const vChild = snapshotNode(child, assetTracker, nodeIdMap);
    children.push(vChild);
  }

  // TODO perhaps we should set a default at the document level, instead of
  // assuming we know what the default is.
  let ns: string | undefined;  
  if (el.namespaceURI && el.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
    ns = el.namespaceURI;
  }

  const node = new VElement(
    id,
    el.tagName.toLowerCase(),
    ns,
    Object.keys(attrs).length ? attrs : {},
    children
  );

  const sr = (el as HTMLElement).shadowRoot;
  if (sr) node.shadow = snapShadow(sr, assetTracker, nodeIdMap);

  return node;
}

function snapShadow(sr: ShadowRoot, assetTracker: AssetTracker, nodeIdMap: NodeIdBiMap): VNode[] {
  const out: VNode[] = [];
  for (const n of Array.from(sr.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) out.push({ id: nodeIdMap.getNodeId(n)!, nodeType: "text", text: n.nodeValue ?? "" } as VTextNode);
    else if (n.nodeType === Node.ELEMENT_NODE) out.push(snapElement(n as Element, assetTracker, nodeIdMap));
  }
  return out;
}

function rewriteUrlsInCssText(cssText: string, baseURI: string, assetTracker: AssetTracker) {
  return cssText.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g, (_m: string, q: string, raw: string) => {
    const id = idForUrl(raw, baseURI, assetTracker);
    return id ? `url(${q}asset:${id}${q})` : `url(${q}${raw}${q})`;
  });
}

export function rewriteStyleSheetsToAssetIds(stylesheet: VStyleSheet, baseURI: string, assetTracker: AssetTracker) {
  if (!("text" in stylesheet) || !stylesheet.text) return stylesheet;
    
  const text = rewriteUrlsInCssText(stylesheet.text, baseURI, assetTracker);

  return new VStyleSheet(stylesheet.id, text, stylesheet.media);
}

// Rewrite using provisional ids (before fetch)
export function rewriteAllRefsToAssetIds(snap: VDocument, baseURI: string, assetTracker: AssetTracker) {
  // CSS - process adopted stylesheets
  snap.adoptedStyleSheets = snap.adoptedStyleSheets.map((s) => {
    return rewriteStyleSheetsToAssetIds(s, baseURI, assetTracker);
  });

  // Process all document children to rewrite URLs in style elements
  for (const child of snap.children) {
    if (child.nodeType === "element") {
      rewriteTreeUrlsToAssetIds(child, baseURI, assetTracker);
    }
  }
}

export function rewriteTreeUrlsToAssetIds(node: VNode, base: string, assetTracker: AssetTracker): void {
  if (!(node instanceof VElement)) return;

  // Handle style elements specifically
  if (node.tag === "style") {
    // Process CSS content in style elements
    if (node.children) {
      for (const child of node.children) {
        if (child instanceof VTextNode && child.text) {
          child.text = rewriteUrlsInCssText(child.text, base, assetTracker);
        }
      }
    }
  }

  if (node.attrs) {
    for (const key of ["src", "poster", "href", "xlink:href", "data-src"]) {
      const v = node.attrs[key];
      if (!v) continue;
      const id = idForUrl(v, base, assetTracker);
      if (id) {
        // Store original URL in data attribute for img elements
        if (key === "src" && node.tag === "img") {
          node.attrs["data-original-src"] = v;
        }
        node.attrs[key] = `asset:${id}`;
      }
    }
    if (node.attrs["srcset"]) node.attrs["srcset"] = rewriteSrcsetToAsset(node.attrs["srcset"], base, assetTracker);
    if (node.attrs["style"]) node.attrs["style"] = rewriteInlineStyleToAsset(node.attrs["style"], base, assetTracker);
  }
  node.children?.forEach((c) => rewriteTreeUrlsToAssetIds(c, base, assetTracker));
  node.shadow?.forEach((c) => rewriteTreeUrlsToAssetIds(c, base, assetTracker));
}

function rewriteSrcsetToAsset(srcset: string, base: string, assetTracker: AssetTracker): string {
  const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
  return parts
    .map((part) => {
      const [url, ...desc] = part.split(/\s+/);
      const id = idForUrl(url, base, assetTracker);
      const u = id ? `asset:${id}` : url;
      return desc.length ? [u, ...desc].join(" ") : u;
    })
    .join(", ");
}

function rewriteInlineStyleToAsset(css: string, base: string, assetTracker: AssetTracker): string {
  return css.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g, (_m, q, raw) => {
    const id = idForUrl(raw, base, assetTracker);
    return id ? `url(${q}asset:${id}${q})` : `url(${q}${raw}${q})`;
  });
}

function idForUrl(raw: string, base: string, assetTracker: AssetTracker): number | null {
  if (/^(data:|asset:)/i.test(raw)) return null;
  const abs = safeAbs(raw, base);
  const pa = assetTracker.get(abs) || assetTracker.assign(abs);
  return pa.id;
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
  } catch { }
  return styleEl.textContent ?? "";
}

function cssRulesToText(sheet: CSSStyleSheet): string {
  return Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
}

export function collectCssUrlsAssign(css: string, base: string, assetTracker: AssetTracker) {
  const re = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const raw = m[2].trim();
    if (/^(data:|asset:)/i.test(raw)) continue;
    const abs = safeAbs(raw, base);
    assetTracker.assign(abs);
  }
}

function assignSrcsetUrls(srcset: string, base: string, assetTracker: AssetTracker) {
  const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const [url] = part.split(/\s+/);
    assetTracker.assign(safeAbs(url, base));
  }
}

function resolve(el: Element, url: string): string {
  try { return new URL(url, (el as any).baseURI || document.baseURI).href; } catch { return url; }
}

function safeAbs(raw: string, base: string): string {
  try { return new URL(raw, base).href; } catch { return raw; }
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
