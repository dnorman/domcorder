/** ---------- Types ---------- */

export interface LineRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

type AtomicTag =
  | 'IMG' | 'VIDEO' | 'CANVAS' | 'SVG' | 'IFRAME' | 'OBJECT' | 'EMBED'
  | 'INPUT' | 'TEXTAREA' | 'BUTTON' | 'SELECT' | 'MATH';

export interface GetSelectionRectsOptions {
  /** Ignore tiny fragments and act as tolerance when merging/line grouping. Default: 0.5 */
  epsilon?: number;
  /** Merge horizontally touching/overlapping rects (per line). Default: true */
  merge?: boolean;
  /** Include rects for atomic/replaceable elements (IMG, VIDEO, etc.). Default: true */
  includeAtomic?: boolean;
  /** Normalize each line so all rects share the line’s top/bottom. Strongly recommended. Default: true */
  normalizeLineHeights?: boolean;
}

export interface DrawRangeOverlaysOptions extends GetSelectionRectsOptions {
  /** Where to append overlay elements. Default: document.body */
  container?: HTMLElement;
  /** CSS class for each overlay. Default: 'selection-overlay' */
  className?: string;
  /** Stacking order. Default: 9999 */
  zIndex?: number | string;
  /**
   * 'fixed' aligns with viewport-based client rects (best match).
   * 'absolute' converts to page coords (adds scrollX/scrollY).
   * Default: 'fixed'
   */
  position?: 'fixed' | 'absolute';
}

export interface DrawRangeOverlaysResult {
  rects: LineRect[];
  elements: HTMLDivElement[];
  remove: () => void;
}

/** ---------- Public API ---------- */

/**
 * Visual selection rects for a Range:
 * - text node fragments only (no element box inflation),
 * - plus atomic inline elements (IMG, etc.),
 * - normalized to line box height,
 * - optionally merged horizontally.
 */
export function getSelectionVisualRects(
  range: Range,
  {
    epsilon = 0.5,
    merge = true,
    includeAtomic = true,
    normalizeLineHeights: normalize = true
  }: GetSelectionRectsOptions = {}
): LineRect[] {
  if (!range || range.collapsed) return [];

  // 1) Collect text subranges that intersect + (optionally) atomic element rects.
  const rects: LineRect[] = [];
  collectTextRects(range, rects, epsilon);
  if (includeAtomic) collectAtomicRects(range, rects, epsilon);

  if (rects.length === 0) return [];

  // 2) Normalize per line so all rects on the same visual line share identical top/bottom.
  const normalized = normalize ? normalizePerLine(rects, epsilon) : rects;

  // 3) Merge horizontally within each line to reduce fragment count.
  return merge ? mergeLineRects(normalized, epsilon) : normalized;
}

/**
 * Draw translucent overlays that recreate the browser’s selection for the given Range.
 */
export function drawRangeOverlays(
  range: Range,
  {
    container = document.body,
    className = 'selection-overlay',
    zIndex = 9999,
    position = 'fixed',
    epsilon = 0.5,
    merge = true,
    includeAtomic = true,
    normalizeLineHeights: normalize = true
  }: DrawRangeOverlaysOptions = {}
): DrawRangeOverlaysResult {
  const rects = getSelectionVisualRects(range, {
    epsilon,
    merge,
    includeAtomic,
    normalizeLineHeights: normalize
  });

  const els: HTMLDivElement[] = [];
  for (const r of rects) {
    const el = document.createElement('div');
    el.className = className;
    el.style.position = position;
    el.style.pointerEvents = 'none';
    el.style.zIndex = String(zIndex);
    // Selection-like look; tweak as desired:
    el.style.background = 'rgba(56, 132, 255, 0.35)';
    el.style.borderRadius = '2px';

    const left = position === 'absolute' ? r.left + window.scrollX : r.left;
    const top = position === 'absolute' ? r.top + window.scrollY : r.top;

    // Avoid rounding if you want sub-pixel parity
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.width = `${Math.round(r.right - r.left)}px`;
    el.style.height = `${Math.round(r.bottom - r.top)}px`;

    container.appendChild(el);
    els.push(el);
  }

  return {
    rects,
    elements: els,
    remove() {
      for (const el of els) el.remove();
      els.length = 0;
    }
  };
}

/** ---------- Internals ---------- */

/** Robust range–node intersection (covers engines where intersectsNode is missing/quirky). */
function rangeIntersectsNode(range: Range, node: Node): boolean {
  if (typeof (range as any).intersectsNode === 'function') {
    try { 
      return (range as any).intersectsNode(node); 
    } catch { /* fall through */ }
  }
  const test = document.createRange();
  try {
    if (node.nodeType === Node.TEXT_NODE) test.selectNodeContents(node);
    else test.selectNode(node);
    return (
      range.compareBoundaryPoints(Range.END_TO_START, test) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, test) > 0
    );
  } finally { test.detach?.(); }
}

/** Collect rects for the *text-only* portions intersecting the range (handles single-text-node case). */
function collectTextRects(range: Range, out: LineRect[], epsilon: number): void {
  // Special case: entirely within one Text node
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = range.startContainer as Text;
    if (range.startOffset !== range.endOffset) {
      const sub = document.createRange();
      sub.setStart(text, Math.min(range.startOffset, text.length));
      sub.setEnd(text, Math.min(range.endOffset, text.length));
      pushRects(sub.getClientRects(), out, epsilon);
      sub.detach?.();
    }
    return;
  }

  // Walk all intersecting text nodes under the common ancestor
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node: Node) =>
        rangeIntersectsNode(range, node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
    } as any
  );

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const tn = n as Text;
    if (!tn.data || tn.length === 0) continue;

    const sub = document.createRange();
    sub.setStart(tn, range.startContainer === tn ? Math.min(range.startOffset, tn.length) : 0);
    sub.setEnd(tn, range.endContainer === tn ? Math.min(range.endOffset, tn.length) : tn.length);

    if (!sub.collapsed) pushRects(sub.getClientRects(), out, epsilon);
    sub.detach?.();
  }
}

/** Include atomic/replaceable inline elements the native selection paints as whole boxes. */
function collectAtomicRects(range: Range, out: LineRect[], epsilon: number): void {
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node: Node) => {
        const el = node as Element;
        if (!isAtomicElement(el)) return NodeFilter.FILTER_SKIP;
        return rangeIntersectsNode(range, el)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    } as any
  );

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n as Element;
    // Ignore hidden elements (no client rects)
    const cr = el.getClientRects();
    if (!cr || cr.length === 0) continue;
    pushRects(cr, out, epsilon);
  }
}

/** Heuristic: is an element “atomic” for selection purposes? */
function isAtomicElement(el: Element): boolean {
  const t = el.tagName as AtomicTag | string;
  const ATOMIC = new Set<AtomicTag>([
    'IMG','VIDEO','CANVAS','SVG','IFRAME','OBJECT','EMBED',
    'INPUT','TEXTAREA','BUTTON','SELECT','MATH'
  ]);
  if (ATOMIC.has(t as AtomicTag)) return true;

  // Heuristic fallback: inline/inline-block with no text descendants (icons, etc.)
  const cs = getComputedStyle(el);
  if ((cs.display === 'inline' || cs.display === 'inline-block') && !hasTextDescendant(el)) {
    return true;
  }
  return false;
}

function hasTextDescendant(el: Element): boolean {
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  return !!tw.nextNode();
}

/** Utility: push rects from a DOMRectList into our plain LineRect array, skipping tiny fragments. */
function pushRects(source: DOMRectList | DOMRect[], out: LineRect[], epsilon: number): void {
  for (let i = 0; i < source.length; i++) {
    const r = source[i]!;
    if (r.width <= epsilon || r.height <= epsilon) continue;
    out.push({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height
    });
  }
}

/** Group rects into visual lines by vertical overlap / proximity. */
function groupIntoLines(rects: LineRect[], epsilon: number): LineRect[][] {
  if (rects.length <= 1) return [rects.slice()];
  const sorted = rects.slice().sort((a, b) => (a.top - b.top) || (a.left - b.left));
  const lines: LineRect[][] = [];

  for (const r of sorted) {
    let placed = false;
    for (const line of lines) {
      const lt = Math.min(...line.map(x => x.top));
      const lb = Math.max(...line.map(x => x.bottom));
      const overlap = Math.min(lb, r.bottom) - Math.max(lt, r.top);
      const minH = Math.min(r.height, lb - lt);
      // enough vertical overlap or near-aligned → same visual line
      if (overlap >= Math.max(1, minH * 0.4) || Math.abs(r.top - lt) < epsilon || Math.abs(r.bottom - lb) < epsilon) {
        line.push(r);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([r]);
  }
  return lines;
}

/** Normalize each line so every rect shares the line box height (min top, max bottom). */
function normalizePerLine(rects: LineRect[], epsilon: number): LineRect[] {
  const lines = groupIntoLines(rects, epsilon);
  const out: LineRect[] = [];
  for (const line of lines) {
    const lineTop = Math.min(...line.map(r => r.top));
    const lineBottom = Math.max(...line.map(r => r.bottom));
    const lineHeight = lineBottom - lineTop;
    for (const r of line) {
      out.push({
        left: r.left,
        right: r.right,
        top: lineTop,
        bottom: lineBottom,
        width: r.right - r.left,
        height: lineHeight
      });
    }
  }
  return out;
}

/** Merge rects sharing the same line (same top/bottom) and touching/overlapping horizontally. */
function mergeLineRects(rects: LineRect[], epsilon: number): LineRect[] {
  if (rects.length <= 1) return rects.slice();

  // We assume rects are already normalized; identical top/bottom identifies a line
  rects.sort((a, b) => (a.top - b.top) || (a.left - b.left));

  type Line = { top: number; bottom: number; items: LineRect[] };
  const lines: Line[] = [];
  for (const r of rects) {
    let g = lines.find(l => Math.abs(l.top - r.top) < epsilon && Math.abs(l.bottom - r.bottom) < epsilon);
    if (!g) { g = { top: r.top, bottom: r.bottom, items: [] }; lines.push(g); }
    g.items.push(r);
  }

  const merged: LineRect[] = [];
  for (const g of lines) {
    g.items.sort((a, b) => a.left - b.left);
    let cur = { ...g.items[0] };
    for (let i = 1; i < g.items.length; i++) {
      const next = g.items[i];
      const touches = next.left <= cur.right + epsilon; // overlap or tiny gap
      if (touches) {
        cur.left = Math.min(cur.left, next.left);
        cur.right = Math.max(cur.right, next.right);
        cur.width = cur.right - cur.left;
      } else {
        merged.push(cur);
        cur = { ...next };
      }
    }
    merged.push(cur);
  }
  return merged;
}