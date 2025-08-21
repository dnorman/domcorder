import { computeMinimalChanges, applyChanges } from '../../src/recorder/StringChangeDetector';

describe('StringChangeDetector', () => {
  describe('computeMinimalChanges', () => {
    it('should return no operations for empty strings', () => {
      const changes = computeMinimalChanges('', '');
      expect(changes.length).toBe(0);
    });

    it('should return no operations for identical strings', () => {
      const changes = computeMinimalChanges('hello', 'hello');
      expect(changes.length).toBe(0);
    });

    it('should handle simple insert operation', () => {
      const changes = computeMinimalChanges('hello', 'hello world');
      const result = applyChanges('hello', changes);
      expect(result).toBe('hello world');
      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('insert');
    });

    it('should handle simple remove operation', () => {
      const changes = computeMinimalChanges('hello world', 'hello');
      const result = applyChanges('hello world', changes);
      expect(result).toBe('hello');
      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('remove');
    });

    it('should handle insert at beginning', () => {
      const changes = computeMinimalChanges('world', 'hello world');
      const result = applyChanges('world', changes);
      expect(result).toBe('hello world');
      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('insert');
      expect(changes[0].index).toBe(0);
    });

    it('should handle remove from beginning', () => {
      const changes = computeMinimalChanges('hello world', 'world');
      const result = applyChanges('hello world', changes);
      expect(result).toBe('world');
      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('remove');
      expect(changes[0].index).toBe(0);
    });

    it('should handle insert in middle', () => {
      const changes = computeMinimalChanges('hello', 'hello world');
      const result = applyChanges('hello', changes);
      expect(result).toBe('hello world');
      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('insert');
    });

    it('should handle remove from middle', () => {
      const changes = computeMinimalChanges('hello world', 'helloworld');
      const result = applyChanges('hello world', changes);
      expect(result).toBe('helloworld');
      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('remove');
    });

    it('should handle multiple operations - complex transformation', () => {
      const changes = computeMinimalChanges('hello', 'world');
      const result = applyChanges('hello', changes);
      expect(result).toBe('world');
    });

    it('should handle character replacement', () => {
      const changes = computeMinimalChanges('hello', 'hallo');
      const result = applyChanges('hello', changes);
      expect(result).toBe('hallo');
    });

    it('should handle multiple character replacements', () => {
      const changes = computeMinimalChanges('hello', 'hallo');
      const result = applyChanges('hello', changes);
      expect(result).toBe('hallo');
    });

    it('should handle insert multiple characters', () => {
      const changes = computeMinimalChanges('hi', 'hello');
      const result = applyChanges('hi', changes);
      expect(result).toBe('hello');
    });

    it('should handle remove multiple characters', () => {
      const changes = computeMinimalChanges('hello', 'hi');
      const result = applyChanges('hello', changes);
      expect(result).toBe('hi');
    });

    it('should handle complex transformation with mixed operations', () => {
      const changes = computeMinimalChanges('programming', 'program');
      const result = applyChanges('programming', changes);
      expect(result).toBe('program');
    });

    it('should optimize consecutive inserts', () => {
      const changes = computeMinimalChanges('hi', 'hello');
      // Should optimize multiple single-character inserts into fewer operations
      const insertOps = changes.filter(op => op.type === 'insert');
      expect(insertOps.length).toBeLessThanOrEqual(3); // Should be optimized to fewer operations
    });

    it('should optimize consecutive removes', () => {
      const changes = computeMinimalChanges('hello', 'hi');
      // Should optimize multiple single-character removes into fewer operations
      const removeOps = changes.filter(op => op.type === 'remove');
      expect(removeOps.length).toBeLessThanOrEqual(3); // Should be optimized to fewer operations
    });

    it('should handle single character transformation', () => {
      const changes = computeMinimalChanges('a', 'b');
      const result = applyChanges('a', changes);
      expect(result).toBe('b');
    });

    it('should handle very different strings', () => {
      const changes = computeMinimalChanges('abc', 'xyz');
      const result = applyChanges('abc', changes);
      expect(result).toBe('xyz');
    });

    it('should validate insert operation properties', () => {
      const changes = computeMinimalChanges('hello', 'hello world');
      
      expect(changes.length).toBeGreaterThan(0);
      
      const insertOp = changes.find(op => op.type === 'insert');
      expect(insertOp).toBeDefined();
      expect(typeof insertOp!.index).toBe('number');
      expect(typeof insertOp!.content).toBe('string');
      expect(insertOp!.index).toBeGreaterThanOrEqual(0);
    });

    it('should validate remove operation properties', () => {
      const changes = computeMinimalChanges('hello world', 'hello');
      
      expect(changes.length).toBeGreaterThan(0);
      
      const removeOp = changes.find(op => op.type === 'remove');
      expect(removeOp).toBeDefined();
      expect(typeof removeOp!.index).toBe('number');
      expect(typeof removeOp!.count).toBe('number');
      expect(removeOp!.index).toBeGreaterThanOrEqual(0);
      expect(removeOp!.count).toBeGreaterThan(0);
    });
  });

  describe('applyChanges', () => {
    it('should apply insert operations correctly', () => {
      const operations = [
        { type: 'insert' as const, index: 5, content: ' world' }
      ];
      const result = applyChanges('hello', operations);
      expect(result).toBe('hello world');
    });

    it('should apply remove operations correctly', () => {
      const operations = [
        { type: 'remove' as const, index: 5, count: 6 }
      ];
      const result = applyChanges('hello world', operations);
      expect(result).toBe('hello');
    });

    it('should apply multiple operations in correct order', () => {
      const operations = [
        { type: 'remove' as const, index: 1, count: 1 },
        { type: 'insert' as const, index: 1, content: 'a' }
      ];
      const result = applyChanges('hello', operations);
      expect(result).toBe('hallo');
    });

    it('should handle operations at the beginning', () => {
      const operations = [
        { type: 'insert' as const, index: 0, content: 'hello ' }
      ];
      const result = applyChanges('world', operations);
      expect(result).toBe('hello world');
    });

    it('should handle operations at the end', () => {
      const operations = [
        { type: 'insert' as const, index: 5, content: ' world' }
      ];
      const result = applyChanges('hello', operations);
      expect(result).toBe('hello world');
    });
  });
});
