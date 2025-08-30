import type { VNode } from "@domcorder/proto-ts";
import type { NodeIdBiMap } from "../../common";
import type { Asset } from "./Asset";
import { fetchAssets, rewriteTreeUrlsToAssetIds, snapshotNode } from "./inline";
import { AssetsTracker } from "./AssetTracker";

export interface InlineStartedEvent {
  node: VNode;
  assetCount: number;
}

export interface InlineSubTreeHandler {
  onInlineStarted: (event: InlineStartedEvent) => void;
  onAsset: (asset: Asset) => void;
  onInlineComplete: () => void;
}

export async function inlineSubTree(
  node: Node, 
  nodeIdMap: NodeIdBiMap, 
  pendingAssets: AssetsTracker,
  handler: InlineSubTreeHandler, 
  concurrency: number = 6,
  inlineCrossOrigin: boolean = false
) {
  const vNode = snapshotNode(node, pendingAssets, nodeIdMap);
  rewriteTreeUrlsToAssetIds(vNode, node.baseURI, pendingAssets);

  handler.onInlineStarted({
    node: vNode,
    assetCount: pendingAssets.count()
  });

  await fetchAssets(
    concurrency, 
    inlineCrossOrigin,
    pendingAssets,
    (asset) => handler.onAsset(asset));

  handler.onInlineComplete();
}