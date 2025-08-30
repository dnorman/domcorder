import type { AssetType } from "./AssetType";

export type PendingAsset = { 
  id: number;
  url: string;
  type: AssetType
};

export class AssetsTracker {
  private nextId = 1;
  private byUrl = new Map<string, PendingAsset>();
  private order: PendingAsset[] = [];
  
  public assign(url: string, type: AssetType): PendingAsset {
    const existing = this.byUrl.get(url);
    
    if (existing) {
      return existing;
    }
    
    const pa = { id: this.nextId++, url, type };
    this.byUrl.set(url, pa);
    this.order.push(pa);
    
    return pa;
  }

  public get(url: string): PendingAsset | undefined {
    return this.byUrl.get(url);
  }

  public count(): number {
    return this.order.length;
  }

  public take(): PendingAsset[] {
    const current = this.order.splice(0);
    
    this.order.length = 0;

    return current;
  }
}