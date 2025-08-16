export class NodeIdBiMap {
  private static readonly NODE_ID_PROPERTY = "__node_id__";

  public static setNodeId(node: Node, id: number) {
    (node as any)[NodeIdBiMap.NODE_ID_PROPERTY] = id;
  }

  public static getNodeId(node: Node): number | undefined {
    return (node as any)[NodeIdBiMap.NODE_ID_PROPERTY];
  }

  public static removeNodeId(node: Node) {
    delete (node as any)[NodeIdBiMap.NODE_ID_PROPERTY];
  }
  
  private readonly idToNodeMap;
  private maxNodeId: number;

  constructor() {
    this.maxNodeId = 0;
    this.idToNodeMap = new Map<number, Node>();
  }

  public adoptNodesFromSubTree(node: Node) {
    const id = NodeIdBiMap.getNodeId(node);
    if (id === undefined) {
      throw new Error("Can not adopt node without an ID");
    }

    this.idToNodeMap.set(id, node);

    for (const child of node.childNodes) {
      this.adoptNodesFromSubTree(child);
    }
  }

  public assignNodeIdsToSubTree(node: Node) {
    const id = ++this.maxNodeId;
    this.idToNodeMap.set(id, node);

    NodeIdBiMap.setNodeId(node, id);

    for (const child of node.childNodes) {
      this.assignNodeIdsToSubTree(child);
    }
  }

  public getNodeId(node: Node): number | undefined {
    return NodeIdBiMap.getNodeId(node);
  }

  public getNodeById(id: number): Node | undefined {
    return this.idToNodeMap.get(id);
  }

  public removeNodesInSubtree(node: Node) {
    const id = this.getNodeId(node);
    if (id !== undefined) {
      this.idToNodeMap.delete(id);
    }

    NodeIdBiMap.removeNodeId(node);
    
    for (const child of node.childNodes) {
      this.removeNodesInSubtree(child);
    }
  }
}