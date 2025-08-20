// ShadowRootTracker.ts
type ShadowRootTrackerOptions = {
  /** If true, override any passed mode and always attach with { mode: 'open' } */
  forceOpen?: boolean;
};

export class ShadowRootTracker {
  private static readonly PATCH_FLAG = Symbol.for("__shadow_root_tracker_patched__");

  private readonly map = new WeakMap<Element, ShadowRoot>();
  private originalAttachShadow?: (init: ShadowRootInit) => ShadowRoot;
  private installed = false;

  constructor(private options: ShadowRootTrackerOptions = {}) {}

  /**
   * Start intercepting calls to Element.prototype.attachShadow.
   * Safe to call multiple times; only the first call patches.
   */
  install(): void {
    if (this.installed) return;

    const proto = Element.prototype as Element & {
      attachShadow(init: ShadowRootInit): ShadowRoot;
      [key: symbol]: unknown;
    };

    // If already patched by this class instance or another, avoid double-patching.
    if ((proto as any)[ShadowRootTracker.PATCH_FLAG]) {
      this.installed = true; // consider it installed (someone else patched already)
      return;
    }

    if (typeof proto.attachShadow !== "function") {
      // Non-shadow DOM environment — nothing to patch
      this.installed = true;
      return;
    }

    this.originalAttachShadow = proto.attachShadow.bind(proto);

    const tracker = this;
    function patchedAttachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
      const actualInit: ShadowRootInit = tracker.options.forceOpen
        ? { ...init, mode: "open" }
        : init;

      // Use the original to create the shadow root
      const root = tracker.originalAttachShadow!.call(this, actualInit);

      // Track the host → shadow mapping
      tracker.map.set(this, root);

      return root;
    }

    // Define the patched method while preserving configurability as much as possible
    const desc = Object.getOwnPropertyDescriptor(proto, "attachShadow");
    if (desc && (desc.writable || desc.configurable)) {
      Object.defineProperty(proto, "attachShadow", {
        ...desc,
        value: patchedAttachShadow,
      });
    } else {
      // Fallback if descriptor is non-standard; direct assignment
      (proto as any).attachShadow = patchedAttachShadow;
    }

    // Mark prototype as patched
    (proto as any)[ShadowRootTracker.PATCH_FLAG] = true;

    this.installed = true;
  }

  /**
   * Restore the original Element.prototype.attachShadow (if we patched it).
   */
  uninstall(): void {
    if (!this.installed) return;

    const proto = Element.prototype as Element & {
      attachShadow(init: ShadowRootInit): ShadowRoot;
      [key: symbol]: unknown;
    };

    if (this.originalAttachShadow) {
      const desc = Object.getOwnPropertyDescriptor(proto, "attachShadow");
      if (desc && (desc.writable || desc.configurable)) {
        Object.defineProperty(proto, "attachShadow", {
          ...desc,
          value: this.originalAttachShadow,
        });
      } else {
        (proto as any).attachShadow = this.originalAttachShadow;
      }
    }
    // Clear our patch flag if we were the ones who set it
    if ((proto as any)[ShadowRootTracker.PATCH_FLAG]) {
      try {
        delete (proto as any)[ShadowRootTracker.PATCH_FLAG];
      } catch {
        // non-critical
      }
    }

    this.installed = false;
  }

  /**
   * Returns true if we’ve recorded a ShadowRoot for this element.
   * Note: elements that attached a shadow before install() won’t be known.
   */
  hasShadow(element: Element): boolean {
    return this.map.has(element);
  }

  /**
   * Returns the tracked ShadowRoot for the element, or undefined if unknown.
   * Works even for 'closed' shadows that were created while the patch was active,
   * because we capture the returned ShadowRoot at creation time.
   */
  getShadow<T extends ShadowRoot = ShadowRoot>(element: Element): T | undefined {
    return this.map.get(element) as T | undefined;
    }

  /**
   * Update runtime options (e.g., toggle forceOpen) without reinstalling.
   */
  setOptions(next: ShadowRootTrackerOptions): void {
    this.options = { ...this.options, ...next };
  }

  /**
   * Whether the patch is currently installed.
   */
  isInstalled(): boolean {
    return this.installed;
  }
}