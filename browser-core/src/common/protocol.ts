import type { VDocument, VNode, VStyleSheet } from "@domcorder/proto-ts";

export type Frame = {
    frameType: FrameType;
    data: TimestampData | 
      KeyframeData |
      AssetData |
      ViewportResizedData |
      WindowScrolledData |
      MouseMovedData |
      MouseClickedData |
      KeyPressedData |
      ElementFocusedData |
      TextSelectionChangedData |
      DomNodeAddedData |
      DomNodeRemovedData |
      DomAttributeChangedData |
      DomAttributeRemovedData |
      DomTextChangedData |
      DomNodeResizedData |
      AdoptedStyleSheetsChangedData |
      NewAdoptedStyleSheetData |
      ElementScrolledData |
      ElementBlurredData |
      WindowFocusedData |
      WindowBlurredData;
}

// TODO reflow these ids to be grouped better when
// we are done with the initial implementation.
export enum FrameType {
    Timestamp = 0,

    Keyframe = 1,
    Asset = 2,
    
    ViewportResized = 3,
    WindowScrolled = 4,

    MouseMoved = 5,
    MouseClicked = 6,
    KeyPressed = 7,
    ElementFocused = 8,
    TextSelectionChanged = 9,
    
    DomNodeAdded = 10,
    DomNodeRemoved = 11,
    DomAttributeChanged = 12,
    DomAttributeRemoved = 13,
    DomTextChanged = 14,
    DomNodeResized = 15,

    AdoptedStyleSheetsChanged = 16,
    AdoptedStyleSheetAdded = 17,

    ElementScrolled = 18,
    ElementBlurred = 19,
    WindowFocused = 20,
    WindowBlurred = 21,
}

export type TimestampData = {
    timestamp: number;
}

  
// This is new.
export type StyleSheetData = { id: string; media?: string; text?: string };
  

// This is a bit different, added asset count
// this allows us to not need an end frame.
export type KeyframeData = {
    document: VDocument;
    assetCount: number;
}

// This is new.
export type AssetData = {
    id: number;                    
    url: string;                 
    assetType: "image" | "font" | "binary"; // Not sure we need this.
    mime?: string;
    buf: ArrayBuffer;
}

export type ViewportResizedData = {
    width: number;
    height: number;
}

export type WindowScrolledData = {
    scrollXOffset: number;
    scrollYOffset: number;
}

export type ElementScrolledData = {
    id: number;
    scrollXOffset: number;
    scrollYOffset: number;
}

export type MouseMovedData = {
    x: number;
    y: number;
}

export type MouseClickedData = {
    x: number;
    y: number;
}

export type KeyPressedData = {
    key: string;
}

export type ElementFocusedData = {
    id: string;
}

export type ElementBlurredData = {
    id: string;
}

export type TextSelectionChangedData = {
    selectionStartNodeId: string;
    selectionStartOffset: number;
    selectionEndNodeId: string;
    selectionEndOffset: number;
}

export type DomNodeAddedData = {
    parentNodeId: number;
    index: number;
    node: VNode;
    assetCount: number;
}

export type DomNodeRemovedData = {
    nodeId: number;
}

export type DomAttributeChangedData = {
    nodeId: number;
    attributeName: string;
    attributeValue: string;
}

export type DomAttributeRemovedData = {
    nodeId: number;
    attributeName: string;
}
// The text changed frames are different now.
export type TextInsertOperationData = {
    op: 'insert';
    index: number;
    text: string;
}

export type TextRemoveOperationData = {
    op: 'remove';
    index: number;
    length: number;
}

export type TextOperationData = TextInsertOperationData | TextRemoveOperationData;

export type DomTextChangedData = {
    nodeId: number;
    operations: TextOperationData[];
}

// down to here.

export type DomNodeResizedData = {
    nodeId: number;
    width: number;
    height: number;
}

export type WindowFocusedData = {
}

export type WindowBlurredData = {
}

// Everything below here is not needed yet.
export type AdoptedStyleSheetsChangedData = {
    styleSheetIds: number[];
    addedCount: number;
}

export type NewAdoptedStyleSheetData = {
    styleSheet: VStyleSheet;
    assetCount: number;
}

export type StyleSheetRuleInsertedData = {
    styleSheetId: number;
    ruleIndex: number;
    content: string;
    assetCount: number;
}

export type StyleSheetRuleDeletedData = {
    styleSheetId: number;
    ruleIndex: number;
}

export type StyleSheetReplacedData = {
    styleSheetId: number;
    content: string;
    assetCount: number;
}
