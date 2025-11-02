import { NodeIdBiMap } from "./NodeIdBiMap";

declare global { 
  interface CSSStyleSheet { 
    __adopted_stylesheet_id__?: number 
  } 
}

/**
 * Interface for objects that can provide node IDs.
 * This allows flexibility - either a NodeIdBiMap instance or any object with a getNodeId method.
 */
export interface NodeIdProvider {
  getNodeId(node: Node): number | undefined;
}

let __nextAdoptedStyleSheetId = 1;

/**
 * Ensures an adopted stylesheet has an ID, assigning one if it doesn't.
 * This should ONLY be used for adopted stylesheets (those without ownerNode).
 * For non-adopted stylesheets, use getNonAdoptedStyleSheetId() instead.
 */
export function ensureAdoptedStyleSheetId(sheet: CSSStyleSheet): number {
  const anySheet = sheet as any;
  if (typeof anySheet.__adopted_stylesheet_id__ !== 'number') {
    setAdoptedStyleSheetId(sheet, __nextAdoptedStyleSheetId++);
  }
  return anySheet.__adopted_stylesheet_id__ as number;
}

/**
 * Gets the ID of an adopted stylesheet, ensuring it has one if it doesn't.
 * This should ONLY be used for adopted stylesheets (those without ownerNode).
 * For non-adopted stylesheets, use getNonAdoptedStyleSheetId() instead.
 */
export function getAdoptedStyleSheetId(sheet: CSSStyleSheet): number {
  const anySheet = sheet as any;
  if (typeof anySheet.__adopted_stylesheet_id__ !== 'number') {
    ensureAdoptedStyleSheetId(sheet);
  }
  return anySheet.__adopted_stylesheet_id__ as number;
}

/**
 * Sets the ID on an adopted stylesheet.
 * This should ONLY be used for adopted stylesheets (those without ownerNode).
 * For non-adopted stylesheets, IDs come from the ownerNode's ID directly.
 */
export function setAdoptedStyleSheetId(sheet: CSSStyleSheet, id: number): void {
  if (id === undefined) {
    throw new Error("Style sheet id is undefined");
  }

  const anySheet = sheet as any;
  Object.defineProperty(anySheet, "__adopted_stylesheet_id__", {
    value: id,
    configurable: false,
    writable: false,
    enumerable: false,
  });
}

/**
 * Gets the ID of a non-adopted stylesheet using its ownerNode's node ID.
 * Returns null if the ownerNode doesn't have an ID yet.
 * This should ONLY be used for non-adopted stylesheets (those with ownerNode).
 * Never auto-increments IDs - only reads existing IDs from the node.
 * 
 * Note: We always use the static NodeIdBiMap.getNodeId to avoid auto-assignment.
 * If a nodeIdProvider is provided, it's ignored to prevent accidental ID assignment.
 * 
 * Non-adopted stylesheets don't need their __adopted_stylesheet_id__ property set
 * because we always read the ID from the ownerNode.
 */
export function getNonAdoptedStyleSheetId(sheet: CSSStyleSheet, _nodeIdProvider?: NodeIdProvider): number | null {
  if (!sheet.ownerNode) {
    return null;
  }
  
  // Always use static method to avoid auto-assignment - we only want to read existing IDs
  const ownerNodeId = NodeIdBiMap.getNodeId(sheet.ownerNode);
  return ownerNodeId !== undefined ? ownerNodeId : null;
}

