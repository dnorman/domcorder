export type Frame = {
    frameType: FrameType;
    data: TimestampData | KeyframeData | ViewportResizedData | ScrollOffsetChangedData | MouseMovedData | MouseClickedData | KeyPressedData | ElementFocusedData | TextSelectionChangedData | DomNodeAddedData | DomNodeRemovedData | DomAttributeChangedData | DomAttributeRemovedData | DomTextChangedData | DomNodeResizedData | StyleSheetChangedData | AssetData;
}

export enum FrameType {
    Timestamp = 0,

    Keyframe = 1,

    ViewportResized = 2,
    ScrollOffsetChanged = 3,

    MouseMoved = 4,
    MouseClicked = 5,
    KeyPressed = 6,
    ElementFocused = 7,
    TextSelectionChanged = 8,

    DomNodeAdded = 9,
    DomNodeRemoved = 10,
    DomAttributeChanged = 11,
    DomAttributeRemoved = 12,
    DomTextChanged = 13,
    DomNodeResized = 14,

    StyleSheetChanged = 15,

    Asset = 16,
}

export type TimestampData = {
    timestamp: number;
}

// DomNodeData has been replaced with VNode class hierarchy from vdom.ts

import { VNode } from './vdom.js';

export type HtmlDocumentData = {
    docType: string;
    documentElement: VNode;
}

export type KeyframeData = {
    document: HtmlDocumentData;
}

export type ViewportResizedData = {
    width: number;
    height: number;
}

export type ScrollOffsetChangedData = {
    scroll_x_offset: number;
    scroll_y_offset: number;
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
    elementId: string;
}

export type TextSelectionChangedData = {
    selectionStartNodeId: string;
    selectionStartOffset: number;
    selectionEndNodeId: string;
    selectionEndOffset: number;
}

export type DomNodeAddedData = {
    parentNodeId: string;
    index: number;
    node: VNode;
}

export type DomNodeRemovedData = {
    parentNodeId: string;
    index: number;
}

export type DomAttributeChangedData = {
    nodeId: string;
    attributeName: string;
    attributeValue: string;
}

export type DomAttributeRemovedData = {
    nodeId: string;
    attributeName: string;
}

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
    nodeId: string;
    operations: TextOperationData[];
}

export type DomNodeResizedData = {
    nodeId: string;
    width: number;
    height: number;
}

export type AssetData = {
    id: number;
    url: string;
    assetType: string; // "image" | "font" | "binary"
    mime?: string;
    buf: ArrayBuffer;
}

export type StyleSheetChangedData = {
    // TODO Not sure what data we want here yet.
}
