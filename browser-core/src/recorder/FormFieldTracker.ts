import { NodeIdBiMap } from '../common';
import type { DomOperation } from '../common/DomOperation';

export type FormFieldChangedCallback = (ops: DomOperation[]) => void;

export class FormFieldTracker {
  private readonly liveDomRoot: Node;
  private readonly liveNodeMap: NodeIdBiMap;
  private readonly snapshotNodeMap: NodeIdBiMap;
  private readonly callback: FormFieldChangedCallback;

  // Track form elements and their property changes
  private readonly formElementsMap = new Map<Element, { nodeId: number; boundEvents: Array<() => void> }>();
  private readonly formPropertyChanges = new Map<Element, Map<string, any>>();
  private readonly dirtyFormElements = new Set<Element>();

  constructor(
    liveDomRoot: Node,
    liveNodeMap: NodeIdBiMap,
    snapshotNodeMap: NodeIdBiMap,
    callback: FormFieldChangedCallback
  ) {
    this.liveDomRoot = liveDomRoot;
    this.liveNodeMap = liveNodeMap;
    this.snapshotNodeMap = snapshotNodeMap;
    this.callback = callback;

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

  /**
   * Detects if an element is a form element that needs property change tracking
   */
  private isFormElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    const inputType = (element as HTMLInputElement).type;
    
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select'
    ) && (
      // For input elements, only track certain types
      tagName !== 'input' || (
        inputType === 'text' || inputType === 'email' || inputType === 'password' ||
        inputType === 'search' || inputType === 'tel' || inputType === 'url' ||
        inputType === 'number' || inputType === 'date' || inputType === 'time' ||
        inputType === 'month' || inputType === 'week' || inputType === 'datetime-local' ||
        inputType === 'range' || inputType === 'color' || inputType === 'checkbox' ||
        inputType === 'radio' || inputType === 'file'
      )
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
        return ['checked', 'value'];
      } else if (inputType === 'file') {
        return ['files'];
      } else {
        return ['value'];
      }
    } else if (tagName === 'textarea') {
      return ['value'];
    } else if (tagName === 'select') {
      return ['value', 'selectedIndex'];
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
      
      // Mark the element as dirty for processing
      this.dirtyFormElements.add(element);
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
    this.dirtyFormElements.delete(element);
  }

  /**
   * Handles mutations to bind/unbind form elements as they're added/removed
   */
  public handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
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
    }
  }

  /**
   * Processes all form elements to detect property changes and generates operations
   */
  public processFormElements(): DomOperation[] {
    const allOps: DomOperation[] = [];

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

          const ops = this.computeFormElementOperations(element, snapshotNode as Element);
          allOps.push(...ops);
        }
      }
    }

    return allOps;
  }

  /**
   * Computes operations for a specific form element by comparing with snapshot
   */
  private computeFormElementOperations(liveEl: Element, snapshotEl: Element): DomOperation[] {
    const ops: DomOperation[] = [];
    const liveNodeId = this.liveNodeMap.getNodeId(liveEl)!;

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

    return ops;
  }

  /**
   * Marks a form element as dirty for processing
   */
  public markElementDirty(element: Element): void {
    if (this.isFormElement(element)) {
      this.dirtyFormElements.add(element);
    }
  }

  /**
   * Cleanup method to remove all event bindings
   */
  public cleanup(): void {
    // Cleanup form element event bindings
    for (const [element] of this.formElementsMap) {
      this.unbindFromFormElement(element);
    }
    this.formElementsMap.clear();
    this.formPropertyChanges.clear();
    this.dirtyFormElements.clear();
  }
}
