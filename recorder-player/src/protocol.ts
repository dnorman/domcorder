export type Frame = {
    frameType: FrameType;
    data: TimestampData | KeyframeData | ViewportResizedData | ScrollOffsetChangedData | MouseMovedData | MouseClickedData | KeyPressedData | ElementFocusedData | TextSelectionChangedData | DomNodeAddedData | DomNodeRemovedData | DomAttributeChangedData | DomAttributeRemovedData | DomTextChangedData | DomNodeResizedData;
}

export enum FrameType {
    Timestamp = 0,

    Keyframe = 1,
    Asset = 2,
    
    ViewportResized = 3,
    ScrollOffsetChanged = 4,

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

    StyleSheetChanged = 16,
}

export type TimestampData = {
    timestamp: number;
}

export type TextNodeData = {
    id: number;
    nodeType: "text"; 
    text: string
  };
  
  export type CDATASectionData = {
    id: number;
    nodeType: "cdata"; 
    data: string
  };
  
  export type CommentData = {
    id: number;
    nodeType: "comment"; 
    data: string
  };
  
  export type ProcessingInstructionData = {
    id: number;
    nodeType: "processingInstruction"; 
    target: string;
    data: string
  };
  
  export type DocumentTypeData = {
    id: number;
    nodeType: "documentType"; 
    name: string;
    publicId?: string;
    systemId?: string;
  };
  
  export type ElementData = {
    id: number;
    nodeType: "element";
    tag: string;
    ns?: string;
    attrs?: Record<string, string>;
    children?: NodeData[];
    shadow?: NodeData[];
  };
  
  export type NodeData = TextNodeData | ElementData | CDATASectionData | CommentData | ProcessingInstructionData | DocumentTypeData;
  
  // This is new.
  export type StyleSheetData = { id: string; media?: string; text?: string };
  
  // These properties changed a bi.
  export interface DocumentData {
    id: number;
    adoptedStyleSheets: StyleSheetData[];
    children: NodeData[];
  }

// This is a bit different, added asset count
// this allows us to not need an end frame.
export type KeyframeData = {
    document: DocumentData;
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
    parentNodeId: number;
    index: number;
    node: NodeData;
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

// Everything below here is not needed yet.
export type StyleSheetAddedData = {
    styleSheetId: number;
    content: string;
    assetCount: number;
}

export type StyleSheetRemovedData = {
    styleSheetId: number;
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
