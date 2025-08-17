import type { NodeIdBiMap, VCDATASection, VComment, VDocument, VDocumentType, VElement, VNode, VProcessingInstruction, VStyleSheet, VTextNode } from "../dom";
import type { Asset } from "./Asset";
import type { AssetType } from "./AssetType";
import { PendingAssets } from "./PendingAssets";

export async function fetchAssets(
  concurrency: number,
  inlineCrossOrigin: boolean,
  pendingAssets: PendingAssets,
  assetHandler: (asset: Asset) => void): Promise<void> {
  const sem = makeSemaphore(concurrency);

  let index = 0;
  await Promise.all(
    pendingAssets.order.map((pa) =>
      sem.run(async () => {
        const res = await fetchOriginalBytesAB(pa.url, inlineCrossOrigin);
        // Even on failure we advance progress; consumers can reconcile missing assets by id
        const i = ++index;
        if (res.ok) {
          assetHandler({
            id: pa.id,
            url: pa.url,
            assetType: pa.type,
            mime: res.mime,
            buf: res.buf
          });
        } else {
          // Optionally emit a separate failure event type; keeping it simple per ask
        }
      })
    )
  );
}

export function snapshotNode(node: Node, pending: PendingAssets, nodeIdMap: NodeIdBiMap): VNode {
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


function  snapshotScriptElement(el: HTMLScriptElement, pending: PendingAssets, nodeIdMap: NodeIdBiMap): VElement {
  const vEl: VElement = {
    id: nodeIdMap.getNodeId(el)!,
    nodeType: "element",
    tag: "script",
    attrs: { 
      "data-orig-src": el.src,
    },
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
    attrs: {
      "data-link-href": linkElement.href,
      ...(linkElement.media ? { media: linkElement.media } : {})
    },
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
    attrs: Object.keys(attrs).length ? attrs : {},
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
export function rewriteAllRefsToPendingIds(snap: VDocument, baseURI: string, pending: PendingAssets) {
  // CSS - process adopted stylesheets
  snap.adoptedStyleSheets = snap.adoptedStyleSheets.map((s) => {
    if (!("text" in s) || !s.text) return s;
    const text = s.text.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/g, (_m: string, q: string, raw: string) => {
      const id = idForUrl(raw, baseURI, pending);
      return id ? `url(${q}asset:${id}${q})` : `url(${q}${raw}${q})`;
    });
    return { ...s, text } as VStyleSheet;
  });
  
  // Process all document children to rewrite URLs in style elements
  for (const child of snap.children) {
    if (child.nodeType === "element") {
      rewriteTreeUrlsToPendingIds(child, baseURI, pending);
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
      if (id) {
        // Store original URL in data attribute for img elements
        if (key === "src" && node.tag === "img") {
          node.attrs["data-original-src"] = v;
        }
        node.attrs[key] = `asset:${id}`;
      }
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

export function collectCssUrlsAssign(css: string, base: string, pending: PendingAssets) {
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

function resolve(el: Element, url: string): string {
  try { return new URL(url, (el as any).baseURI || document.baseURI).href; } catch { return url; }
}

function safeAbs(raw: string, base: string): string {
  try { return new URL(raw, base).href; } catch { return raw; }
}

export function makeId() { return Math.random().toString(36).slice(2); }


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
