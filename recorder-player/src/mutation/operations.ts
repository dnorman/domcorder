import type { StringChangeOperation } from "./StringChangeDetector";

export type DomOperation =
  | { op: 'insert'; parentId: number; index: number, node: Node }
  | { op: 'remove'; nodeId: number; }
  | { op: 'replace'; nodeId: number; node: Node }
  | { op: 'updateAttribute'; nodeId: number; name: string; value: string }
  | { op: 'removeAttribute'; nodeId: number; name: string; }
  | { op: 'updateText'; nodeId: number; ops: StringChangeOperation[] };