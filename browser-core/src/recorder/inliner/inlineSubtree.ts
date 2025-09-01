import type { VNode } from "@domcorder/proto-ts";
import type { NodeIdBiMap } from "../../common";
import type { Asset } from "./Asset";
import { fetchAssets, rewriteTreeUrlsToAssetIds, snapshotNode } from "./inline";
import { AssetsTracker } from "./AssetTracker";

export interface InlineStartedEvent {
  node: VNode;
}

export interface InlineSubTreeHandler {
  onInlineStarted: (event: InlineStartedEvent) => void;
  onAsset: (asset: Asset) => void;
}

export async function inlineSubTree(
  node: Node, 
  nodeIdMap: NodeIdBiMap, 
  assetTracker: AssetsTracker,
  handler: InlineSubTreeHandler, 
  concurrency: number = 6,
  inlineCrossOrigin: boolean = false
) {
  const vNode = snapshotNode(node, assetTracker, nodeIdMap);
  rewriteTreeUrlsToAssetIds(vNode, node.baseURI, assetTracker);

  handler.onInlineStarted({
    node: vNode,
  });

  await fetchAssets(
    concurrency, 
    inlineCrossOrigin,
    assetTracker,
    (asset) => handler.onAsset(asset));
}