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

/// DOM Node - tagged union of all node types
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DomNode {
    Element(ElementNode),   // 0
    Text(TextNode),         // 1
    CData(CDataNode),       // 2
    Comment(CommentNode),   // 3
    Document(DocumentNode), // 4
    DocType(DocTypeNode),   // 5
}

/// HTML Document representation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HtmlDocument {
    pub doc_type: String,
    pub document_element: DomNode,
}

/// Frame data structures corresponding to TypeScript frame data types
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimestampData {
    pub timestamp: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyframeData {
    pub doc_type: String,
    pub document_element: DomNode,
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
    pub parent_node_id: u64,
    pub index: u32,
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
pub struct DomTextChangedData {
    pub node_id: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomNodeResizedData {
    pub node_id: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StyleSheetChangedData {
    // TODO: Add fields when defined
}

#[cfg(test)]
mod tests {
    use super::*;
    use bincode::Options;
    use std::fs;

    #[test]
    fn test_deserialize_typescript_generated_frames() {
        let binary_data = fs::read("tests/.resources/frames-basic.bin")
            .expect("Failed to read binary file from test resources");

        let mut cursor = std::io::Cursor::new(&binary_data);
        let mut frames = Vec::new();

        let config = bincode::config::DefaultOptions::new()
            .with_big_endian()
            .with_fixint_encoding();

        println!("Reading binary file ({} bytes)...", binary_data.len());

        while cursor.position() < binary_data.len() as u64 {
            match config.deserialize_from(&mut cursor) {
                Ok(frame) => {
                    frames.push(frame);
                }
                Err(e) => {
                    println!(
                        "Failed to deserialize frame at position {}: {}",
                        cursor.position(),
                        e
                    );
                    break;
                }
            }
        }

        println!("🎉 Successfully deserialized {} frames!", frames.len());

        // Validate specific frames
        assert!(
            !frames.is_empty(),
            "Should have deserialized at least one frame"
        );

        // Check first frame is Timestamp
        match &frames[0] {
            Frame::Timestamp(data) => {
                println!("✓ Frame 0: Timestamp = {}", data.timestamp);
                assert!(data.timestamp > 0, "Timestamp should be greater than 0");
            }
            _ => panic!("First frame should be Timestamp, got: {:?}", frames[0]),
        }

        // Check if we have ViewportResized frame
        let viewport_frame = frames
            .iter()
            .find(|f| matches!(f, Frame::ViewportResized(_)));
        if let Some(Frame::ViewportResized(data)) = viewport_frame {
            println!("✓ Found ViewportResized: {}x{}", data.width, data.height);
            assert_eq!(data.width, 1920);
            assert_eq!(data.height, 1080);
        }

        // Check if we have KeyPressed frame
        let key_frame = frames.iter().find(|f| matches!(f, Frame::KeyPressed(_)));
        if let Some(Frame::KeyPressed(data)) = key_frame {
            println!("✓ Found KeyPressed: '{}'", data.key);
            assert_eq!(data.key, "Enter");
        }

        println!("🦀 Rust successfully parsed TypeScript-generated bincode protocol!");
    }

    #[test]
    fn test_debug_keyframe_parsing() {
        let binary_data = fs::read("tests/.resources/debug-complex-keyframe.bin")
            .expect("Failed to read binary file from test resources");

        let config = bincode::config::DefaultOptions::new()
            .with_big_endian()
            .with_fixint_encoding();

        println!("Binary file size: {} bytes", binary_data.len());
        println!("First 64 bytes:");
        print_hex_dump(&binary_data[..64.min(binary_data.len())]);

        let mut cursor = std::io::Cursor::new(&binary_data);

        // Try to parse first frame (should be Timestamp)
        println!("\n--- Parsing frame 1 ---");
        match config.deserialize_from::<_, Frame>(&mut cursor) {
            Ok(frame) => {
                println!("✓ Frame 1: {:?}", frame);
                println!("Cursor position after frame 1: {}", cursor.position());
            }
            Err(e) => {
                println!("❌ Failed to parse frame 1: {}", e);
                return;
            }
        }

        // Try to parse second frame (should be Keyframe)
        println!("\n--- Parsing frame 2 ---");
        println!(
            "Remaining bytes: {}",
            binary_data.len() as u64 - cursor.position()
        );
        println!("Next 32 bytes:");
        let pos = cursor.position() as usize;
        if pos < binary_data.len() {
            let end = (pos + 32).min(binary_data.len());
            print_hex_dump(&binary_data[pos..end]);
        }

        match config.deserialize_from::<_, Frame>(&mut cursor) {
            Ok(frame) => {
                println!("✓ Frame 2: {:?}", frame);
                println!("Cursor position after frame 2: {}", cursor.position());
            }
            Err(e) => {
                println!("❌ Failed to parse frame 2: {}", e);
                println!("Cursor position when failed: {}", cursor.position());
                return;
            }
        }

        // Try to parse third frame (should be Keyframe)
        println!("\n--- Parsing frame 3 ---");
        println!(
            "Remaining bytes: {}",
            binary_data.len() as u64 - cursor.position()
        );
        println!("Next 32 bytes:");
        let pos = cursor.position() as usize;
        if pos < binary_data.len() {
            let end = (pos + 32).min(binary_data.len());
            print_hex_dump(&binary_data[pos..end]);
        }

        match config.deserialize_from::<_, Frame>(&mut cursor) {
            Ok(frame) => {
                println!("✓ Frame 3: {:?}", frame);
                println!("Cursor position after frame 3: {}", cursor.position());
            }
            Err(e) => {
                println!("❌ Failed to parse frame 3: {}", e);
                println!("Cursor position when failed: {}", cursor.position());
                return;
            }
        }

        // Try to parse all remaining frames
        let mut frame_count = 4;
        while (cursor.position() as usize) < binary_data.len() {
            println!("\n--- Parsing frame {} ---", frame_count);
            println!(
                "Remaining bytes: {}",
                binary_data.len() as u64 - cursor.position()
            );

            match config.deserialize_from::<_, Frame>(&mut cursor) {
                Ok(frame) => {
                    println!("✓ Frame {}: {:?}", frame_count, frame);
                    println!(
                        "Cursor position after frame {}: {}",
                        frame_count,
                        cursor.position()
                    );
                    frame_count += 1;
                }
                Err(e) => {
                    println!("❌ Failed to parse frame {}: {}", frame_count, e);
                    println!("Cursor position when failed: {}", cursor.position());
                    break;
                }
            }
        }

        println!("\n🎉 Successfully parsed {} frames total!", frame_count - 1);
    }

    #[test]
    fn test_rust_domnode_serialization() {
        let config = bincode::config::DefaultOptions::new()
            .with_big_endian()
            .with_fixint_encoding();

        // Create a simple DOM node structure
        let dom_node = DomNode::Element(ElementNode {
            tag_name: "div".to_string(),
            attributes: vec![
                ("class".to_string(), "test".to_string()),
                ("id".to_string(), "myid".to_string()),
            ],
            children: vec![DomNode::Text(TextNode {
                content: "Hello World".to_string(),
            })],
        });

        let serialized = config
            .serialize(&dom_node)
            .expect("Failed to serialize DomNode");

        println!("Rust DomNode serialized ({} bytes):", serialized.len());
        print_hex_dump(&serialized);

        // Try to deserialize it back
        let deserialized: DomNode = config
            .deserialize(&serialized)
            .expect("Failed to deserialize");
        println!(
            "✓ Successfully round-trip serialized DomNode: {:?}",
            deserialized
        );
    }

    #[test]
    fn test_rust_keyframe_serialization() {
        let config = bincode::config::DefaultOptions::new()
            .with_big_endian()
            .with_fixint_encoding();

        // Create a keyframe with the same structure as our test
        let dom_node = DomNode::Element(ElementNode {
            tag_name: "html".to_string(),
            attributes: vec![],
            children: vec![
                DomNode::Element(ElementNode {
                    tag_name: "head".to_string(),
                    attributes: vec![],
                    children: vec![],
                }),
                DomNode::Element(ElementNode {
                    tag_name: "body".to_string(),
                    attributes: vec![("class".to_string(), "app".to_string())],
                    children: vec![],
                }),
            ],
        });

        let keyframe = Frame::Keyframe(KeyframeData {
            doc_type: "<!DOCTYPE html>".to_string(),
            document_element: dom_node,
        });

        let serialized = config
            .serialize(&keyframe)
            .expect("Failed to serialize Keyframe");

        println!(
            "Rust Keyframe frame serialized ({} bytes):",
            serialized.len()
        );
        print_hex_dump(&serialized);
    }

    #[test]
    fn test_bincode_frame_serialization() {
        let config = bincode::config::DefaultOptions::new()
            .with_big_endian()
            .with_fixint_encoding();

        // Test 1: Timestamp frame
        let timestamp_frame = Frame::Timestamp(TimestampData {
            timestamp: 1722550000000,
        });
        let serialized = config
            .serialize(&timestamp_frame)
            .expect("Failed to serialize");
        println!("Timestamp frame ({} bytes):", serialized.len());
        print_hex_dump(&serialized);

        // Test 2: ViewportResized frame
        let viewport_frame = Frame::ViewportResized(ViewportResizedData {
            width: 1920,
            height: 1080,
        });
        let serialized = config
            .serialize(&viewport_frame)
            .expect("Failed to serialize");
        println!("\nViewportResized frame ({} bytes):", serialized.len());
        print_hex_dump(&serialized);

        // Test 3: KeyPressed frame
        let key_frame = Frame::KeyPressed(KeyPressedData {
            key: "Enter".to_string(),
        });
        let serialized = config.serialize(&key_frame).expect("Failed to serialize");
        println!("\nKeyPressed frame ({} bytes):", serialized.len());
        print_hex_dump(&serialized);
    }

    fn print_hex_dump(data: &[u8]) {
        for (i, chunk) in data.chunks(16).enumerate() {
            print!("{:04x}: ", i * 16);
            for byte in chunk {
                print!("{:02x} ", byte);
            }
            // Pad if less than 16 bytes
            for _ in chunk.len()..16 {
                print!("   ");
            }
            print!(" |");
            for byte in chunk {
                if *byte >= 32 && *byte <= 126 {
                    print!("{}", *byte as char);
                } else {
                    print!(".");
                }
            }
            println!("|");
        }
    }
}
