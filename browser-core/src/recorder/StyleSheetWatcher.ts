import {
  ensureAdoptedStyleSheetId,
  getAdoptedStyleSheetId,
  setAdoptedStyleSheetId,
  getNonAdoptedStyleSheetId,
} from '../common/StyleSheetIdUtils';
import { NodeIdBiMap } from '../common/NodeIdBiMap';

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

  Mutation Queuing Strategy
  -------------------------
  StyleSheetWatcher queues mutations for non-adopted stylesheets until their owning DOM node has been
  emitted via DomNodeAdded frame. This ensures proper ordering: DomNodeAdded frames always precede
  stylesheet mutation frames.

  The queuing logic uses a WeakMap keyed by DOM Node objects (not nodeIds) to queue mutations:
  - Nodes without IDs: Mutations are queued in WeakMap, will flush when node gets ID and is emitted
  - Nodes with IDs but in pendingNewNodes Set: Mutations are queued (async gap between ID assignment and emission)
  - Nodes with IDs and not in pendingNewNodes: Mutations emit immediately (node was already emitted)

  IMPORTANT: StyleSheetWatcher NEVER assigns node IDs. ID assignment is the responsibility of DomChangeDetector.
  StyleSheetWatcher only reads existing IDs using NodeIdBiMap.getNodeId() static method.

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
  sheetId: number;
  rule: string;
  index: number;
};

export type SheetRulesDeleteEvent = {
  type: 'sheet-rules-delete';
  sheet: CSSStyleSheet;
  sheetId: number;
  index: number;
};

export type SheetRulesReplaceEvent = {
  type: 'sheet-rules-replace';
  sheet: CSSStyleSheet;
  sheetId: number;
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
  /** Optional NodeIdBiMap for using owner node IDs as stylesheet IDs.
   *  Note: StyleSheetWatcher no longer uses this for auto-assignment.
   *  It's kept for backward compatibility but may be removed in the future. */
  nodeIdMap?: NodeIdBiMap;
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


function snapshotAdopted(target: Document | ShadowRoot): ReadonlyArray<CSSStyleSheet> {
  // adoptedStyleSheets returns a frozen array; copy refs to avoid external mutation assumptions
  const arr = Array.from(target.adoptedStyleSheets);
  for (const s of arr) ensureAdoptedStyleSheetId(s);
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
  private nodeIdMap?: NodeIdBiMap;

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

  // Queue for stylesheet mutations waiting for DomNodeAdded frames
  // Uses WeakMap keyed by DOM Node to queue mutations for nodes without IDs or nodes that have IDs but haven't been emitted yet
  // Stores event factories (functions that create events) rather than events themselves, since we may not have the ID yet
  private pendingMutationsByNode = new WeakMap<Node, Array<(sheetId: number) => StyleSheetWatcherEvent>>();
  
  // Track nodes that have been assigned IDs by DomChangeDetector but haven't been emitted yet (async gap)
  // When a node is in this set, mutations should be queued even if the node has an ID
  private pendingNewNodes = new Set<Node>();

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
    this.nodeIdMap = options.nodeIdMap;
  }

  /**
   * Snapshots document.styleSheets, preserving order and assigning IDs
   * For non-adopted stylesheets with ownerNode, uses ownerNode ID if nodeIdMap is available
   */
  private snapshotDocumentSheets(doc: Document): CSSStyleSheet[] {
    // Preserve order — the cascade depends on it
    const arr = Array.from(doc.styleSheets) as CSSStyleSheet[];
    for (const s of arr) {
      // For non-adopted stylesheets, use ownerNode ID if available
      // Note: We don't need to set __adopted_stylesheet_id__ because getNonAdoptedStyleSheetId
      // reads from the ownerNode's ID, not from the stylesheet property
      if (s.ownerNode && this.nodeIdMap) {
        // Non-adopted stylesheets will use ownerNode ID via getNonAdoptedStyleSheetId
        // No need to set any property on the stylesheet itself
      } else {
        // For adopted stylesheets or when nodeIdMap is not available, use auto-increment
        ensureAdoptedStyleSheetId(s);
      }
    }
    return arr;
  }

  start() {
    const doc = this.opts.root;
    // Initial snapshots
    this.lastDocSheets = this.snapshotDocumentSheets(doc);
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

  /**
   * Adds nodes that have been assigned IDs by DomChangeDetector but haven't been emitted yet.
   * This tracks the async gap between ID assignment and DomNodeAdded frame emission.
   * Should be called by PageRecorder before processing operations from DomChangeDetector.
   * 
   * @param nodes Set of nodes that have IDs but haven't been emitted yet
   */
  public addPendingNewNodes(nodes: Set<Node>): void {
    for (const node of nodes) {
      this.pendingNewNodes.add(node);
    }
  }

  /**
   * Marks a node as having had its DomNodeAdded frame emitted.
   * Flushes any pending stylesheet mutation events for this node.
   * This should be called by PageRecorder after emitting a DomNodeAdded frame.
   * 
   * @param node The DOM node that was emitted (not just the nodeId)
   */
  public markNodeEmitted(node: Node): void {
    // Flush any pending mutations for this node
    const pendingFactories = this.pendingMutationsByNode.get(node);
    if (pendingFactories) {
      this.pendingMutationsByNode.delete(node);
      
      // Get the sheetId from the node (should exist by now)
      const nodeId = NodeIdBiMap.getNodeId(node);
      if (nodeId !== undefined) {
        for (const createEvent of pendingFactories) {
          const event = createEvent(nodeId);
          this.emitEvent(event);
        }
      }
    }
    
    // Remove from pendingNewNodes since it's now emitted
    this.pendingNewNodes.delete(node);
  }

  /**
   * Marks all nodes in a subtree as emitted (for when a subtree is inserted).
   * This ensures child style elements are also marked.
   * 
   * @param nodes Array of DOM nodes that were emitted (not just nodeIds)
   */
  public markSubtreeEmitted(nodes: Node[]): void {
    for (const node of nodes) {
      this.markNodeEmitted(node);
    }
  }

  /**
   * Marks a node as removed and cleans up any tracking data.
   * Should be called by PageRecorder when emitting DomNodeRemoved frames.
   * 
   * @param node The DOM node that was removed (not just the nodeId)
   */
  public markNodeRemoved(node: Node): void {
    // Clean up pending mutations (node won't be emitted, so discard)
    // Discarding is safe because the node is being removed, so mutations are no longer relevant
    this.pendingMutationsByNode.delete(node);
    
    // Remove from pendingNewNodes
    this.pendingNewNodes.delete(node);
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
    const now = this.snapshotDocumentSheets(this.opts.root);
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
        now.forEach(ensureAdoptedStyleSheetId);
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
        now.forEach(ensureAdoptedStyleSheetId);
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

  /**
   * Gets the stylesheet ID for non-adopted stylesheets (those with ownerNode).
   * 
   * IMPORTANT: This method should ONLY be called for non-adopted stylesheets.
   * This method NEVER assigns IDs - it only reads existing IDs from the node.
   * StyleSheetWatcher should never assign IDs; that's the responsibility of DomChangeDetector.
   * 
   * @returns The node ID if it exists, or null if the node doesn't have an ID yet
   * @throws Error if the stylesheet doesn't have an ownerNode
   */
  private getStyleSheetIdForEvent(sheet: CSSStyleSheet): number | null {
    // This method should only be called for non-adopted stylesheets
    if (!sheet.ownerNode) {
      throw new Error('getStyleSheetIdForEvent() called for adopted stylesheet (no ownerNode). Use getAdoptedStyleSheetId() instead.');
    }
    
    // Only read existing ID - never assign
    // Use static method to avoid any auto-assignment
    return getNonAdoptedStyleSheetId(sheet, undefined);
  }

  /**
   * Handles a stylesheet mutation event, queuing it for non-adopted stylesheets until the node is emitted,
   * or emitting immediately for adopted stylesheets or already-emitted non-adopted stylesheets.
   * 
   * Mutation queuing logic:
   * 1. If there's a pending queue in WeakMap → add to queue
   * 2. If node has no ID → queue in WeakMap (will flush when node gets ID and is emitted)
   * 3. If node has ID but is in pendingNewNodes → queue in WeakMap (waiting for emission)
   * 4. Otherwise (has ID and not in pendingNewNodes) → emit immediately (node was already emitted)
   */
  private handleStyleSheetMutation(
    sheet: CSSStyleSheet,
    createEvent: (sheetId: number) => StyleSheetWatcherEvent
  ): void {
    if (!this.isStyleSheetAttached(sheet)) {
      return;
    }

    // For non-adopted stylesheets (with ownerNode), wait for DomNodeAdded frame to be emitted
    if (sheet.ownerNode) {
      const ownerNode = sheet.ownerNode;
      
      // Check if there's already a pending queue for this node
      const pendingQueue = this.pendingMutationsByNode.get(ownerNode);
      if (pendingQueue) {
        // Queue exists - add event factory to it
        pendingQueue.push(createEvent);
        return;
      }
      
      // No queue exists - check if we should queue or emit
      // Use static method to check if node has an ID (without assigning one)
      const nodeHasId = NodeIdBiMap.getNodeId(ownerNode) !== undefined;
      const isPendingNew = this.pendingNewNodes.has(ownerNode);
      
      if (!nodeHasId || isPendingNew) {
        // Queue the mutation:
        // - Node has no ID yet (will flush when node gets ID and is emitted)
        // - Node has ID but is in pendingNewNodes (waiting for emission in async gap)
        // Store the event factory - we'll get the sheetId when flushing
        this.pendingMutationsByNode.set(ownerNode, [createEvent]);
        return;
      }
      
      // Node has ID and is not in pendingNewNodes → already emitted, emit immediately
      const sheetId = this.getStyleSheetIdForEvent(sheet);
      if (sheetId !== null) {
        const event = createEvent(sheetId);
        this.emitEvent(event);
      }
    } else {
      // Adopted stylesheets (no ownerNode) can emit immediately
      const sheetId = getAdoptedStyleSheetId(sheet);
      const event = createEvent(sheetId);
      this.emitEvent(event);
    }
  }

  private patchCSSStyleSheetMethods() {
    const proto = CSSStyleSheet.prototype as any;
    const self = this; // Capture 'this' for use in the wrapper function
    const wrap = <K extends keyof CSSStyleSheet>(key: K, cb: (sheet: CSSStyleSheet, args: any[]) => void) => {
      const orig = (proto as any)[key] as Function;
      if (typeof orig !== 'function') {
        console.warn(`StyleSheetWatcher: CSSStyleSheet.${key} is not available`);
        return;
      }
      (proto as any)[key] = function(this: CSSStyleSheet, ...args: any[]) {
        const result = orig.apply(this, args);
        // For non-adopted stylesheets, IDs come from ownerNode (no need to set __adopted_stylesheet_id__)
        // For adopted stylesheets, ensure they have an ID
        try {
          if (!this.ownerNode) {
            ensureAdoptedStyleSheetId(this);
          }
          // Note: Non-adopted stylesheets use ownerNode ID via getNonAdoptedStyleSheetId
        } catch {}
        try { cb(this, args); } catch {}
        return result;
      };
      self.unpatchFns.push(() => { (proto as any)[key] = orig; });
    };

    wrap('insertRule', (sheet, args) => {
      self.handleStyleSheetMutation(sheet, (sheetId) => ({
        type: 'sheet-rules-insert',
        sheet,
        sheetId,
        rule: args[0],
        index: args[1],
      }));
    });

    wrap('deleteRule', (sheet, args) => {
      self.handleStyleSheetMutation(sheet, (sheetId) => ({
        type: 'sheet-rules-delete',
        sheet,
        sheetId,
        index: args[0],
      }));
    });

    wrap('replace', (sheet, args) => {
      self.handleStyleSheetMutation(sheet, (sheetId) => ({
        type: 'sheet-rules-replace',
        sheet,
        sheetId,
        text: args[0],
      }));
    });

    wrap('replaceSync', (sheet, args) => {
      self.handleStyleSheetMutation(sheet, (sheetId) => ({
        type: 'sheet-rules-replace',
        sheet,
        sheetId,
        text: args[0],
      }));
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


