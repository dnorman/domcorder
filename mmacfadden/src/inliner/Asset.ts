import type { AssetType } from "./AssetType";

export type Asset = {
  id: number;
  url: string;
  assetType: AssetType;
  mime?: string;
  buf: ArrayBuffer;
};