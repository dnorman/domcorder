import type { VStyleSheet } from "@domcorder/proto-ts";
import { getAdoptedStyleSheetId, setAdoptedStyleSheetId } from "../common/StyleSheetIdUtils";
import type { AssetManager } from "./AssetManager";

export class AdoptedStyleSheetsMutator {
  private readonly targetDocument: Document;
  private readonly assetManager: AssetManager;
  constructor(targetDocument: Document, assetManager: AssetManager) {
    this.targetDocument = targetDocument;
    this.assetManager = assetManager;
  }

  updateAdoptedStyleSheets(styleSheetIds: number[]): void {
    const map = new Map<number, CSSStyleSheet>();
    for (const existingSheet of this.targetDocument.adoptedStyleSheets) {
      map.set(getAdoptedStyleSheetId(existingSheet), existingSheet);
    }

    const newStyleSheetsIds = styleSheetIds.filter(id => !map.has(id)!);

    for (const newSheetId of newStyleSheetsIds) {
      const targetWindow = this.targetDocument.defaultView!;
      const newStyleSheet = new targetWindow.CSSStyleSheet();
      setAdoptedStyleSheetId(newStyleSheet, newSheetId);
      map.set(newSheetId, newStyleSheet);
    }
    const newAdoptedStyleSheets = styleSheetIds.map(id => map.get(id)!);
    this.targetDocument.adoptedStyleSheets = newAdoptedStyleSheets;
  }

  public receiveAdoptedStyleSheet(styleSheet: VStyleSheet): void {
    const targetSheet = this.targetDocument.adoptedStyleSheets.find(sheet => getAdoptedStyleSheetId(sheet) === styleSheet.id);
    if (targetSheet) {
      this.assetManager.bindAssetsToStyleSheet(targetSheet, styleSheet.text);
      if (styleSheet.media) {
        targetSheet.media.mediaText = styleSheet.media;
      }
    } 
  }
}