export interface InsertOperation {
  type: 'insert';
  index: number;
  content: string;
}

export interface RemoveOperation {
  type: 'remove';
  index: number;
  count: number;
}

export type StringMutationOperation = InsertOperation | RemoveOperation;