export interface Frame {
    frameType: FrameType;
    data: TimestampData | KeyframeData | ViewportResizedData | ScrollOffsetChangedData | MouseMovedData | MouseClickedData | KeyPressedData | ElementFocusedData | TextSelectionChangedData | DomNodeAddedData | DomNodeRemovedData | DomAttributeChangedData | DomAttributeRemovedData | DomTextChangedData | DomNodeResizedData | StyleSheetChangedData;
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
}

export interface TimestampData {
    timestamp: number;
}

export interface KeyframeData {
    document_element: object;
}

export interface ViewportResizedData {
    width: number;
    height: number;
}

export interface ScrollOffsetChangedData {
    scroll_x_offset: number;
    scroll_y_offset: number;
}

export interface MouseMovedData {
    x: number;
    y: number;
}

export interface MouseClickedData {
    x: number;
    y: number;
}

export interface KeyPressedData {
    key: string;
}

export interface ElementFocusedData {
    elementId: string;
}

export interface TextSelectionChangedData {
    selectionStartNodeId: string;
    selectionStartOffset: number;
    selectionEndNodeId: string;
    selectionEndOffset: number;
}

export interface DomNodeAddedData {
    parentNodeId: string;
    index: number;
    node: object;
}

export interface DomNodeRemovedData {
    parentNodeId: string;
    index: number;
}

export interface DomAttributeChangedData {
    nodeId: string;
    attributeName: string;
    attributeValue: string;
}

export interface DomAttributeRemovedData {
    nodeId: string;
    attributeName: string;
}

export interface DomTextChangedData {
    nodeId: string;
    text: string;
}

export interface DomNodeResizedData {
    nodeId: string;
    width: number;
    height: number;
}

export interface StyleSheetChangedData {
    // TODO Not sure what data we want here yet.
}
