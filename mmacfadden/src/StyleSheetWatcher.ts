declare global { interface CSSStyleSheet { __css_stylesheet_id__?: number } }

let __nextStyleSheetId = 1;
function ensureStyleSheetId(sheet: CSSStyleSheet): number {
  const anySheet = sheet as any;
  if (typeof anySheet.__css_stylesheet_id__ !== 'number') {
    Object.defineProperty(anySheet, "__css_stylesheet_id__", {
      value: __nextStyleSheetId++,
      configurable: false,
      writable: false,
      enumerable: false,
    });
  }
  return anySheet.__css_stylesheet_id__ as number;
}

/*
  Stylesheet Watcher — observe changes to document.styleSheets and adoptedStyleSheets

  What it does
  - Detects additions/removals/reordering in document.styleSheets (order preserved)
  - Detects changes to adoptedStyleSheets on Document and (optionally) ShadowRoots
  - Optional: emits when CSSStyleSheet content mutates via insertRule/deleteRule/replace/replaceSync
  - Works via three mechanisms you can mix & match: MutationObserver, monkey‑patching, and polling

  Quick start
  -----------
  const watcher = new StyleSheetWatcher({ pollInterval: 1000, patchCSSOM: true });
  watcher.on('document-style-sheets', e => console.log('doc sheets', e));
  watcher.on('adopted-style-sheets', e => console.log('adopted', e));
  watcher.on('sheet-rules', e => console.log('rules changed', e));
  watcher.start();
  // Optionally: watch specific ShadowRoots (manual control)
  // watcher.watchShadowRoot(someShadowRoot);
  // ... later
  // watcher.unwatchShadowRoot(someShadowRoot);
  // watcher.stop();
*/

// ---------------------------------------------------------------------------
// Tiny event emitter
// ---------------------------------------------------------------------------

type Handler<T> = (data: T) => void;
class Emitter {
  private map = new Map<string, Set<Function>>();
  on<T = any>(event: string, fn: Handler<T>) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(fn);
    return () => this.off(event, fn);
  }
  off(event: string, fn: Function) { this.map.get(event)?.delete(fn); }
  emit<T = any>(event: string, data: T) {
    this.map.get(event)?.forEach(fn => { try { (fn as Handler<T>)(data); } catch (e) { console.error(e); } });
  }
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type DocumentStyleSheetsEvent = {
  type: 'document-style-sheets';
  target: Document;
  /** Current ordered list of document.styleSheets */
  now: CSSStyleSheet[]; // ORDER MATTERS
  added: CSSStyleSheet[];
  removed: CSSStyleSheet[];
  /** True when only the order changed (membership the same) */
  orderChanged: boolean;
};

export type AdoptedStyleSheetsEvent = {
  type: 'adopted-style-sheets';
  target: Document | ShadowRoot;
  /** The new adoptedStyleSheets value (frozen by the platform, but we expose as readonly) */
  now: ReadonlyArray<CSSStyleSheet>;
  added: CSSStyleSheet[];
  removed: CSSStyleSheet[];
};

export type SheetRulesEvent = {
  type: 'sheet-rules';
  sheet: CSSStyleSheet;
  op: 'insertRule' | 'deleteRule' | 'replace' | 'replaceSync';
  args: any[];
};

export type StyleSheetWatcherEvent =
  | DocumentStyleSheetsEvent
  | AdoptedStyleSheetsEvent
  | SheetRulesEvent;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface StyleSheetWatcherOptions {
  /** Polling interval in ms (0 disables polling). Default: 1000 */
  pollInterval?: number;
  /** Use MutationObserver to watch <style>/<link> changes. Default: true */
  observeMutations?: boolean;
  /** Monkey‑patch adoptedStyleSheets setter on Document/ShadowRoot. Default: true */
  patchAdoptedSetter?: boolean;
  /** Patch CSSStyleSheet methods (insertRule/deleteRule/replace*). Default: false */
  patchCSSOM?: boolean;
  /** Document root to observe (defaults to global document). */
  root?: Document;
  /** Debounce window for events in ms (0 = no debounce). Default: 0 */
  debounceMs?: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function arrayShallowEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function toSet<T>(arr: ReadonlyArray<T>) { return new Set(arr); }

function diffSets<T>(before: Set<T>, after: Set<T>) {
  const added: T[] = []; const removed: T[] = [];
  after.forEach(v => { if (!before.has(v)) added.push(v); });
  before.forEach(v => { if (!after.has(v)) removed.push(v); });
  return { added, removed };
}

function snapshotDocumentSheets(doc: Document): CSSStyleSheet[] {
  // Preserve order — the cascade depends on it
  const arr = Array.from(doc.styleSheets) as CSSStyleSheet[];
  for (const s of arr) ensureStyleSheetId(s);
  return arr;
}

function snapshotAdopted(target: Document | ShadowRoot): ReadonlyArray<CSSStyleSheet> {
  // adoptedStyleSheets returns a frozen array; copy refs to avoid external mutation assumptions
  const arr = Array.from(target.adoptedStyleSheets);
  for (const s of arr) ensureStyleSheetId(s);
  return arr;
}

// ---------------------------------------------------------------------------
// Main watcher
// ---------------------------------------------------------------------------

export class StyleSheetWatcher {
  private opts: Required<StyleSheetWatcherOptions>;
  private emitter = new Emitter();
  private mo?: MutationObserver;
  private pollTimer?: number;

  // State for document.styleSheets
  private lastDocSheets: CSSStyleSheet[] = [];

  // State for adoptedStyleSheets per target (Document + any watched ShadowRoots)
  private lastAdopted = new Map<Document | ShadowRoot, ReadonlyArray<CSSStyleSheet>>();

  // Unpatch functions
  private unpatchFns: Array<() => void> = [];

  // Debounce + ids for per-target coalescing
  private targetIds = new WeakMap<Document | ShadowRoot, number>();
  private nextTargetId = 1;
  private debounceTimers = new Map<string, number>();
  private pendingEvents = new Map<string, any>();

  constructor(options: StyleSheetWatcherOptions = {}) {
    this.opts = {
      pollInterval: options.pollInterval ?? 0,
      observeMutations: options.observeMutations ?? true,
      patchAdoptedSetter: options.patchAdoptedSetter ?? true,
      patchCSSOM: options.patchCSSOM ?? false,
      root: options.root ?? document,
      debounceMs: options.debounceMs ?? 0,
    } as Required<StyleSheetWatcherOptions>;
  }

  on<T extends StyleSheetWatcherEvent>(event: T['type'], handler: Handler<T>) { return this.emitter.on(event, handler as any); }
  off<T extends StyleSheetWatcherEvent>(event: T['type'], handler: Handler<T>) { return this.emitter.off(event, handler as any); }

  start() {
    const doc = this.opts.root;
    // Initial snapshots
    this.lastDocSheets = snapshotDocumentSheets(doc);
    this.lastAdopted.set(doc, snapshotAdopted(doc));

    if (this.opts.observeMutations) this.setupMutationObserver(doc);
    if (this.opts.patchAdoptedSetter) this.patchAdoptedAPIs();
    if (this.opts.patchCSSOM) this.patchCSSStyleSheetMethods();
    if (this.opts.pollInterval > 0) this.startPolling();
  }

  stop() {
    this.mo?.disconnect();
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined as any; }
    this.unpatchFns.forEach(fn => { try { fn(); } catch {} });
    this.unpatchFns = [];
    // Do not clear snapshots so a restart can diff correctly; caller can new-up a fresh instance if needed
  }

  /** Begin tracking a ShadowRoot's adoptedStyleSheets. Call anytime after creation. */
  watchShadowRoot(root: ShadowRoot) {
    if (!this.lastAdopted.has(root)) this.lastAdopted.set(root, snapshotAdopted(root));
  }
  /** Stop tracking a ShadowRoot's adoptedStyleSheets. */
  unwatchShadowRoot(root: ShadowRoot) {
    this.lastAdopted.delete(root);
  }

  // -------------------------------------------------------------------------
  // Mechanisms
  // -------------------------------------------------------------------------

  private setupMutationObserver(doc: Document) {
    const mo = new MutationObserver((records) => {
      let shouldCheckDocSheets = false;
      for (const r of records) {
        if (r.type === 'childList') {
          // Check if the target (parent) is a style element
          // if so then a text node must have changed
          // so we need to check to see if the document.styleSheets have changed
          if (r.target instanceof HTMLStyleElement) {
            shouldCheckDocSheets = true;
          };

          // Check if any added/removed nodes are style/link elements
          const nodes = [...r.addedNodes, ...r.removedNodes];
          for (const n of nodes) {
            if (n instanceof HTMLStyleElement) shouldCheckDocSheets = true;
            if (n instanceof HTMLLinkElement && (n.rel || '').toLowerCase().includes('stylesheet')) {
              shouldCheckDocSheets = true;
              if (r.addedNodes && r.addedNodes.length) {
                const onDone = () => this.checkDocumentSheets();
                n.addEventListener('load', onDone, { once: true });
                n.addEventListener('error', onDone, { once: true });
              }
            }
          }
        }
        if (r.type === 'attributes') {
          const n = r.target as Element;
          if (n instanceof HTMLLinkElement && (r.attributeName === 'disabled' || r.attributeName === 'media' || r.attributeName === 'rel')) shouldCheckDocSheets = true;
          if (n instanceof HTMLStyleElement && (r.attributeName === 'media' || r.attributeName === 'disabled')) shouldCheckDocSheets = true;
        }
        if (r.type === 'characterData') {
          // Check if the text change is inside a <style> element
          let parent = r.target.parentNode;
          while (parent) {
            if (parent instanceof HTMLStyleElement) {
              shouldCheckDocSheets = true;
              break;
            }
            parent = parent.parentNode;
          }
        }
      }
      if (shouldCheckDocSheets) this.checkDocumentSheets();
    });

    mo.observe(doc.documentElement || doc, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['rel', 'disabled', 'media'],
    });
    this.mo = mo;
  }

  private startPolling() {
    this.pollTimer = window.setInterval(() => {
      this.checkDocumentSheets();
      // Check Document adopted
      this.checkAdopted(this.opts.root);
      // Check any watched ShadowRoots
      for (const [target] of this.lastAdopted) {
        if (target instanceof ShadowRoot) this.checkAdopted(target);
      }
    }, this.opts.pollInterval);
  }

  // -------------------------------------------------------------------------
  // Checks & emitters
  // -------------------------------------------------------------------------

  private checkDocumentSheets() {
    const now = snapshotDocumentSheets(this.opts.root);
    const membershipBefore = toSet(this.lastDocSheets);
    const membershipAfter = toSet(now);
    const { added, removed } = diffSets(membershipBefore, membershipAfter);
    const orderChanged = !(added.length > 0) && !(removed.length > 0) && !arrayShallowEqual(this.lastDocSheets, now);
    if (added.length || removed.length || orderChanged) {
      this.lastDocSheets = now;
      this.emitDebounced<DocumentStyleSheetsEvent>('document-style-sheets', 'doc', {
        type: 'document-style-sheets',
        target: this.opts.root,
        now,
        added,
        removed,
        orderChanged,
      });
    }
  }

  private checkAdopted(target: Document | ShadowRoot) {
    const before = this.lastAdopted.get(target) ?? [];
    const now = snapshotAdopted(target);
    const { added, removed } = diffSets(toSet(before), toSet(now));
    if (added.length || removed.length) {
      this.lastAdopted.set(target, now);
      this.emitDebounced<AdoptedStyleSheetsEvent>('adopted-style-sheets', this.getTargetKey(target), {
        type: 'adopted-style-sheets',
        target,
        now,
        added,
        removed,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Patching
  // -------------------------------------------------------------------------

  private patchAdoptedAPIs() {
    // Document.adoptedStyleSheets setter
    const docDesc = Object.getOwnPropertyDescriptor(Document.prototype as any, 'adoptedStyleSheets');
    if (docDesc?.set && docDesc.get) {
      const origSet = docDesc.set;
      const origGet = docDesc.get;
      const self = this;
      const newSet = function(this: Document, value: ReadonlyArray<CSSStyleSheet>) {
        const before = Array.from(origGet.call(this) as ReadonlyArray<CSSStyleSheet>);
        origSet.call(this, value);
        const now = Array.from(origGet.call(this) as ReadonlyArray<CSSStyleSheet>);
        now.forEach(ensureStyleSheetId);
        const { added, removed } = diffSets(toSet(before), toSet(now));
        if (added.length || removed.length) {
          self.lastAdopted.set(this, now);
          self.emitDebounced<AdoptedStyleSheetsEvent>('adopted-style-sheets', self.getTargetKey(this), {
            type: 'adopted-style-sheets', target: this, now, added, removed,
          });
        }
      } as typeof docDesc.set;
      Object.defineProperty(Document.prototype, 'adoptedStyleSheets', { ...docDesc, set: newSet });
      this.unpatchFns.push(() => Object.defineProperty(Document.prototype, 'adoptedStyleSheets', docDesc));
    }

    // ShadowRoot.adoptedStyleSheets setter
    const srDesc = Object.getOwnPropertyDescriptor(ShadowRoot.prototype as any, 'adoptedStyleSheets');
    if (srDesc?.set && srDesc.get) {
      const origSet = srDesc.set;
      const origGet = srDesc.get;
      const self = this;
      const newSet = function(this: ShadowRoot, value: ReadonlyArray<CSSStyleSheet>) {
        const before = Array.from(origGet!.call(this) as ReadonlyArray<CSSStyleSheet>);
        origSet!.call(this, value);
        const now = Array.from(origGet!.call(this) as ReadonlyArray<CSSStyleSheet>);
        now.forEach(ensureStyleSheetId);
        const { added, removed } = diffSets(toSet(before), toSet(now));
        if (added.length || removed.length) {
          self.lastAdopted.set(this, now);
          self.emitDebounced<AdoptedStyleSheetsEvent>('adopted-style-sheets', self.getTargetKey(this), {
            type: 'adopted-style-sheets', target: this, now, added, removed,
          });
        }
      } as typeof srDesc.set;
      Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', { ...srDesc, set: newSet });
      this.unpatchFns.push(() => Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', srDesc));
    }
  }

  private patchCSSStyleSheetMethods() {
    const proto = CSSStyleSheet.prototype as any;
    const wrap = <K extends keyof CSSStyleSheet>(key: K, cb: (sheet: CSSStyleSheet, args: any[]) => void) => {
      const orig = (proto as any)[key] as Function;
      if (typeof orig !== 'function') return;
      (proto as any)[key] = function(this: CSSStyleSheet, ...args: any[]) {
        const result = orig.apply(this, args);
        try { ensureStyleSheetId(this); } catch {}
        try { cb(this, args); } catch {}
        return result;
      };
      this.unpatchFns.push(() => { (proto as any)[key] = orig; });
    };

    wrap('insertRule', (sheet, args) => this.emitter.emit<SheetRulesEvent>('sheet-rules', { type: 'sheet-rules', sheet, op: 'insertRule', args }));
    wrap('deleteRule', (sheet, args) => this.emitter.emit<SheetRulesEvent>('sheet-rules', { type: 'sheet-rules', sheet, op: 'deleteRule', args }));
    wrap('replace', (sheet, args) => this.emitter.emit<SheetRulesEvent>('sheet-rules', { type: 'sheet-rules', sheet, op: 'replace', args }));
    wrap('replaceSync', (sheet, args) => this.emitter.emit<SheetRulesEvent>('sheet-rules', { type: 'sheet-rules', sheet, op: 'replaceSync', args }));
  }

  // -------------------------------------------------------------------------
  // Debounced emitter helpers
  // -------------------------------------------------------------------------

  private getTargetKey(target: Document | ShadowRoot) {
    let id = this.targetIds.get(target);
    if (!id) { id = this.nextTargetId++; this.targetIds.set(target, id); }
    return 'adopted:' + id;
  }

  private emitDebounced<T extends StyleSheetWatcherEvent>(type: T['type'], key: string, payload: T) {
    if (this.opts.debounceMs <= 0) { this.emitter.emit(type, payload as any); return; }
    this.pendingEvents.set(key, payload);
    const prev = this.debounceTimers.get(key);
    if (prev) clearTimeout(prev);
    const timer = window.setTimeout(() => {
      const p = this.pendingEvents.get(key);
      this.pendingEvents.delete(key);
      this.debounceTimers.delete(key);
      this.emitter.emit(type, p as any);
    }, this.opts.debounceMs);
    this.debounceTimers.set(key, timer);
  }
}

// Convenience helper
export function watchAll(opts: Partial<StyleSheetWatcherOptions> = {}) {
  const w = new StyleSheetWatcher({ pollInterval: 1000, observeMutations: true, patchAdoptedSetter: true, patchCSSOM: false, debounceMs: 0, ...opts });
  w.start();
  return w;
}
