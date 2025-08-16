import type { AssetType } from "./AssetType";
import type { VDocument } from "../dom/vdom";

export type Asset = {
  id: number;                    // monotonic id assigned in Phase 1
  url: string;                   // resolved absolute
  assetType: AssetType;
  mime?: string;
  bytes?: number;
  buf: ArrayBuffer;              // raw data for this asset (not retained by streamer)
  index: number;                 // completion index (1..total)
  total: number;                 // total pending assets
};

export type SnapshotStartedEvt = { type: "snapshotStarted"; snapshot: VDocument };
export type AssetEvt = {
  type: "asset";
  asset: Asset;
};
export type SnapshotCompleteEvt = { type: "snapshotComplete" };
export type InlineEvent = SnapshotStartedEvt | AssetEvt | SnapshotCompleteEvt;