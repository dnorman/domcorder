import { NodeIdBiMap } from '../common';

export type CanvasWriteKind = "2d" | "webgl" | "webgl2";

export type CanvasWriteCallback = (info: {
  kind: CanvasWriteKind;
  method: string;
  args: IArguments | any[];
  ctx: CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
}) => void;

export type CanvasChangedEvent = {
  nodeId: number;
  mime: string;
  data: ArrayBuffer;
};

export type CanvasChangedCallback = (event: CanvasChangedEvent) => void;

export type WatchAllOptions = {
  watch2D?: boolean;
  watchWebGL?: boolean;          // WebGL1 & WebGL2
  observeDom?: boolean;          // watch for new canvases in this document (default: true)
  includeDocuments?: Document[]; // additional documents to patch (e.g., same-origin iframes' docs, or shadowRoot.ownerDocument)
  shadowRoots?: ShadowRoot[];    // specific open shadow roots to scan for <canvas> (no auto-discovery)
  watchIframes?: boolean;        // same-origin iframes (default: false)
  processIntervalMs?: number;    // interval to process dirty canvases (default: 100ms)
  mimeType?: string;             // mime type for canvas blob conversion (default: 'image/png')
};

export type Unwatch = () => void;


export class CanvasTracker {
  private unpatchers: Unwatch[] = [];
  private patchedContexts = new WeakSet<object>();
  private patchedCanvases = new WeakSet<HTMLCanvasElement>();
  private observedDocs = new WeakSet<Document>();
  private observedRoots = new WeakSet<Node>();

  private dirtyCanvases: Set<HTMLCanvasElement> = new Set();
  private processInterval: number | null = null;
  private nodeIdBiMap: NodeIdBiMap;

  private callback: CanvasChangedCallback;
  private options: Required<WatchAllOptions>;

  // Methods we consider "writes"
  private static readonly TWO_D_WRITE_METHODS = [
    "fillRect", "strokeRect", "clearRect",
    "drawImage", "putImageData",
    "fillText", "strokeText",
    "fill", "stroke",
  ];

  private static readonly WEBGL_WRITE_METHODS = [
    // visible draws
    "drawArrays", "drawElements",
    "drawRangeElements",         // GL2
    "drawArraysInstanced",       // GL2 or extension
    "drawElementsInstanced",     // GL2 or extension
    "drawBuffers",               // GL2 or extension
    // clears
    "clear",
    "clearBufferfv", "clearBufferiv", "clearBufferuiv", "clearBufferfi", // GL2
    // copies/blits
    "copyTexImage2D", "copyTexSubImage2D", "copyTexSubImage3D", // 3D: GL2
    "blitFramebuffer",                                      // GL2
    // texture uploads
    "texImage2D", "texSubImage2D",
    "texImage3D", "texSubImage3D",                          // GL2
    "compressedTexImage2D", "compressedTexSubImage2D",
    "compressedTexImage3D", "compressedTexSubImage3D",      // GL2
  ];

  constructor(callback: CanvasChangedCallback, nodeIdBiMap: NodeIdBiMap, options: WatchAllOptions = {}) {
    this.callback = callback;
    this.nodeIdBiMap = nodeIdBiMap;
    this.options = {
      watch2D: options.watch2D ?? true,
      watchWebGL: options.watchWebGL ?? true,
      observeDom: options.observeDom ?? true,
      includeDocuments: options.includeDocuments ?? [],
      shadowRoots: options.shadowRoots ?? [],
      watchIframes: options.watchIframes ?? false,
      processIntervalMs: options.processIntervalMs ?? 1000,
      mimeType: options.mimeType ?? 'image/png',
    };
  }

  // Type guards
  private is2D(ctx: any): ctx is CanvasRenderingContext2D {
    return ctx && typeof ctx.fillRect === "function" && typeof ctx.drawImage === "function";
  }

  private isWebGL2(ctx: any): ctx is WebGL2RenderingContext {
    return ctx && typeof (ctx as WebGL2RenderingContext).drawArraysInstanced === "function";
  }

  private isWebGL1(ctx: any): ctx is WebGLRenderingContext {
    return ctx &&
      typeof ctx.getParameter === "function" &&
      ctx.TEXTURE_2D !== undefined &&
      !this.isWebGL2(ctx);
  }

  // Wrap a list of methods on a specific context instance
  private wrapContextInstance<T extends object>(
    ctx: T,
    methods: string[],
    kind: CanvasWriteKind,
    canvas: HTMLCanvasElement
  ): Unwatch {
    if (this.patchedContexts.has(ctx as any)) return () => {};
    this.patchedContexts.add(ctx as any);

    const originals = new Map<string, Function>();
    for (const name of methods) {
      const fn = (ctx as any)[name];
      if (typeof fn !== "function") continue;
      originals.set(name, fn);
      (ctx as any)[name] = (...args: any[]) => {
        try {
          // Mark canvas as dirty instead of immediate callback
          this.dirtyCanvases.add(canvas);
        } catch {
          /* never break marking as dirty */
        }
        return fn.apply(ctx, args);
      };
    }
    return () => {
      originals.forEach((orig, name) => {
        (ctx as any)[name] = orig;
      });
    };
  }

  // Patch a context if it matches our kinds
  private patchIfWatchable(ctx: any, canvas: HTMLCanvasElement): void {
    if (!ctx) return;
    if (this.options.watch2D && this.is2D(ctx)) {
      this.unpatchers.push(this.wrapContextInstance(ctx, CanvasTracker.TWO_D_WRITE_METHODS, "2d", canvas));
      return;
    }
    if (this.options.watchWebGL && this.isWebGL2(ctx)) {
      this.unpatchers.push(this.wrapContextInstance(ctx, CanvasTracker.WEBGL_WRITE_METHODS, "webgl2", canvas));
      return;
    }
    if (this.options.watchWebGL && this.isWebGL1(ctx)) {
      this.unpatchers.push(this.wrapContextInstance(ctx, CanvasTracker.WEBGL_WRITE_METHODS, "webgl", canvas));
      return;
    }
  }

  // Patch HTMLCanvasElement.prototype.getContext globally
  private patchPrototypeGetContext(targetDoc: Document): Unwatch {
    // Use the prototype from the target document's Window if available (handles iframes)
    const win = targetDoc.defaultView || window;
    const HTMLCanvasProto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
    if (!HTMLCanvasProto) return () => {};

    const original = HTMLCanvasProto.getContext;
    if (!original) return () => {};

    if ((HTMLCanvasProto as any).__canvas_getContext_patched__) {
      // already patched for this document window
      return () => {};
    }

    const tracker = this;
    const patched = function(this: HTMLCanvasElement, contextId: string, ...rest: any[]) {
      const ctx = original.call(this, contextId as any, ...rest) as any;
      if (ctx) tracker.patchIfWatchable(ctx, this);
      return ctx;
    };

    (HTMLCanvasProto as any).getContext = patched;
    (HTMLCanvasProto as any).__canvas_getContext_patched__ = true;

    return () => {
      if ((HTMLCanvasProto as any).__canvas_getContext_patched__) {
        (HTMLCanvasProto as any).getContext = original;
        delete (HTMLCanvasProto as any).__canvas_getContext_patched__;
      }
    };
  }

  // Scan a root (Document or ShadowRoot) for canvases & patch existing contexts
  private scanRootForCanvases(root: ParentNode): void {
    const canvases = root.querySelectorAll?.("canvas");
    if (!canvases) return;
    canvases.forEach((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return;
      if (!this.patchedCanvases.has(canvas)) {
        this.patchedCanvases.add(canvas);
        // Try to grab existing contexts (if any were already created) and patch them
        try {
          const ctx2d = canvas.getContext("2d");
          if (ctx2d) this.patchIfWatchable(ctx2d, canvas);
        } catch {}
        try {
          const gl2 = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
          if (gl2) this.patchIfWatchable(gl2, canvas);
        } catch {}
        try {
          const gl1 =
            (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
            (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
          if (gl1) this.patchIfWatchable(gl1, canvas);
        } catch {}
      }
    });
  }

  // Observe a root for added/removed nodes to catch new canvases
  private observeRoot(root: Node): Unwatch {
    if (this.observedRoots.has(root)) return () => {};
    this.observedRoots.add(root);

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes && m.addedNodes.forEach((node) => {
          if (node instanceof HTMLCanvasElement) {
            this.scanRootForCanvases(node.parentNode as ParentNode || (node as any));
          } else if ((node as Element)?.querySelectorAll) {
            this.scanRootForCanvases(node as ParentNode);
          }
        });
      }
    });

    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }

  // Patch a Document (prototype + scan + observe)
  private patchDocument(doc: Document): void {
    if (!doc || this.observedDocs.has(doc)) return;
    this.observedDocs.add(doc);

    // 1) patch prototype getContext for this window
    this.unpatchers.push(this.patchPrototypeGetContext(doc));

    // 2) scan existing canvases
    this.scanRootForCanvases(doc);

    // 3) observe DOM for new canvases
    if (this.options.observeDom) {
      this.unpatchers.push(this.observeRoot(doc));
    }
  }

  // Optionally patch same-origin iframes
  private patchSameOriginIframes(doc: Document): void {
    if (!this.options.watchIframes) return;
    const iframes = doc.querySelectorAll("iframe");
    iframes.forEach((frame) => {
      try {
        const childDoc = frame.contentDocument;
        if (childDoc) {
          // if already loaded
          this.patchDocument(childDoc);
        }
        // re-patch on load (covers later navigation as well)
        frame.addEventListener("load", () => {
          try {
            const d = (frame as HTMLIFrameElement).contentDocument;
            if (d) this.patchDocument(d);
          } catch {}
        });
      } catch {
        // cross-origin; ignore
      }
    });
  }

  // Process dirty canvases by converting them to blobs and calling the callback
  private async processDirtyCanvases(): Promise<void> {
    if (this.dirtyCanvases.size === 0) return;

    const canvasesToProcess = Array.from(this.dirtyCanvases);
    this.dirtyCanvases.clear();

    for (const canvas of canvasesToProcess) {
      try {
        const nodeId = this.nodeIdBiMap.getNodeId(canvas);
        
        // If no node ID found, keep the canvas in dirty set and skip processing
        if (nodeId === undefined) {
          this.dirtyCanvases.add(canvas);
          continue;
        }
        
        // Convert canvas to blob
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, this.options.mimeType);
        });

        if (blob) {
          const arrayBuffer = await blob.arrayBuffer();
          this.callback({
            nodeId,
            mime: this.options.mimeType,
            data: arrayBuffer,
          });

          this.dirtyCanvases.delete(canvas);
        }
      } catch (error) {
        // Silently ignore errors to prevent breaking the processing loop
        console.warn('Failed to process canvas:', error);
      }
    }
  }

  // Start watching canvases
  public watch(): void {
    // Start: main document, extra docs, optional iframes, provided shadow roots
    this.patchDocument(document);
    this.options.includeDocuments.forEach((d) => this.patchDocument(d));
    this.patchSameOriginIframes(document);

    // Explicit shadow roots: scan and optionally observe their subtrees
    this.options.shadowRoots.forEach((sr) => {
      this.scanRootForCanvases(sr);
      if (this.options.observeDom) {
        this.unpatchers.push(this.observeRoot(sr));
      }
    });

    // Start the processing interval
    this.processInterval = window.setInterval(() => {
      this.processDirtyCanvases();
    }, this.options.processIntervalMs);
  }

  // Cleanup method
  public unwatch(): void {
    // Clear the processing interval
    if (this.processInterval !== null) {
      window.clearInterval(this.processInterval);
      this.processInterval = null;
    }

    // Process any remaining dirty canvases before cleanup
    this.processDirtyCanvases();

    // Clean up all patchers
    this.unpatchers.splice(0).forEach((fn) => {
      try { fn(); } catch {}
    });

    // Clear dirty canvases
    this.dirtyCanvases.clear();
  }
}
