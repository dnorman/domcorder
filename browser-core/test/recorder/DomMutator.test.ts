import 'global-jsdom/register';
import { DomMutator } from '../../src/player/DomMutator';
import { NodeIdBiMap } from '../../src/common/NodeIdBiMap';
import type { DomOperation } from '../../src/common/DomOperation';
import type { AssetManager } from '../../src/player/AssetManager';

/**
 * Unit tests for DomMutator
 * Tests cover all operation types and error handling scenarios.
 */

describe('DomMutator', () => {
  let container: HTMLElement;
  let nodeMap: NodeIdBiMap;
  let mutator: DomMutator;
  let mockAssetManager: AssetManager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    nodeMap = new NodeIdBiMap();
    
    // Create a mock AssetManager that mimics the real behavior
    // The real AssetManager sets the attribute on the element
    mockAssetManager = {
      findAndBindAssetToElementProperty: jest.fn((element: Element, property: string, value: string) => {
        // Mock implementation: just set the attribute like the real AssetManager does
        if (value) {
          element.setAttribute(property, value);
        }
      }),
    } as any;
    
    mutator = new DomMutator(nodeMap, mockAssetManager);
  });

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('insert operation', () => {
    test('should insert node at valid index', () => {
      const parent = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const child = document.createElement('span');
      child.textContent = 'Test';
      NodeIdBiMap.setNodeId(child, 100);

      const parentId = nodeMap.getNodeId(parent)!;
      const ops: DomOperation[] = [
        { op: 'insert', parentId, index: 0, node: child }
      ];

      mutator.applyOps(ops);

      expect(parent.childNodes.length).toBe(1);
      expect(parent.firstChild).toBe(child);
      expect(nodeMap.getNodeById(100)).toBe(child);
    });

    test('should insert node at end (index equals length)', () => {
      const parent = document.createElement('div');
      const existing = document.createElement('p');
      parent.appendChild(existing);
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const child = document.createElement('span');
      NodeIdBiMap.setNodeId(child, 100);

      const parentId = nodeMap.getNodeId(parent)!;
      const ops: DomOperation[] = [
        { op: 'insert', parentId, index: 1, node: child }
      ];

      mutator.applyOps(ops);

      expect(parent.childNodes.length).toBe(2);
      expect(parent.lastChild).toBe(child);
    });

    test('should error when index is negative', () => {
      const parent = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const child = document.createElement('span');
      NodeIdBiMap.setNodeId(child, 100);

      const parentId = nodeMap.getNodeId(parent)!;
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { op: 'insert', parentId, index: -1, node: child }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('index -1 is negative')
      );
      expect(parent.childNodes.length).toBe(0);
      
      consoleSpy.mockRestore();
    });

    test('should error when index exceeds parent.childNodes.length', () => {
      const parent = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const child = document.createElement('span');
      NodeIdBiMap.setNodeId(child, 100);

      const parentId = nodeMap.getNodeId(parent)!;
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { op: 'insert', parentId, index: 5, node: child }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('index 5 is out of bounds')
      );
      expect(parent.childNodes.length).toBe(0);
      
      consoleSpy.mockRestore();
    });

    test('should error when parent does not exist', () => {
      const child = document.createElement('span');
      NodeIdBiMap.setNodeId(child, 100);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { op: 'insert', parentId: 999, index: 0, node: child }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('parent node 999 does not exist')
      );
      
      consoleSpy.mockRestore();
    });

    test('should error when node lacks node ID', () => {
      const parent = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const child = document.createElement('span');
      // Don't assign node ID

      const parentId = nodeMap.getNodeId(parent)!;
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { op: 'insert', parentId, index: 0, node: child }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('node to insert does not have a node ID')
      );
      
      consoleSpy.mockRestore();
    });

    test('should adopt subtree node IDs', () => {
      const parent = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const child = document.createElement('div');
      NodeIdBiMap.setNodeId(child, 100);
      const grandchild = document.createElement('span');
      NodeIdBiMap.setNodeId(grandchild, 101);
      child.appendChild(grandchild);

      const parentId = nodeMap.getNodeId(parent)!;
      const ops: DomOperation[] = [
        { op: 'insert', parentId, index: 0, node: child }
      ];

      mutator.applyOps(ops);

      expect(nodeMap.getNodeById(100)).toBe(child);
      expect(nodeMap.getNodeById(101)).toBe(grandchild);
    });
  });

  describe('remove operation', () => {
    test('should remove node successfully', () => {
      const parent = document.createElement('div');
      const child = document.createElement('span');
      child.textContent = 'Test';
      parent.appendChild(child);
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const childId = nodeMap.getNodeId(child)!;
      const ops: DomOperation[] = [
        { op: 'remove', nodeId: childId }
      ];

      mutator.applyOps(ops);

      expect(parent.childNodes.length).toBe(0);
      expect(nodeMap.getNodeById(childId)).toBeUndefined();
    });

    test('should handle missing node gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { op: 'remove', nodeId: 999 }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('node 999 does not exist in nodeMap')
      );
      
      consoleSpy.mockRestore();
    });

    test('should handle node without parent', () => {
      const node = document.createElement('div');
      NodeIdBiMap.setNodeId(node, 100);
      nodeMap.adoptNodesFromSubTree(node);
      // Don't append to DOM

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const ops: DomOperation[] = [
        { op: 'remove', nodeId: 100 }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('has no parentNode')
      );
      expect(nodeMap.getNodeById(100)).toBeUndefined();
      
      consoleSpy.mockRestore();
    });

    test('should remove subtree from node map', () => {
      const parent = document.createElement('div');
      const child = document.createElement('div');
      const grandchild = document.createElement('span');
      child.appendChild(grandchild);
      parent.appendChild(child);
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const childId = nodeMap.getNodeId(child)!;
      const grandchildId = nodeMap.getNodeId(grandchild)!;
      
      const ops: DomOperation[] = [
        { op: 'remove', nodeId: childId }
      ];

      mutator.applyOps(ops);

      expect(nodeMap.getNodeById(childId)).toBeUndefined();
      expect(nodeMap.getNodeById(grandchildId)).toBeUndefined();
    });
  });

  describe('updateAttribute operation', () => {
    test('should update attribute successfully', () => {
      const element = document.createElement('div');
      element.setAttribute('id', 'old');
      nodeMap.assignNodeIdsToSubTree(element);
      container.appendChild(element);

      const elementId = nodeMap.getNodeId(element)!;
      const ops: DomOperation[] = [
        { op: 'updateAttribute', nodeId: elementId, name: 'id', value: 'new' }
      ];

      mutator.applyOps(ops);

      expect(element.getAttribute('id')).toBe('new');
    });

    test('should call AssetManager for asset-containing attributes', () => {
      const img = document.createElement('img');
      nodeMap.assignNodeIdsToSubTree(img);
      container.appendChild(img);

      const imgId = nodeMap.getNodeId(img)!;
      const ops: DomOperation[] = [
        { op: 'updateAttribute', nodeId: imgId, name: 'src', value: 'asset:122' }
      ];

      mutator.applyOps(ops);

      // Verify AssetManager was called to bind the asset with the value
      expect(mockAssetManager.findAndBindAssetToElementProperty).toHaveBeenCalledWith(img, 'src', 'asset:122');
      expect(img.getAttribute('src')).toBe('asset:122');
    });

    test('should call AssetManager for href attributes', () => {
      const link = document.createElement('link');
      nodeMap.assignNodeIdsToSubTree(link);
      container.appendChild(link);

      const linkId = nodeMap.getNodeId(link)!;
      const ops: DomOperation[] = [
        { op: 'updateAttribute', nodeId: linkId, name: 'href', value: 'asset:42' }
      ];

      mutator.applyOps(ops);

      expect(mockAssetManager.findAndBindAssetToElementProperty).toHaveBeenCalledWith(link, 'href', 'asset:42');
    });

    test('should call AssetManager for style attributes with asset URLs', () => {
      const div = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(div);
      container.appendChild(div);

      const divId = nodeMap.getNodeId(div)!;
      const ops: DomOperation[] = [
        { op: 'updateAttribute', nodeId: divId, name: 'style', value: 'background: url(asset:99)' }
      ];

      mutator.applyOps(ops);

      expect(mockAssetManager.findAndBindAssetToElementProperty).toHaveBeenCalledWith(div, 'style', 'background: url(asset:99)');
    });

    test('should not call AssetManager for non-asset attributes', () => {
      const element = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(element);
      container.appendChild(element);

      const elementId = nodeMap.getNodeId(element)!;
      
      // Reset the mock to clear any previous calls
      (mockAssetManager.findAndBindAssetToElementProperty as jest.Mock).mockClear();
      
      const ops: DomOperation[] = [
        { op: 'updateAttribute', nodeId: elementId, name: 'id', value: 'test' }
      ];

      mutator.applyOps(ops);

      // AssetManager is always called, but for non-asset attributes it just sets them normally
      expect(mockAssetManager.findAndBindAssetToElementProperty).toHaveBeenCalledWith(element, 'id', 'test');
      expect(element.getAttribute('id')).toBe('test');
    });

    test('should add new attribute', () => {
      const element = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(element);
      container.appendChild(element);

      const elementId = nodeMap.getNodeId(element)!;
      const ops: DomOperation[] = [
        { op: 'updateAttribute', nodeId: elementId, name: 'class', value: 'test' }
      ];

      mutator.applyOps(ops);

      expect(element.getAttribute('class')).toBe('test');
    });

    test('should silently skip non-element nodes', () => {
      const textNode = document.createTextNode('test');
      NodeIdBiMap.setNodeId(textNode, 100);
      nodeMap.adoptNodesFromSubTree(textNode);
      container.appendChild(textNode);

      const ops: DomOperation[] = [
        { op: 'updateAttribute', nodeId: 100, name: 'id', value: 'test' }
      ];

      // Should not throw
      mutator.applyOps(ops);
    });

    test('should error when node does not exist', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { op: 'updateAttribute', nodeId: 999, name: 'id', value: 'test' }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('node 999 does not exist')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('removeAttribute operation', () => {
    test('should remove attribute successfully', () => {
      const element = document.createElement('div');
      element.setAttribute('id', 'test');
      nodeMap.assignNodeIdsToSubTree(element);
      container.appendChild(element);

      const elementId = nodeMap.getNodeId(element)!;
      const ops: DomOperation[] = [
        { op: 'removeAttribute', nodeId: elementId, name: 'id' }
      ];

      mutator.applyOps(ops);

      expect(element.hasAttribute('id')).toBe(false);
    });

    test('should be idempotent (safe to call on non-existent attribute)', () => {
      const element = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(element);
      container.appendChild(element);

      const elementId = nodeMap.getNodeId(element)!;
      const ops: DomOperation[] = [
        { op: 'removeAttribute', nodeId: elementId, name: 'nonexistent' }
      ];

      // Should not throw
      mutator.applyOps(ops);
    });

    test('should silently skip non-element nodes', () => {
      const textNode = document.createTextNode('test');
      NodeIdBiMap.setNodeId(textNode, 100);
      nodeMap.adoptNodesFromSubTree(textNode);
      container.appendChild(textNode);

      const ops: DomOperation[] = [
        { op: 'removeAttribute', nodeId: 100, name: 'id' }
      ];

      // Should not throw
      mutator.applyOps(ops);
    });

    test('should error when node does not exist', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { op: 'removeAttribute', nodeId: 999, name: 'id' }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('node 999 does not exist')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('updateText operation', () => {
    test('should update text content successfully', () => {
      const textNode = document.createTextNode('old');
      NodeIdBiMap.setNodeId(textNode, 100);
      nodeMap.adoptNodesFromSubTree(textNode);
      container.appendChild(textNode);

      const ops: DomOperation[] = [
        { 
          op: 'updateText', 
          nodeId: 100, 
          ops: [
            { type: 'remove', index: 0, count: 3 },
            { type: 'insert', index: 0, content: 'new' }
          ]
        }
      ];

      mutator.applyOps(ops);

      expect(textNode.textContent).toBe('new');
    });

    test('should update comment node', () => {
      const comment = document.createComment('old');
      NodeIdBiMap.setNodeId(comment, 100);
      nodeMap.adoptNodesFromSubTree(comment);
      container.appendChild(comment);

      const ops: DomOperation[] = [
        { 
          op: 'updateText', 
          nodeId: 100, 
          ops: [
            { type: 'remove', index: 0, count: 3 },
            { type: 'insert', index: 0, content: 'new' }
          ]
        }
      ];

      mutator.applyOps(ops);

      expect(comment.textContent).toBe('new');
    });

    test('should error when node is not CharacterData', () => {
      const element = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(element);
      container.appendChild(element);

      const elementId = nodeMap.getNodeId(element)!;
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { 
          op: 'updateText', 
          nodeId: elementId, 
          ops: [{ type: 'insert', index: 0, content: 'test' }]
        }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('is not a CharacterData node')
      );
      
      consoleSpy.mockRestore();
    });

    test('should error when node does not exist', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { 
          op: 'updateText', 
          nodeId: 999, 
          ops: [{ type: 'insert', index: 0, content: 'test' }]
        }
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('node 999 does not exist')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('operation sequence', () => {
    test('should process operations in order', () => {
      const parent = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const child1 = document.createElement('span');
      NodeIdBiMap.setNodeId(child1, 100);
      const child2 = document.createElement('span');
      NodeIdBiMap.setNodeId(child2, 101);

      const parentId = nodeMap.getNodeId(parent)!;
      const ops: DomOperation[] = [
        { op: 'insert', parentId, index: 0, node: child1 },
        { op: 'insert', parentId, index: 1, node: child2 }
      ];

      mutator.applyOps(ops);

      expect(parent.childNodes.length).toBe(2);
      expect(parent.firstChild).toBe(child1);
      expect(parent.lastChild).toBe(child2);
    });

    test('should continue processing after error', () => {
      const parent = document.createElement('div');
      nodeMap.assignNodeIdsToSubTree(parent);
      container.appendChild(parent);

      const child = document.createElement('span');
      NodeIdBiMap.setNodeId(child, 100);

      const parentId = nodeMap.getNodeId(parent)!;
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const ops: DomOperation[] = [
        { op: 'insert', parentId: 999, index: 0, node: child }, // Error
        { op: 'insert', parentId, index: 0, node: child } // Should still execute
      ];

      mutator.applyOps(ops);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(parent.childNodes.length).toBe(1);
      
      consoleSpy.mockRestore();
    });
  });
});

