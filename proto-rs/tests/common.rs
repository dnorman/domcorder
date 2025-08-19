use domcorder_proto::*;

// Sample frames that should match the parsed sample frame data
pub fn sample_frames() -> Vec<Frame> {
    vec![
        Frame::Timestamp(TimestampData {
            timestamp: 1722550000000, // Use a fixed timestamp to match frames-basic.bin
        }),
        Frame::Keyframe(KeyframeData {
            doc_type: "<!DOCTYPE html>".to_string(),
            document: HtmlDocument {
                children: vec![
                    // Child 0: DOCTYPE node
                    DomNode::DocType(DocTypeNode {
                        name: "html".to_string(),
                        public_id: None,
                        system_id: None,
                    }),
                    // Child 1: HTML element
                    DomNode::Element(ElementNode {
                        tag_name: "html".to_string(),
                        attributes: vec![],
                        children: vec![
                            // Child 0: HEAD element
                            DomNode::Element(ElementNode {
                                tag_name: "head".to_string(),
                                attributes: vec![],
                                children: vec![
                                    // Child 0: whitespace text node
                                    DomNode::Text(TextNode {
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 1: META element
                                    DomNode::Element(ElementNode {
                                        tag_name: "meta".to_string(),
                                        attributes: vec![(
                                            "charset".to_string(),
                                            "utf-8".to_string(),
                                        )],
                                        children: vec![],
                                    }),
                                    // Child 2: whitespace text node
                                    DomNode::Text(TextNode {
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 3: TITLE element
                                    DomNode::Element(ElementNode {
                                        tag_name: "title".to_string(),
                                        attributes: vec![],
                                        children: vec![DomNode::Text(TextNode {
                                            content: "Test Document".to_string(),
                                        })],
                                    }),
                                    // Child 4: whitespace text node
                                    DomNode::Text(TextNode {
                                        content: "\n".to_string(),
                                    }),
                                ],
                            }),
                            // Child 1: whitespace text node between head and body
                            DomNode::Text(TextNode {
                                content: "\n".to_string(),
                            }),
                            // Child 2: BODY element
                            DomNode::Element(ElementNode {
                                tag_name: "body".to_string(),
                                attributes: vec![("class".to_string(), "app".to_string())],
                                children: vec![
                                    // Child 0: whitespace text node
                                    DomNode::Text(TextNode {
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 1: DIV element
                                    DomNode::Element(ElementNode {
                                        tag_name: "div".to_string(),
                                        attributes: vec![("id".to_string(), "root".to_string())],
                                        children: vec![
                                            DomNode::Text(TextNode {
                                                content: "\n        ".to_string(),
                                            }),
                                            DomNode::Element(ElementNode {
                                                tag_name: "h1".to_string(),
                                                attributes: vec![],
                                                children: vec![DomNode::Text(TextNode {
                                                    content: "Hello World".to_string(),
                                                })],
                                            }),
                                            DomNode::Text(TextNode {
                                                content: "\n        ".to_string(),
                                            }),
                                            DomNode::Element(ElementNode {
                                                tag_name: "p".to_string(),
                                                attributes: vec![],
                                                children: vec![DomNode::Text(TextNode {
                                                    content: "This is a test paragraph."
                                                        .to_string(),
                                                })],
                                            }),
                                            DomNode::Text(TextNode {
                                                content: "\n        ".to_string(),
                                            }),
                                            DomNode::Element(ElementNode {
                                                tag_name: "button".to_string(),
                                                attributes: vec![(
                                                    "onclick".to_string(),
                                                    "alert('clicked')".to_string(),
                                                )],
                                                children: vec![DomNode::Text(TextNode {
                                                    content: "Click me".to_string(),
                                                })],
                                            }),
                                            DomNode::Text(TextNode {
                                                content: "\n    ".to_string(),
                                            }),
                                        ],
                                    }),
                                    // Child 2: whitespace text node
                                    DomNode::Text(TextNode {
                                        content: "\n\n\n".to_string(),
                                    }),
                                ],
                            }),
                        ],
                    }),
                ], // End of HtmlDocument children array
            }, // End of HtmlDocument
        }),
        Frame::Asset(AssetData {
            id: 123,
            url: "https://example.com/image.png".to_string(),
            asset_type: "image".to_string(),
            mime: Some("image/png".to_string()),
            buf: vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], // PNG header
        }),
        Frame::ViewportResized(ViewportResizedData {
            width: 1920,
            height: 1080,
        }),
        Frame::ScrollOffsetChanged(ScrollOffsetChangedData {
            scroll_x_offset: 0,
            scroll_y_offset: 240,
        }),
        Frame::MouseMoved(MouseMovedData { x: 150, y: 200 }),
        Frame::MouseClicked(MouseClickedData { x: 150, y: 200 }),
        Frame::KeyPressed(KeyPressedData {
            key: "Enter".to_string(),
        }),
        Frame::ElementFocused(ElementFocusedData { element_id: 42 }),
        Frame::DomTextChanged(DomTextChangedData {
            node_id: 42,
            operations: vec![
                TextOperationData::Remove(TextRemoveOperationData {
                    index: 0,
                    length: 5,
                }),
                TextOperationData::Insert(TextInsertOperationData {
                    index: 0,
                    text: "Updated".to_string(),
                }),
            ],
        }),
        Frame::DomNodeAdded(DomNodeAddedData {
            parent_node_id: 1,
            index: 0,
            node: DomNode::Element(ElementNode {
                tag_name: "span".to_string(),
                attributes: vec![("class".to_string(), "new-element".to_string())],
                children: vec![DomNode::Text(TextNode {
                    content: "New content".to_string(),
                })],
            }),
        }),
        Frame::DomNodeRemoved(DomNodeRemovedData { node_id: 43 }),
        Frame::DomAttributeChanged(DomAttributeChangedData {
            node_id: 42,
            attribute_name: "class".to_string(),
            attribute_value: "updated-class".to_string(),
        }),
    ]
}
