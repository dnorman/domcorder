use domcorder_proto::*;

// Sample frames that should match the parsed sample frame data
pub fn sample_frames() -> Vec<Frame> {
    vec![
        Frame::Timestamp(TimestampData {
            timestamp: 1722550000000, // Use a fixed timestamp to match frames-basic.bin
        }),
        Frame::Keyframe(KeyframeData {
            document: HtmlDocument {
                id: 0, // Document ID (matches TypeScript testVDocument)
                children: vec![
                    // Child 0: DOCTYPE node
                    DomNode::DocType(DocTypeNode {
                        id: 1,
                        name: "html".to_string(),
                        public_id: None,
                        system_id: None,
                    }),
                    // Child 1: HTML element
                    DomNode::Element(ElementNode {
                        id: 2,
                        tag_name: "html".to_string(),
                        attributes: vec![],
                        children: vec![
                            // Child 0: HEAD element
                            DomNode::Element(ElementNode {
                                id: 3,
                                tag_name: "head".to_string(),
                                attributes: vec![],
                                children: vec![
                                    // Child 0: whitespace text node
                                    DomNode::Text(TextNode {
                                        id: 4,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 1: META element
                                    DomNode::Element(ElementNode {
                                        id: 5,
                                        tag_name: "meta".to_string(),
                                        attributes: vec![(
                                            "charset".to_string(),
                                            "utf-8".to_string(),
                                        )],
                                        children: vec![],
                                    }),
                                    // Child 2: whitespace text node
                                    DomNode::Text(TextNode {
                                        id: 6,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 3: TITLE element
                                    DomNode::Element(ElementNode {
                                        id: 7,
                                        tag_name: "title".to_string(),
                                        attributes: vec![],
                                        children: vec![DomNode::Text(TextNode {
                                            id: 8,
                                            content: "Test Document".to_string(),
                                        })],
                                    }),
                                    // Child 4: whitespace text node
                                    DomNode::Text(TextNode {
                                        id: 9,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 5: comment node
                                    DomNode::Comment(CommentNode {
                                        id: 10,
                                        content:
                                            "?xml-stylesheet type=\"text/css\" href=\"style.css\"?"
                                                .to_string(),
                                    }),
                                    // Child 6: whitespace text node
                                    DomNode::Text(TextNode {
                                        id: 11,
                                        content: "\n".to_string(),
                                    }),
                                ],
                            }),
                            // Child 1: whitespace text node
                            DomNode::Text(TextNode {
                                id: 12,
                                content: "\n".to_string(),
                            }),
                            // Child 2: BODY element
                            DomNode::Element(ElementNode {
                                id: 13,
                                tag_name: "body".to_string(),
                                attributes: vec![],
                                children: vec![
                                    // Child 0: whitespace text node
                                    DomNode::Text(TextNode {
                                        id: 14,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 1: comment node
                                    DomNode::Comment(CommentNode {
                                        id: 15,
                                        content: " This is a comment ".to_string(),
                                    }),
                                    // Child 2: whitespace text node
                                    DomNode::Text(TextNode {
                                        id: 16,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 3: DIV element
                                    DomNode::Element(ElementNode {
                                        id: 17,
                                        tag_name: "div".to_string(),
                                        attributes: vec![("id".to_string(), "root".to_string())],
                                        children: vec![
                                            DomNode::Text(TextNode {
                                                id: 18,
                                                content: "\n        ".to_string(),
                                            }),
                                            DomNode::Element(ElementNode {
                                                id: 19,
                                                tag_name: "h1".to_string(),
                                                attributes: vec![],
                                                children: vec![DomNode::Text(TextNode {
                                                    id: 20,
                                                    content: "Hello World".to_string(),
                                                })],
                                            }),
                                            DomNode::Text(TextNode {
                                                id: 21,
                                                content: "\n        ".to_string(),
                                            }),
                                            DomNode::Element(ElementNode {
                                                id: 22,
                                                tag_name: "p".to_string(),
                                                attributes: vec![],
                                                children: vec![DomNode::Text(TextNode {
                                                    id: 23,
                                                    content: "This is a test paragraph."
                                                        .to_string(),
                                                })],
                                            }),
                                            DomNode::Text(TextNode {
                                                id: 24,
                                                content: "\n        ".to_string(),
                                            }),
                                            DomNode::Element(ElementNode {
                                                id: 25,
                                                tag_name: "button".to_string(),
                                                attributes: vec![(
                                                    "onclick".to_string(),
                                                    "alert('clicked')".to_string(),
                                                )],
                                                children: vec![DomNode::Text(TextNode {
                                                    id: 26,
                                                    content: "Click me".to_string(),
                                                })],
                                            }),
                                            // Child 6: whitespace text node
                                            DomNode::Text(TextNode {
                                                id: 27,
                                                content: "\n        ".to_string(),
                                            }),
                                            DomNode::Comment(CommentNode {
                                                id: 28,
                                                content: "[CDATA[This is CDATA content]]"
                                                    .to_string(),
                                            }),
                                            DomNode::Text(TextNode {
                                                id: 29,
                                                content: "\n    ".to_string(),
                                            }),
                                        ],
                                    }),
                                    // Child 4: whitespace text node
                                    DomNode::Text(TextNode {
                                        id: 30,
                                        content: "\n\n\n".to_string(),
                                    }),
                                ],
                            }),
                        ],
                    }),
                ],
            },
            asset_count: 1,
        }),
        Frame::Asset(AssetData {
            asset_id: 123,
            url: "https://example.com/image.png".to_string(),
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
            code: "Enter".to_string(),
            ctrl_key: false,
            alt_key: false,
            shift_key: false,
            meta_key: false,
        }),
        Frame::ElementFocused(ElementFocusedData { node_id: 42 }),
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
                id: 99,
                tag_name: "span".to_string(),
                attributes: vec![("class".to_string(), "new-element".to_string())],
                children: vec![DomNode::Text(TextNode {
                    id: 100,
                    content: "New content".to_string(),
                })],
            }),
            asset_count: 0,
        }),
        Frame::DomNodeRemoved(DomNodeRemovedData { node_id: 43 }),
        Frame::DomAttributeChanged(DomAttributeChangedData {
            node_id: 42,
            attribute_name: "class".to_string(),
            attribute_value: "updated-class".to_string(),
        }),
        Frame::TextSelectionChanged(TextSelectionChangedData {
            selection_start_node_id: 42,
            selection_start_offset: 5,
            selection_end_node_id: 42,
            selection_end_offset: 10,
        }),
        Frame::DomAttributeRemoved(DomAttributeRemovedData {
            node_id: 42,
            attribute_name: "onclick".to_string(),
        }),
        Frame::DomNodeResized(DomNodeResizedData {
            node_id: 42,
            width: 300,
            height: 200,
        }),
        Frame::AdoptedStyleSheetsChanged(AdoptedStyleSheetsChangedData {
            style_sheet_ids: vec![1, 2, 3],
            added_count: 1,
        }),
        Frame::NewAdoptedStyleSheet(NewAdoptedStyleSheetData { asset_count: 0 }),
        Frame::ElementScrolled(ElementScrolledData {
            node_id: 42,
            scroll_x_offset: 10,
            scroll_y_offset: 20,
        }),
        Frame::ElementBlurred(ElementBlurredData { node_id: 42 }),
        Frame::WindowFocused(WindowFocusedData {}),
        Frame::WindowBlurred(WindowBlurredData {}),
    ]
}
