import { NodeIdBiMap } from "../common/NodeIdBiMap";
import type { DomOperation } from "../common/DomOperation";
import { computeMinimalChanges } from "./StringChangeDetector";

export class DomChangeDetector {
  private readonly liveDomRoot: Node;
  private readonly liveNodeMap: NodeIdBiMap;
  
  private readonly snapshotDomRoot: Node;
  private readonly snapshotNodeMap: NodeIdBiMap;

  private readonly liveDomObserver: MutationObserver;
  private readonly dirtySubtrees = new Set<Node>();

  // Track form elements and their property changes
  private readonly formElementsMap = new Map<Element, { nodeId: number; boundEvents: Array<() => void> }>();
  private readonly formPropertyChanges = new Map<Element, Map<string, any>>();

  private readonly callback: (ops: DomOperation[]) => void;
  private readonly batchIntervalMs: number;
  private batchInterval: number | null = null;

  constructor(liveDomRoot: Node, liveNodeMap: NodeIdBiMap, callback: (ops: DomOperation[]) => void, batchIntervalMs: number = 1000) {
    this.liveDomRoot = liveDomRoot;
    this.snapshotDomRoot = liveDomRoot.cloneNode(true);
    this.liveNodeMap = liveNodeMap;
    this.snapshotNodeMap = new NodeIdBiMap();
    this.snapshotNodeMap.assignNodeIdsToSubTree(this.snapshotDomRoot);
    this.callback = callback;
    this.batchIntervalMs = batchIntervalMs;

    this.liveDomObserver = new MutationObserver(this.handleMutations.bind(this));

    this.liveDomObserver.observe(this.liveDomRoot, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });

    // Start regular interval processing
    this.batchInterval = setInterval(() => {
      this.processDirtyRegions();
    }, this.batchIntervalMs) as unknown as number;

    // Scan for existing form elements and bind to them
    this.scanAndBindToFormElements();
  }

  /**
   * Scans the DOM for existing form elements and binds to them
   */
  private scanAndBindToFormElements(): void {
    if (this.liveDomRoot.nodeType !== Node.ELEMENT_NODE) {
      return; // Can't query non-element nodes
    }
    
    const rootElement = this.liveDomRoot as Element;
    const formElements = rootElement.querySelectorAll('input, select, textarea');
    for (const element of Array.from(formElements)) {
      if (this.isFormElement(element)) {
        const nodeId = this.liveNodeMap.getNodeId(element);
        if (nodeId !== undefined) {
          this.bindToFormElement(element, nodeId);
        }
      }
    }
  }

  public getSnapshotDomRoot(): Node {
    return this.snapshotDomRoot.cloneNode(true);
  }

  /**
   * Detects if an element is a form element that needs property change tracking
   */
  private isFormElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    const inputType = (element as HTMLInputElement).type;
    
    return (
      tagName === 'input' ||
      tagName === 'select' ||
      tagName === 'textarea' ||
      (tagName === 'input' && inputType === 'checkbox') ||
      (tagName === 'input' && inputType === 'radio') ||
      (tagName === 'input' && inputType === 'range') ||
      (tagName === 'input' && inputType === 'color') ||
      (tagName === 'input' && inputType === 'datetime-local') ||
      (tagName === 'input' && inputType === 'date') ||
      (tagName === 'input' && inputType === 'time') ||
      (tagName === 'input' && inputType === 'month') ||
      (tagName === 'input' && inputType === 'week') ||
      (tagName === 'input' && inputType === 'email') ||
      (tagName === 'input' && inputType === 'password') ||
      (tagName === 'input' && inputType === 'search') ||
      (tagName === 'input' && inputType === 'tel') ||
      (tagName === 'input' && inputType === 'url') ||
      (tagName === 'input' && inputType === 'number')
    );
  }

  /**
   * Gets the relevant properties to track for a form element
   */
  private getFormElementProperties(element: Element): string[] {
    const tagName = element.tagName.toLowerCase();
    const inputType = (element as HTMLInputElement).type;
    
    if (tagName === 'input') {
      if (inputType === 'checkbox' || inputType === 'radio') {
        return ['checked'];
      } else if (inputType === 'range') {
        return ['value', 'min', 'max', 'step'];
      } else if (inputType === 'color') {
        return ['value'];
      } else if (inputType === 'file') {
        return []; // Skip file inputs as requested
      } else {
        // text, email, password, search, tel, url, number, date, time, etc.
        return ['value'];
      }
    } else if (tagName === 'select') {
      return ['value', 'selectedIndex'];
    } else if (tagName === 'textarea') {
      return ['value'];
    }
    
    return [];
  }

  /**
   * Binds to form element events to track property changes
   */
  private bindToFormElement(element: Element, nodeId: number): void {
    if (this.formElementsMap.has(element)) {
      return; // Already bound
    }

    const properties = this.getFormElementProperties(element);
    if (properties.length === 0) {
      return;
    }

    const boundEvents: Array<() => void> = [];
    const tagName = element.tagName.toLowerCase();
    const inputType = (element as HTMLInputElement).type;

    // Determine the best event to bind to
    let eventType: string;
    if (tagName === "textarea" || (tagName === 'input' && (inputType === 'text' || inputType === 'email' || inputType === 'password' || 
                                inputType === 'search' || inputType === 'tel' || inputType === 'url' || 
                                inputType === 'number' || inputType === 'date' || inputType === 'time' || 
                                inputType === 'month' || inputType === 'week' || inputType === 'datetime-local' ||
                                inputType === 'range' || inputType === 'color'))) {
      eventType = 'input'; // Real-time updates for text-like inputs
    } else {
      eventType = 'change'; // For checkboxes, radio buttons, selects, etc.
    }

    const handlePropertyChange = () => {
      // Mark this element as having property changes
      if (!this.formPropertyChanges.has(element)) {
        this.formPropertyChanges.set(element, new Map());
      }
      
      // Track all relevant properties
      for (const property of properties) {
        const value = (element as any)[property];
        this.formPropertyChanges.get(element)!.set(property, value);
      }
      
      // Mark the element's subtree as dirty for processing
      this.dirtySubtrees.add(element);
      
      // Also mark the element itself as dirty to ensure it gets processed
      this.dirtySubtrees.add(element);
    };

    element.addEventListener(eventType, handlePropertyChange);
    boundEvents.push(() => element.removeEventListener(eventType, handlePropertyChange));

    // For checkboxes and radio buttons, also listen to click events
    if ((tagName === 'input' && (inputType === 'checkbox' || inputType === 'radio'))) {
      const handleClick = () => {
        // Small delay to ensure the property has been updated
        setTimeout(handlePropertyChange, 0);
      };
      element.addEventListener('click', handleClick);
      boundEvents.push(() => element.removeEventListener('click', handleClick));
    }

    this.formElementsMap.set(element, { nodeId, boundEvents });
  }

  /**
   * Unbinds events from a form element
   */
  private unbindFromFormElement(element: Element): void {
    const formElementInfo = this.formElementsMap.get(element);
    if (!formElementInfo) return;

    // Remove all bound event listeners
    for (const unbind of formElementInfo.boundEvents) {
      unbind();
    }

    this.formElementsMap.delete(element);
    this.formPropertyChanges.delete(element);
  }

  private handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      
      let target = mutation.target;
      
      // Find the closest ancestor that's a child of our root
      // that is still in the document.
      while (target && !this.liveDomRoot.contains(target)) {
        target = target.parentElement!;
      }

      if (target && this.liveDomRoot.contains(target)) {
        this.dirtySubtrees.add(target);
      }

      // Handle removed nodes - cleanup form element bindings
      if (mutation.type === 'childList' && mutation.removedNodes) {
        for (const removedNode of Array.from(mutation.removedNodes)) {
          if (removedNode.nodeType === Node.ELEMENT_NODE) {
            const element = removedNode as Element;
            if (this.isFormElement(element)) {
              this.unbindFromFormElement(element);
            }
            
            // Also check all descendants for form elements
            const descendants = (element as Element).querySelectorAll('input, select, textarea');
            for (const descendant of Array.from(descendants)) {
              if (this.isFormElement(descendant)) {
                this.unbindFromFormElement(descendant);
              }
            }
          }
        }
      }

      // Handle added nodes - bind to new form elements
      if (mutation.type === 'childList' && mutation.addedNodes) {
        for (const addedNode of Array.from(mutation.addedNodes)) {
          if (addedNode.nodeType === Node.ELEMENT_NODE) {
            const element = addedNode as Element;
            if (this.isFormElement(element)) {
              const nodeId = this.liveNodeMap.getNodeId(element);
              if (nodeId !== undefined) {
                this.bindToFormElement(element, nodeId);
              }
            }
            
            // Also check all descendants for form elements
            const descendants = element.querySelectorAll('input, select, textarea');
            for (const descendant of Array.from(descendants)) {
              if (this.isFormElement(descendant)) {
                const descendantNodeId = this.liveNodeMap.getNodeId(descendant);
                if (descendantNodeId !== undefined) {
                  this.bindToFormElement(descendant, descendantNodeId);
                }
              }
            }
          }
        }
      }

      // FIXME it's possible that a region is marked dirty, but then some ancestor 
      // also then marked dirty. We should compress this. A node that is marked
      // dirty could also be removed from the live dom (directly or indirectly)
      // and we should then remove it from the dirty regions.
    }

    // No timeout logic needed - the interval will process dirty regions regularly
  }

  private processDirtyRegions(): void {
    const allOps: DomOperation[] = [];

    // Process each dirty region
    for (const liveNode of this.dirtySubtrees) {
      const liveNodeId = this.liveNodeMap.getNodeId(liveNode);
      if (liveNodeId === undefined) continue;

      const snapshotNode = this.snapshotNodeMap.getNodeById(liveNodeId);
      if (snapshotNode === undefined) continue;

      const ops = this.computeAndApplyOperations(liveNode, snapshotNode);
      allOps.push(...ops);
    }

    // FIXME: Not sure if this is completely needed, I think we should
    // be marking the form elements as dirty, and just dealing with
    // them as we traverse.

    // Always scan for form elements with property changes
    if (this.liveDomRoot.nodeType === Node.ELEMENT_NODE) {
      const rootElement = this.liveDomRoot as Element;
      const formElements = rootElement.querySelectorAll('input, select, textarea');
      for (const element of Array.from(formElements)) {
        if (this.isFormElement(element)) {
          const liveNodeId = this.liveNodeMap.getNodeId(element);
          if (liveNodeId === undefined) continue;

          const snapshotNode = this.snapshotNodeMap.getNodeById(liveNodeId);
          if (snapshotNode === undefined) continue;

          const ops = this.computeAndApplyOperations(element, snapshotNode);
          allOps.push(...ops);
        }
      }
    }

    // Apply changes to snapshot and notify
    if (allOps.length > 0) {
      try {
        this.callback(allOps);
      } catch (e) {
        console.error(e);
      }
    }

    // Clear dirty regions
    this.dirtySubtrees.clear();
  }

  private computeAndApplyOperations(liveNode: Node, snapshotNode: Node): DomOperation[] {
    if (liveNode.nodeType !== snapshotNode.nodeType) {
      throw new Error(`Node types do not match, live: ${liveNode.nodeType}, snapshot: ${snapshotNode.nodeType}`);
    }

    const liveNodeId = this.liveNodeMap.getNodeId(liveNode)!;

    const ops: DomOperation[] = [];
  
    if (liveNode.nodeType === Node.TEXT_NODE || 
        liveNode.nodeType === Node.COMMENT_NODE ||
        liveNode.nodeType === Node.CDATA_SECTION_NODE) {
      if (snapshotNode.textContent !== liveNode.textContent) {
        const changes = computeMinimalChanges(snapshotNode.textContent || '', liveNode.textContent || '');
        ops.push({
          op: 'updateText',
          nodeId: liveNodeId,
          ops: changes
        });
      }
      
      snapshotNode.textContent = liveNode.textContent;

      return ops;
    } else if (liveNode.nodeType === Node.ELEMENT_NODE) {
      const snapshotEl = snapshotNode as Element;
      const liveEl = liveNode as Element;      
      
      // Check if this is a form element and bind to it if needed
      if (this.isFormElement(liveEl)) {
        this.bindToFormElement(liveEl, liveNodeId);
        
        // Check for property changes by comparing current values with snapshot values
        const properties = this.getFormElementProperties(liveEl);
        
        for (const property of properties) {
          const liveValue = (liveEl as any)[property];
          const snapshotValue = (snapshotEl as any)[property];
          
          if (liveValue !== snapshotValue) {
            ops.push({
              op: 'propertyChanged',
              nodeId: liveNodeId,
              property,
              value: liveValue
            });
            
            // Update the snapshot DOM with the new property value
            (snapshotEl as any)[property] = liveValue;
            
            // For select elements, also update the selectedIndex when value changes
            if (liveEl.tagName.toLowerCase() === 'select' && property === 'value') {
              const liveSelect = liveEl as HTMLSelectElement;
              const snapshotSelect = snapshotEl as HTMLSelectElement;
              const newSelectedIndex = liveSelect.selectedIndex;
              if (snapshotSelect.selectedIndex !== newSelectedIndex) {
                snapshotSelect.selectedIndex = newSelectedIndex;
              }
            }
          }
        }
      }
      
      // Attribute diffs
      const oldAttrs = snapshotEl.attributes;
      const newAttrs = liveEl.attributes;
      
      // Check for removed and updated attributes
      for (let i = 0; i < oldAttrs.length; i++) {
        const attrName = oldAttrs[i].name;
        const newAttr = liveEl.getAttribute(attrName);
        if (newAttr === null) {
          ops.push({
            op: 'removeAttribute',
            nodeId: liveNodeId,
            name: attrName
          });

          snapshotEl.removeAttribute(attrName);
        } else if (newAttr !== oldAttrs[i].value) {
          ops.push({
            op: 'updateAttribute',
            nodeId: liveNodeId,
            name: attrName,
            value: newAttr
          });

          snapshotEl.setAttribute(attrName, newAttr);
        }
      }
      
      // Check for new attributes
      for (let i = 0; i < newAttrs.length; i++) {
        const attrName = newAttrs[i].name;
        if (!snapshotEl.hasAttribute(attrName)) {
          ops.push({
            op: 'updateAttribute',
            nodeId: liveNodeId,
            name: attrName,
            value: newAttrs[i].value
          });

          snapshotEl.setAttribute(attrName, newAttrs[i].value);
        }
      }

      // handle children

      // TODO There is an optimization to be made here.  We should be able to
      // detect when an element in the array has been replaced with a new element
      // and issue a single replace operation instead of a remove and insert.
      // As of now we are not using the replace operation at all.

      const snapshotChildren = Array.from(snapshotEl.childNodes);
      const snapshotChildrenIds = snapshotChildren.map(c => this.snapshotNodeMap.getNodeId(c));
      const liveChildren = Array.from(liveEl.childNodes);
      const liveChildrenIds = liveChildren.map(c => this.liveNodeMap.getNodeId(c));

      const childIdsThatExistInLiveAndSnapshot = snapshotChildrenIds.filter(id => liveChildrenIds.includes(id));

      let snapshotChildrenIndex = 0;
      let liveChildrenIndex = 0;

      while (snapshotChildrenIndex < snapshotChildren.length || liveChildrenIndex < liveChildren.length) {
        const snapshotChildId = snapshotChildrenIndex < snapshotChildren.length ? this.snapshotNodeMap.getNodeId(snapshotChildren[snapshotChildrenIndex]) : undefined;
        const liveChildId = liveChildrenIndex < liveChildren.length ? this.liveNodeMap.getNodeId(liveChildren[liveChildrenIndex]) : undefined;

        if (snapshotChildrenIndex < snapshotChildren.length && liveChildrenIndex < liveChildren.length && snapshotChildId === liveChildId) {
          // elements match → no change
          snapshotChildrenIndex++;
          liveChildrenIndex++;
        } else if (liveChildrenIndex < liveChildren.length && liveChildId && (snapshotChildrenIndex >= snapshotChildren.length || !snapshotChildrenIds.includes(liveChildId))) {
          // element in newChildren[j] is new → insert
          const existingLiveChild = liveChildren[liveChildrenIndex];
          const clonedChild = existingLiveChild.cloneNode(true);
          this.snapshotNodeMap.mirrorNodeIdsToSubTree(existingLiveChild, clonedChild);

          snapshotEl.insertBefore(clonedChild, snapshotChildren[snapshotChildrenIndex]);
          snapshotChildren.splice(snapshotChildrenIndex, 0, clonedChild as ChildNode);
          snapshotChildrenIds.splice(snapshotChildrenIndex, 0, liveChildId!);

          ops.push({ op: "insert", parentId: liveNodeId, index: liveChildrenIndex, node: clonedChild });

          liveChildrenIndex++;
          snapshotChildrenIndex++;
        } else if (snapshotChildrenIndex < snapshotChildren.length && snapshotChildId && (liveChildrenIndex >= liveChildren.length || !liveChildrenIds.includes(snapshotChildId))) {
          // element in oldChildren[i] is missing → remove
          ops.push({ op: "remove", nodeId: snapshotChildId });
          
          const priorLiveNode = this.liveNodeMap.getNodeById(snapshotChildId);
          if (priorLiveNode) {
            this.liveNodeMap.removeNodesInSubtree(priorLiveNode);
          }

          snapshotEl.removeChild(snapshotChildren[snapshotChildrenIndex]);
          snapshotChildren.splice(snapshotChildrenIndex, 1);
          snapshotChildrenIds.splice(snapshotChildrenIndex, 1);
        } else {
          // TODO is there where we want to use the replace operation?
          // fallback: if elements differ but both exist later, remove + insert
          ops.push({ op: "remove", nodeId: snapshotChildId! });

          const priorLiveNode = this.liveNodeMap.getNodeById(liveChildId!);
          if (priorLiveNode) {
            this.liveNodeMap.removeNodesInSubtree(priorLiveNode);
          }

          const existingLiveChild = liveChildren[liveChildrenIndex];
          const clonedChild = existingLiveChild.cloneNode(true);
          this.snapshotNodeMap.mirrorNodeIdsToSubTree(existingLiveChild, clonedChild);

          ops.push({ op: "insert", parentId: liveNodeId, index: liveChildrenIndex, node: clonedChild });

          const priorSnapshotNode = snapshotChildren[snapshotChildrenIndex]
          this.snapshotNodeMap.removeNodesInSubtree(priorSnapshotNode);
          
          snapshotEl.replaceChild(clonedChild, priorSnapshotNode);

          snapshotChildren.splice(snapshotChildrenIndex, 1, clonedChild as ChildNode);
          snapshotChildrenIds.splice(snapshotChildrenIndex, 1, liveChildId!);

          snapshotChildrenIndex++;
          liveChildrenIndex++;
        }
      }
        
      // Also handle updates for children that exist in both arrays
      const commonChildren = snapshotChildren.filter(child => {
        const childId = this.snapshotNodeMap.getNodeId(child);
        return childId && childIdsThatExistInLiveAndSnapshot.includes(childId);
      });

      for (const snapshotChild of commonChildren) {        
        const childId = this.snapshotNodeMap.getNodeId(snapshotChild);
        const liveChild = this.liveNodeMap.getNodeById(childId)!;
        
        // Recursively diff the child nodes
        const recursiveOps = this.computeAndApplyOperations(liveChild, snapshotChild);
        ops.push(...recursiveOps);
      }
      
      return ops;
    }
    
    console.debug('Unexpected change', liveNode, snapshotNode);
    return [];
  }

  disconnect(): void {
    this.liveDomObserver.disconnect();
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
    
    // Cleanup form element event bindings
    for (const [element] of this.formElementsMap) {
      this.unbindFromFormElement(element);
    }
    this.formElementsMap.clear();
    this.formPropertyChanges.clear();
  }
}