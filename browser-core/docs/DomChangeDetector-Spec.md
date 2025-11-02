# Dom Change Detector
The purpose of the a Dom Change Detector is to detect changes to the source document, and then to emit a set of operations that describe the changes that were made.


The ultimate goal is as follows:
- Assume a source DOM Document has an initial state.
- Assume that we take a deep, accurate clone of the source document.
- We call the cloned version the target document.
- We assume that at the beginning, the source and target documents are identical.
- As the source document is modified, the DomChangeDetector emits an ordered set of operations.
- If the ordered set of emitted operations are correctly applied to the target document, when all operations are applied, the source and target documents will be again identical.

We hypothesize that the following types of operations are sufficient to achieve the goal:
  - A change to an existing node's attributes value (updateAttribute operation)
  - A removal of an existing node's attribute (removeAttribute operation)
  - Changes to the CharacterData of an existing node (updateText operation)
  - A new node being added to an existing parent (insert operation)
  - An existing node being removed from its parent (remove operation)


There will be a corresponding Dom Mutator that is responsible for consuming the operation stream and mutating the target document.


Potential Design Considerations:
- We intend to use mutation observers as the initial source of identifying that things have changed in the document.

- Operations should be emitted in as close to the same order they were performed.  This is not 100% achievable since mutation observers and mutation records batch related sets of operations into a record where you can not determine the exact order.
- Operations MUST be emitted in causal order.  For example, this implies:
  - An operation to remove a specific node can not be emitted before the operation that added that node.
  - An operation to change an attribute value of a node can not be emitted before the operations that added the node.
  - An operation to remove an attribute can not be made before an operation that caused that attribute to exist.
  - An operation to change the attribute value of a node can not come after an operation that removes that node.
- Note that these assertions should consider that the document will have an initial state, which may include an arbitrary node tree.  So an operation to remove a node may be emitted with no corresponding add operation ONLY IF that node was already in the document.
- Nodes will be identified primarily by a node id.
  - The node's Id will be assigned when the node is added to the DOM tree.
  - The node's Id must be stable for as long as the node remains in the DOM tree.
  - **Node ID stability within a batch:** When processing a batch of MutationRecords, if a node is added and then removed within the same batch:
    - The node will be assigned an ID when the add operation is processed.
    - When the remove operation is processed later in the same batch, the node still retains its ID (since it hasn't been cleared yet).
    - Both the insert operation and the remove operation must use the same ID.
    - The insert operation must be emitted before the remove operation (due to causal ordering requirements).
    - After the remove operation is emitted, the ID may be cleared since no further operations will reference that node.
  - If the node is removed from the DOM tree its ID can be removed, and that node id shall not be used again.  If the node were to be re-added to the DOM tree it should be treated as a brand new node.
  - When a node is removed, it must be removed using the Id that was originally set when it was added.
- Removal of nodes will be done by referencing their node id, since that is the identity of the node and the most reliable way to find it in the target DOM
- Adding nodes shall reference the parent to add a node to by the parent's Id.
  - We need to be able to provide a reliable way to insert added nodes in the correct spot in the parent's node list. The implementation may use indices, previousSibling references, or other mechanisms to achieve this.

- A "batch" refers to all MutationRecords delivered to a single MutationObserver callback invocation. All MutationRecords within a single batch are processed synchronously within that callback.
- Operations should not be omitted even if they appear to cancel each other out. For example, if an attribute is set and then removed in the same batch, both operations should be recorded. Similarly, if text content is changed multiple times in the same batch, each change should be recorded.

- If operations cannot be processed due to errors (e.g., parent node not found, node to be removed doesn't exist), these are errors and should be handled accordingly. The specification does not define specific error handling behavior, but implementations should handle such cases explicitly.


Notes on DocumentFragments:
- DocumentFragments cannot exist in a document. When a DocumentFragment is appended to the DOM (e.g., via `appendChild` or `insertBefore`), only its child nodes are inserted into the document. The DocumentFragment itself is not part of the document tree and becomes empty after its children are moved.
- Therefore, DocumentFragments will not appear in MutationRecord's `addedNodes` or `removedNodes` properties. Only the fragment's children will appear in these lists.
- Implementations should handle the children of DocumentFragments that appear in `addedNodes`, but DocumentFragment nodes themselves can be safely ignored or excluded from processing logic.
