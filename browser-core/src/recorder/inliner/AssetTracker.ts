export type PendingAsset = { 
  id: number;
  url: string;
  mime?: string,
  data?: ArrayBuffer
};

export class AssetTracker {
  private nextId = 1;
  private byUrl = new Map<string, PendingAsset>();
  private order: PendingAsset[] = [];
  
  public assign(url: string, data?: ArrayBuffer, mime?: string): PendingAsset {
    const existing = this.byUrl.get(url);
    
    if (existing) {
      return existing;
    }
    
    const pa = { id: this.nextId++, url, data, mime };
    this.byUrl.set(url, pa);
    this.order.push(pa);

    console.log('assign', pa);
    
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