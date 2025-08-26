use serde::{Deserialize, Serialize};

/// Element node representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VElement {
    pub id: u32,
    pub tag: String,
    pub ns: Option<String>,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<VNode>,
}

/// Text node representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VTextNode {
    pub id: u32,
    pub content: String, // TODO: Rename to text for TS parity
}

/// CDATA section representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VCDATASection {
    // TODO: Rename to VCDATASection (capital CDATA) for TS parity
    pub id: u32,
    pub content: String, // TODO: Rename to data for TS parity
}

/// Comment node representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VComment {
    pub id: u32,
    pub content: String, // TODO: Rename to data for TS parity
}

/// DocType node representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VDocumentType {
    pub id: u32,
    pub name: String,
    pub public_id: Option<String>, // TODO: Rename to publicId for TS parity
    pub system_id: Option<String>, // TODO: Rename to systemId for TS parity
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VProcessingInstruction {
    pub id: u32,
    pub target: String,
    pub data: String,
}

/// DOM Node - tagged union of all node types
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum VNode {
    Element(VElement),                             // 0
    Text(VTextNode),                               // 1
    CData(VCDATASection),                          // 2
    Comment(VComment),                             // 3
    DocType(VDocumentType),                        // 4
    ProcessingInstruction(VProcessingInstruction), // 5
}

/// VStyleSheet representation - matches TypeScript VStyleSheet
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VStyleSheet {
    pub id: u32,
    pub text: String,
    pub media: Option<String>,
}

/// HTML Document representation - matches TypeScript VDocument
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VDocument {
    pub id: u32,
    pub adopted_style_sheets: Vec<VStyleSheet>, // TODO: Rename to adoptedStyleSheets for TS parity
    pub children: Vec<VNode>, // Array of children (typically DOCTYPE + HTML element)
}
