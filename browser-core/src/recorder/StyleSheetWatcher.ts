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

export function getStyleSheetId(sheet: CSSStyleSheet): number {
  const anySheet = sheet as any;
  if (typeof anySheet.__css_stylesheet_id__ !== 'number') {
    ensureStyleSheetId(sheet);
  }
  return anySheet.__css_stylesheet_id__ as number;
}

/*
  Stylesheet Watcher — observe changes to document.styleSheets and adoptedStyleSheets

  What it does
  - Detects additions/removals/reordering in document.styleSheets (order preserved)
  - Detects changes to adoptedStyleSheets on Document and (optionally) ShadowRoots
  - Optional: emits when CSSStyleSheet content mutates via insertRule/deleteRule/replace/replaceSync
    - 'sheet-rules-insert' for insertRule operations
    - 'sheet-rules-delete' for deleteRule operations  
    - 'sheet-rules-replace' for replace and replaceSync operations
  - Works via three mechanisms you can mix & match: MutationObserver, monkey‑patching, and polling

  Quick start
  -----------
  const watcher = new StyleSheetWatcher({ 
    pollInterval: 1000, 
    patchCSSOM: true,
    handler: (events) => {
      events.forEach(event => {
        switch (event.type) {
          case 'document-style-sheets':
            console.log('doc sheets', event);
            break;
          case 'adopted-style-sheets':
            console.log('adopted', event);
            break;
          case 'sheet-rules-insert':
            console.log('rules inserted', event);
            break;
          case 'sheet-rules-delete':
            console.log('rules deleted', event);
            break;
          case 'sheet-rules-replace':
            console.log('rules replaced', event);
            break;
        }
      });
    }
  });
  watcher.start();
  // Optionally: watch specific ShadowRoots (manual control)
  // watcher.watchShadowRoot(someShadowRoot);
  // ... later
  // watcher.unwatchShadowRoot(someShadowRoot);
  // watcher.stop();
*/



// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type DocumentStyleSheetsEvent = {
  type: 'document-style-sheets';
  target: Document;
  /** Current ordered list of document.styleSheets */
  now: ReadonlyArray<CSSStyleSheet>; // ORDER MATTERS
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

export type SheetRulesInsertEvent = {
  type: 'sheet-rules-insert';
  sheet: CSSStyleSheet;
  rule: string;
  index?: number;
};

export type SheetRulesDeleteEvent = {
  type: 'sheet-rules-delete';
  sheet: CSSStyleSheet;
  index: number;
};

export type SheetRulesReplaceEvent = {
  type: 'sheet-rules-replace';
  sheet: CSSStyleSheet;
  text: string;
};

export type StyleSheetWatcherEvent =
  | DocumentStyleSheetsEvent
  | AdoptedStyleSheetsEvent
  | SheetRulesInsertEvent
  | SheetRulesDeleteEvent
  | SheetRulesReplaceEvent;

export type StyleSheetWatcherEventHandler = (operations: StyleSheetWatcherEvent) => void;

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
  /** Handler function to receive events */
  handler?: StyleSheetWatcherEventHandler;
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
  private handler?: StyleSheetWatcherEventHandler;
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
    this.handler = options.handler;
  }

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
  // Utilities
  // -------------------------------------------------------------------------

  private isStyleSheetAttached(sheet: CSSStyleSheet): boolean {
    // Check if it's in document.styleSheets
    const docSheets = Array.from(this.opts.root.styleSheets);
    if (docSheets.includes(sheet)) return true;

    // Check if it's in document.adoptedStyleSheets
    const docAdopted = Array.from(this.opts.root.adoptedStyleSheets);
    if (docAdopted.includes(sheet)) return true;

    // Check if it's in any watched ShadowRoot's adoptedStyleSheets
    for (const [target] of this.lastAdopted) {
      if (target instanceof ShadowRoot) {
        const shadowAdopted = Array.from(target.adoptedStyleSheets);
        if (shadowAdopted.includes(sheet)) return true;
      }
    }

    return false;
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
      if (typeof orig !== 'function') {
        console.warn(`StyleSheetWatcher: CSSStyleSheet.${key} is not available`);
        return;
      }
      (proto as any)[key] = function(this: CSSStyleSheet, ...args: any[]) {
        const result = orig.apply(this, args);
        try { ensureStyleSheetId(this); } catch {}
        try { cb(this, args); } catch {}
        return result;
      };
      this.unpatchFns.push(() => { (proto as any)[key] = orig; });
    };

    wrap('insertRule', (sheet, args) => {
      if (this.isStyleSheetAttached(sheet)) {
        this.emitEvent({ type: 'sheet-rules-insert', sheet, rule: args[0], index: args[1] });
      }
    });
    wrap('deleteRule', (sheet, args) => {
      if (this.isStyleSheetAttached(sheet)) {
        this.emitEvent({ type: 'sheet-rules-delete', sheet, index: args[0] });
      }
    });
    wrap('replace', (sheet, args) => {
      if (this.isStyleSheetAttached(sheet)) {
        this.emitEvent({ type: 'sheet-rules-replace', sheet, text: args[0] });
      }
    });
    wrap('replaceSync', (sheet, args) => {
      if (this.isStyleSheetAttached(sheet)) {
        this.emitEvent({ type: 'sheet-rules-replace', sheet, text: args[0] });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  private emitEvent(event: StyleSheetWatcherEvent) {
    if (this.handler) {
      try {
        this.handler(event);
      } catch (e) {
        console.error('Error in StyleSheetWatcher handler:', e);
      }
    } else {
      console.warn('StyleSheetWatcher: No handler registered for event:', event.type);
    }
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
    if (this.opts.debounceMs <= 0) { this.emitEvent(payload); return; }
    this.pendingEvents.set(key, payload);
    const prev = this.debounceTimers.get(key);
    if (prev) clearTimeout(prev);
    const timer = window.setTimeout(() => {
      const p = this.pendingEvents.get(key);
      this.pendingEvents.delete(key);
      this.debounceTimers.delete(key);
      this.emitEvent(p as any);
    }, this.opts.debounceMs);
    this.debounceTimers.set(key, timer);
  }
}


