import type { VNode } from "@domcorder/proto-ts";
import type { NodeIdBiMap } from "../../common";
import type { Asset } from "./Asset";
import { fetchAssets, rewriteTreeUrlsToPendingIds, snapshotNode } from "./inline";
import { PendingAssets } from "./PendingAssets";

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
  handler: InlineSubTreeHandler, 
  concurrency: number = 6,
  inlineCrossOrigin: boolean = false
) {
  const pendingAssets = new PendingAssets();

  const vNode = snapshotNode(node, pendingAssets, nodeIdMap);
  rewriteTreeUrlsToPendingIds(vNode, node.baseURI, pendingAssets);

  handler.onInlineStarted({
    node: vNode,
    assetCount: pendingAssets.order.length
  });

  await fetchAssets(
    concurrency, 
    inlineCrossOrigin,
    pendingAssets,
    (asset) => handler.onAsset(asset));

  handler.onInlineComplete();
}