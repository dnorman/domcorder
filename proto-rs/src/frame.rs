use serde::{Deserialize, Serialize};

/// Frame types - each frame is its own struct
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u32)]
pub enum Frame {
    Timestamp(TimestampData) = 0,
    Keyframe(KeyframeData) = 1,
    ViewportResized(ViewportResizedData) = 2,
    ScrollOffsetChanged(ScrollOffsetChangedData) = 3,
    MouseMoved(MouseMovedData) = 4,
    MouseClicked(MouseClickedData) = 5,
    KeyPressed(KeyPressedData) = 6,
    ElementFocused(ElementFocusedData) = 7,
    TextSelectionChanged(TextSelectionChangedData) = 8,
    DomNodeAdded(DomNodeAddedData) = 9,
    DomNodeRemoved(DomNodeRemovedData) = 10,
    DomAttributeChanged(DomAttributeChangedData) = 11,
    DomAttributeRemoved(DomAttributeRemovedData) = 12,
    DomTextChanged(DomTextChangedData) = 13,
    DomNodeResized(DomNodeResizedData) = 14,
    StyleSheetChanged(StyleSheetChangedData) = 15,
    Asset(AssetData) = 16,
}

/// Element node representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ElementNode {
    pub tag_name: String,
    pub attributes: Vec<(String, String)>, // (name, value) pairs
    pub children: Vec<DomNode>,
}

/// Text node representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextNode {
    pub content: String,
}

/// CDATA section representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CDataNode {
    pub content: String,
}

/// Comment node representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentNode {
    pub content: String,
}

/// Document node representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentNode {
    pub children: Vec<DomNode>,
}

/// DocType node representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocTypeNode {
    pub name: String,
    pub public_id: Option<String>,
    pub system_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessingInstructionNode {
    pub target: String,
    pub data: String,
}

/// DOM Node - tagged union of all node types
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DomNode {
    Element(ElementNode),                             // 0
    Text(TextNode),                                   // 1
    CData(CDataNode),                                 // 2
    Comment(CommentNode),                             // 3
    DocType(DocTypeNode),                             // 4
    ProcessingInstruction(ProcessingInstructionNode), // 5
}

/// HTML Document representation - matches TypeScript VDocument
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HtmlDocument {
    pub children: Vec<DomNode>, // Array of children (typically DOCTYPE + HTML element)
}

/// Frame data structures corresponding to TypeScript frame data types
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimestampData {
    pub timestamp: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyframeData {
    pub doc_type: String,
    pub document: HtmlDocument, // Now contains the full document structure
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewportResizedData {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScrollOffsetChangedData {
    pub scroll_x_offset: u32,
    pub scroll_y_offset: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouseMovedData {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouseClickedData {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyPressedData {
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ElementFocusedData {
    pub element_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextSelectionChangedData {
    pub selection_start_node_id: u64,
    pub selection_start_offset: u32,
    pub selection_end_node_id: u64,
    pub selection_end_offset: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomNodeAddedData {
    pub parent_node_id: u64,
    pub index: u32,
    pub node: DomNode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomNodeRemovedData {
    pub node_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomAttributeChangedData {
    pub node_id: u64,
    pub attribute_name: String,
    pub attribute_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomAttributeRemovedData {
    pub node_id: u64,
    pub attribute_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextInsertOperationData {
    pub index: u32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextRemoveOperationData {
    pub index: u32,
    pub length: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u32)]
pub enum TextOperationData {
    Insert(TextInsertOperationData) = 0,
    Remove(TextRemoveOperationData) = 1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomTextChangedData {
    pub node_id: u64,
    pub operations: Vec<TextOperationData>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomNodeResizedData {
    pub node_id: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetData {
    pub id: u32,
    pub url: String,
    pub asset_type: String,
    pub mime: Option<String>,
    pub buf: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StyleSheetChangedData {
    // TODO: Add fields when defined
}
