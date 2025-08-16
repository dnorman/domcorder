import type { AssetType } from "./AssetType";

export type PendingAsset = { id: number; url: string; type: AssetType };
export class PendingAssets {
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