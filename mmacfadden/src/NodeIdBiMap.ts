export class NodeIdBiMap {
  private static readonly NODE_ID_PROPERTY = "__node_id__";
  
  private readonly idToNodeMap;
  private maxNodeId: number;

  constructor(root: Node) {
    this.maxNodeId = 0;
    this.idToNodeMap = new Map<number, Node>();
    this.assignNodeIdsToSubTree(root);
  }

  public assignNodeIdsToSubTree(node: Node) {
    const id = ++this.maxNodeId;
    this.idToNodeMap.set(id, node);
    (node as any)[NodeIdBiMap.NODE_ID_PROPERTY] = id;

    for (const child of node.childNodes) {
      this.assignNodeIdsToSubTree(child);
    }
  }

  public getNodeId(node: Node): number | undefined {
    return (node as any)[NodeIdBiMap.NODE_ID_PROPERTY];
  }

  public getNodeById(id: number): Node | undefined {
    return this.idToNodeMap.get(id);
  }

  public removeNodesInSubtree(node: Node) {
    const id = this.getNodeId(node);
    if (id !== undefined) {
      this.idToNodeMap.delete(id);
    }
    delete (node as any)[NodeIdBiMap.NODE_ID_PROPERTY];
    
    for (const child of node.childNodes) {
      this.removeNodesInSubtree(child);
    }
  }
}