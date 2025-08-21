import type { VStyleSheet } from "@domcorder/proto-ts";
import { getStyleSheetId, setStyleSheetId } from "../recorder/StyleSheetWatcher";
import type { AssetManager } from "./AssetManager";
import { DomMaterializer } from "./DomMaterializer";

export class AdoptedStyleSheetMutator {
  private targetDocument: Document;
  private assetManager: AssetManager;

  constructor(targetDocument: Document, assetManager: AssetManager) {
    this.targetDocument = targetDocument;
    this.assetManager = assetManager;
  }

  updateAdoptedStyleSheets(styleSheetIds: number[], newStyleSheets: Set<VStyleSheet>): void {
    const map = new Map<number, CSSStyleSheet>();
    for (const existingSheet of this.targetDocument.adoptedStyleSheets) {
      map.set(getStyleSheetId(existingSheet), existingSheet);
    }

    for (const newSheet of newStyleSheets) {
      const newStyleSheet = DomMaterializer.createStyleSheet(
        newSheet, this.assetManager, this.targetDocument.defaultView!);
      map.set(getStyleSheetId(newStyleSheet), newStyleSheet);
    }
    const newAdoptedStyleSheets = styleSheetIds.map(id => map.get(id)!);
    this.targetDocument.adoptedStyleSheets = newAdoptedStyleSheets;
  }
}