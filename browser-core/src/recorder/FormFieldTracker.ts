import { NodeIdBiMap } from '../common';
import type { StringMutationOperation } from '../common/StringMutationOperation';
import { computeMinimalChanges } from './StringChangeDetector';

export type DomNodePropertyChanged = {
  nodeId: number;
  propertyName: string;
  propertyValue: string | boolean | number | null;
};

export type DomNodePropertyTextChanged = {
  nodeId: number;
  propertyName: string;
  operations: StringMutationOperation[];
};

export type FormFieldCallbacks = {
  onPropertyChanged: (ops: DomNodePropertyChanged[]) => void;
  onTextChanged: (ops: DomNodePropertyTextChanged[]) => void;
};

export type FormFieldTrackerOptions = {
  immediateMode?: boolean;     // If true, process changes immediately instead of batching
  batchIntervalMs?: number;    // Interval for batch processing (ignored in immediate mode)
};

export class FormFieldTracker {
  private readonly liveDomRoot: Node;
  private readonly liveNodeMap: NodeIdBiMap;
  private readonly callbacks: FormFieldCallbacks;
  private readonly options: Required<FormFieldTrackerOptions>;
  private batchInterval: number | null = null;
  private mutationObserver: MutationObserver | null = null;

  // Track form elements and their property changes
  private readonly formElementsMap = new Map<Element, { nodeId: number; boundEvents: Array<() => void> }>();
  private readonly formPropertyChanges = new Map<Element, Map<string, any>>();
  private readonly dirtyFormElements = new Set<Element>();
  
  // Store previous values for each form element by nodeId
  private readonly previousValues = new Map<number, Map<string, any>>();

  // Text-based input types that should use text diffing
  private static readonly TEXT_DIFF_INPUT_TYPES = new Set([
    'text', 'email', 'url', 'password', 'search', 'tel'
  ]);

  constructor(
    liveDomRoot: Node,
    liveNodeMap: NodeIdBiMap,
    callbacks: FormFieldCallbacks,
    options: FormFieldTrackerOptions = {}
  ) {
    this.liveDomRoot = liveDomRoot;
    this.liveNodeMap = liveNodeMap;
    this.callbacks = callbacks;
    this.options = {
      immediateMode: options.immediateMode ?? false,
      batchIntervalMs: options.batchIntervalMs ?? 500,
    };
  }

  /**
   * Determines if an element should use text diffing for value changes
   */
  private shouldUseTextDiffing(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'textarea') return true;
    
    if (tagName === 'input') {
      const inputType = (element as HTMLInputElement).type;
      return FormFieldTracker.TEXT_DIFF_INPUT_TYPES.has(inputType);
    }
    
    return false;
  }

  /**
   * Scans the DOM for existing form elements and binds to them
   */
  private scanAndBindToFormElements(): void {
    if (this.liveDomRoot.nodeType !== Node.ELEMENT_NODE && 
        this.liveDomRoot.nodeType !== Node.DOCUMENT_NODE) {
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
      if (this.options.immediateMode) {
        // Process immediately
        this.processElementChanges(element);
      } else {
        // Mark the element as dirty for batch processing
        this.dirtyFormElements.add(element);
      }
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
    
    // Store initial property values
    this.storeCurrentValues(element, nodeId);
  }

  /**
   * Stores the current property values for a form element
   */
  private storeCurrentValues(element: Element, nodeId: number): void {
    const properties = this.getFormElementProperties(element);
    const valueMap = new Map<string, any>();
    
    for (const property of properties) {
      const value = (element as any)[property];
      valueMap.set(property, value);
    }
    
    this.previousValues.set(nodeId, valueMap);
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

    // Clean up stored values
    this.previousValues.delete(formElementInfo.nodeId);

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
   * Starts the form field tracker
   */
  public start(): void {
    // Scan for existing form elements and bind to them
    this.scanAndBindToFormElements();

    // Set up mutation observer for form element DOM changes
    this.mutationObserver = new MutationObserver(this.handleMutations.bind(this));
    this.mutationObserver.observe(this.liveDomRoot, {
      childList: true,
      subtree: true,
    });

    // Start batch processing interval only if not in immediate mode
    if (!this.options.immediateMode) {
      this.batchInterval = setInterval(() => {
        this.processDirtyFormElements();
      }, this.options.batchIntervalMs) as unknown as number;
    }
  }

  /**
   * Stops the form field tracker
   */
  public stop(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
    
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    
    this.cleanup();
  }

  /**
   * Processes a single element's changes immediately
   */
  private processElementChanges(element: Element): void {
    if (!this.isFormElement(element)) return;
    
    const liveNodeId = this.liveNodeMap.getNodeId(element);
    if (liveNodeId === undefined) return;

    if (this.shouldUseTextDiffing(element)) {
      const textOps = this.computeTextOperations(element);
      if (textOps.length > 0) {
        this.callbacks.onTextChanged(textOps);
      }
    } else {
      const propertyOps = this.computePropertyOperations(element);
      if (propertyOps.length > 0) {
        this.callbacks.onPropertyChanged(propertyOps);
      }
    }
  }

  /**
   * Processes dirty form elements and generates operations
   */
  private processDirtyFormElements(): void {
    if (this.dirtyFormElements.size === 0) return;

    const propertyOps: DomNodePropertyChanged[] = [];
    const textOps: DomNodePropertyTextChanged[] = [];
    const elementsToProcess = Array.from(this.dirtyFormElements);
    this.dirtyFormElements.clear();

    for (const element of elementsToProcess) {
      if (this.isFormElement(element)) {
        const liveNodeId = this.liveNodeMap.getNodeId(element);
        if (liveNodeId === undefined) {
          // Keep element dirty if no node ID yet
          this.dirtyFormElements.add(element);
          continue;
        }

        if (this.shouldUseTextDiffing(element)) {
          const ops = this.computeTextOperations(element);
          textOps.push(...ops);
        } else {
          const ops = this.computePropertyOperations(element);
          propertyOps.push(...ops);
        }
      }
    }

    // Emit operations if any were generated
    if (propertyOps.length > 0) {
      this.callbacks.onPropertyChanged(propertyOps);
    }
    if (textOps.length > 0) {
      this.callbacks.onTextChanged(textOps);
    }
  }

  /**
   * Processes all form elements to detect property changes and generates operations
   * (This method can be called externally for immediate processing)
   */
  public processFormElements(): { propertyOps: DomNodePropertyChanged[], textOps: DomNodePropertyTextChanged[] } {
    const propertyOps: DomNodePropertyChanged[] = [];
    const textOps: DomNodePropertyTextChanged[] = [];

    // Always scan for form elements with property changes
    if (this.liveDomRoot.nodeType === Node.ELEMENT_NODE || this.liveDomRoot.nodeType === Node.DOCUMENT_NODE) {
      const rootElement = this.liveDomRoot as Element;
      const formElements = rootElement.querySelectorAll('input, select, textarea');
      for (const element of Array.from(formElements)) {
        if (this.isFormElement(element)) {
          const liveNodeId = this.liveNodeMap.getNodeId(element);
          if (liveNodeId === undefined) continue;

          if (this.shouldUseTextDiffing(element)) {
            const ops = this.computeTextOperations(element);
            textOps.push(...ops);
          } else {
            const ops = this.computePropertyOperations(element);
            propertyOps.push(...ops);
          }
        }
      }
    }

    return { propertyOps, textOps };
  }

  /**
   * Computes text operations for text-based form elements
   */
  private computeTextOperations(liveEl: Element): DomNodePropertyTextChanged[] {
    const ops: DomNodePropertyTextChanged[] = [];
    const liveNodeId = this.liveNodeMap.getNodeId(liveEl)!;

    // Get stored previous values for this element
    const previousValueMap = this.previousValues.get(liveNodeId);
    if (!previousValueMap) {
      // No previous values stored, store current values and return no ops
      this.storeCurrentValues(liveEl, liveNodeId);
      return ops;
    }

    // For text elements, we only care about the 'value' property
    const currentValue = (liveEl as any).value || '';
    const previousValue = previousValueMap.get('value') || '';
    
    if (currentValue !== previousValue) {
      // Compute minimal text changes
      const textOperations = computeMinimalChanges(previousValue, currentValue);
      
      if (textOperations.length > 0) {
        ops.push({
          nodeId: liveNodeId,
          propertyName: 'value',
          operations: textOperations
        });
      }
      
      // Update the stored previous value
      previousValueMap.set('value', currentValue);
    }

    return ops;
  }

  /**
   * Computes property operations for non-text form elements
   */
  private computePropertyOperations(liveEl: Element): DomNodePropertyChanged[] {
    const ops: DomNodePropertyChanged[] = [];
    const liveNodeId = this.liveNodeMap.getNodeId(liveEl)!;

    // Get stored previous values for this element
    const previousValueMap = this.previousValues.get(liveNodeId);
    if (!previousValueMap) {
      // No previous values stored, store current values and return no ops
      this.storeCurrentValues(liveEl, liveNodeId);
      return ops;
    }

    // Check for property changes by comparing current values with stored previous values
    const properties = this.getFormElementProperties(liveEl);
    
    for (const property of properties) {
      const currentValue = (liveEl as any)[property];
      const previousValue = previousValueMap.get(property);
      
      if (currentValue !== previousValue) {
        ops.push({
          nodeId: liveNodeId,
          propertyName: property,
          propertyValue: currentValue
        });
        
        // Update the stored previous value
        previousValueMap.set(property, currentValue);
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
    this.previousValues.clear();
  }
}
