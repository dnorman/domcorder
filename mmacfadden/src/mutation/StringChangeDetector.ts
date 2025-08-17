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

export type StringChangeOperation = InsertOperation | RemoveOperation;

/**
 * Computes a minimal set of changes to transform source string into target string.
 * Uses a simple character-by-character comparison approach.
 * 
 * @param source - The original string
 * @param target - The target string to transform into
 * @returns Array of insert and remove operations in order of application
 */
export function computeMinimalChanges(source: string, target: string): StringChangeOperation[] {
  if (source === target) {
    return [];
  }

  const operations: StringChangeOperation[] = [];
  let sourceIndex = 0;
  let targetIndex = 0;

  // Find the longest common prefix
  while (sourceIndex < source.length && targetIndex < target.length && source[sourceIndex] === target[targetIndex]) {
    sourceIndex++;
    targetIndex++;
  }

  // Find the longest common suffix
  let sourceEnd = source.length;
  let targetEnd = target.length;
  while (sourceEnd > sourceIndex && targetEnd > targetIndex && source[sourceEnd - 1] === target[targetEnd - 1]) {
    sourceEnd--;
    targetEnd--;
  }

  // Remove characters from source that are not in target
  if (sourceEnd > sourceIndex) {
    operations.push({
      type: 'remove',
      index: sourceIndex,
      count: sourceEnd - sourceIndex
    });
  }

  // Insert characters into target that are not in source
  if (targetEnd > targetIndex) {
    operations.push({
      type: 'insert',
      index: targetIndex,
      content: target.slice(targetIndex, targetEnd)
    });
  }

  return operations;
}





/**
 * Applies the computed changes to a source string to produce the target string.
 * This is useful for testing and verification.
 */
export function applyChanges(source: string, operations: StringChangeOperation[]): string {
  let result = source;
  
  // Sort operations by index in reverse order to avoid index shifting issues
  // Remove operations should be applied first (highest index first)
  // Insert operations should be applied after (highest index first)
  const sortedOps = [...operations].sort((a, b) => {
    if (a.type === 'remove' && b.type === 'remove') {
      return b.index - a.index;
    }
    if (a.type === 'insert' && b.type === 'insert') {
      return b.index - a.index;
    }
    // Remove operations should come before insert operations at the same index
    if (a.index === b.index) {
      return a.type === 'remove' ? -1 : 1;
    }
    return b.index - a.index;
  });

  for (const op of sortedOps) {
    if (op.type === 'insert') {
      result = result.slice(0, op.index) + op.content + result.slice(op.index);
    } else if (op.type === 'remove') {
      result = result.slice(0, op.index) + result.slice(op.index + op.count);
    }
  }

  return result;
}
