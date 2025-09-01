import type { StringMutationOperation } from "./StringMutationOperation";

export type DomOperation =
  | { op: 'insert'; parentId: number; index: number, node: Node }
  | { op: 'remove'; nodeId: number; }
  | { op: 'replace'; nodeId: number; node: Node }
  | { op: 'updateAttribute'; nodeId: number; name: string; value: string }
  | { op: 'removeAttribute'; nodeId: number; name: string; }
  | { op: 'updateText'; nodeId: number; ops: StringMutationOperation[] }
  | { op: 'propertyChanged'; nodeId: number; property: string; value: any };