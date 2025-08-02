import type { SerializedDomNode } from "./serialization";


export type DomOperation =
  | { op: 'insert'; parentId: number; index: number, node: SerializedDomNode }
  | { op: 'remove'; nodeId: number; }
  | { op: 'replace'; nodeId: number; node: SerializedDomNode }
  | { op: 'updateAttribute'; nodeId: number; name: string; value: string }
  | { op: 'removeAttribute'; nodeId: number; name: string; }
  | { op: 'updateText'; nodeId: number; value: string };