import type { VStyleSheet } from "@domcorder/proto-ts";
import { getStyleSheetId, setStyleSheetId } from "../recorder/StyleSheetWatcher";
import type { AssetManager } from "./AssetManager";

export class AdoptedStyleSheetMutator {
  private readonly targetDocument: Document;
  private readonly assetManager: AssetManager;
  constructor(targetDocument: Document, assetManager: AssetManager) {
    this.targetDocument = targetDocument;
    this.assetManager = assetManager;
  }

  updateAdoptedStyleSheets(styleSheetIds: number[]): void {
    const map = new Map<number, CSSStyleSheet>();
    for (const existingSheet of this.targetDocument.adoptedStyleSheets) {
      map.set(getStyleSheetId(existingSheet), existingSheet);
    }

    const newStyleSheetsIds = styleSheetIds.filter(id => !map.has(id)!);

    for (const newSheetId of newStyleSheetsIds) {
      const targetWindow = this.targetDocument.defaultView!;
      const newStyleSheet = new targetWindow.CSSStyleSheet();
      setStyleSheetId(newStyleSheet, newSheetId);
      map.set(newSheetId, newStyleSheet);
    }
    const newAdoptedStyleSheets = styleSheetIds.map(id => map.get(id)!);
    this.targetDocument.adoptedStyleSheets = newAdoptedStyleSheets;
  }

  public receiveAdoptedStyleSheet(styleSheet: VStyleSheet): void {
    const targetSheet = this.targetDocument.adoptedStyleSheets.find(sheet => getStyleSheetId(sheet) === styleSheet.id);
    if (targetSheet) {
      this.assetManager.bindAssetsToStyleSheet(targetSheet, styleSheet.text);
    } 
  }
}