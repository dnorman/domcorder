use domcorder_proto::*;

// Sample frames that should match the parsed sample frame data
pub fn sample_frames() -> Vec<Frame> {
    vec![
        Frame::Timestamp(TimestampData {
            timestamp: 1722550000000, // Use a fixed timestamp to match frames-basic.bin
        }),
        Frame::Keyframe(KeyframeData {
            document: VDocument {
                id: 0,                        // Document ID (matches TypeScript testVDocument)
                adopted_style_sheets: vec![], // Empty for now
                children: vec![
                    // Child 0: DOCTYPE node
                    VNode::DocType(VDocumentType {
                        id: 1,
                        name: "html".to_string(),
                        public_id: None,
                        system_id: None,
                    }),
                    // Child 1: HTML element
                    VNode::Element(VElement {
                        id: 2,
                        tag: "html".to_string(),
                        ns: None,
                        attrs: vec![],
                        children: vec![
                            // Child 0: HEAD element
                            VNode::Element(VElement {
                                id: 3,
                                tag: "head".to_string(),
                                ns: None,
                                attrs: vec![],
                                children: vec![
                                    // Child 0: whitespace text node
                                    VNode::Text(VTextNode {
                                        id: 4,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 1: META element
                                    VNode::Element(VElement {
                                        id: 5,
                                        tag: "meta".to_string(),
                                        ns: None,
                                        attrs: vec![("charset".to_string(), "utf-8".to_string())],
                                        children: vec![],
                                    }),
                                    // Child 2: whitespace text node
                                    VNode::Text(VTextNode {
                                        id: 6,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 3: TITLE element
                                    VNode::Element(VElement {
                                        id: 7,
                                        tag: "title".to_string(),
                                        ns: None,
                                        attrs: vec![],
                                        children: vec![VNode::Text(VTextNode {
                                            id: 8,
                                            content: "Test Document".to_string(),
                                        })],
                                    }),
                                    // Child 4: whitespace text node
                                    VNode::Text(VTextNode {
                                        id: 9,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 5: comment node
                                    VNode::Comment(VComment {
                                        id: 10,
                                        content:
                                            "?xml-stylesheet type=\"text/css\" href=\"style.css\"?"
                                                .to_string(),
                                    }),
                                    // Child 6: whitespace text node
                                    VNode::Text(VTextNode {
                                        id: 11,
                                        content: "\n".to_string(),
                                    }),
                                ],
                            }),
                            // Child 1: whitespace text node
                            VNode::Text(VTextNode {
                                id: 12,
                                content: "\n".to_string(),
                            }),
                            // Child 2: BODY element
                            VNode::Element(VElement {
                                id: 13,
                                tag: "body".to_string(),
                                ns: None,
                                attrs: vec![],
                                children: vec![
                                    // Child 0: whitespace text node
                                    VNode::Text(VTextNode {
                                        id: 14,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 1: comment node
                                    VNode::Comment(VComment {
                                        id: 15,
                                        content: " This is a comment ".to_string(),
                                    }),
                                    // Child 2: whitespace text node
                                    VNode::Text(VTextNode {
                                        id: 16,
                                        content: "\n    ".to_string(),
                                    }),
                                    // Child 3: DIV element
                                    VNode::Element(VElement {
                                        id: 17,
                                        tag: "div".to_string(),
                                        ns: None,
                                        attrs: vec![("id".to_string(), "root".to_string())],
                                        children: vec![
                                            VNode::Text(VTextNode {
                                                id: 18,
                                                content: "\n        ".to_string(),
                                            }),
                                            VNode::Element(VElement {
                                                id: 19,
                                                tag: "h1".to_string(),
                                                ns: None,
                                                attrs: vec![],
                                                children: vec![VNode::Text(VTextNode {
                                                    id: 20,
                                                    content: "Hello World".to_string(),
                                                })],
                                            }),
                                            VNode::Text(VTextNode {
                                                id: 21,
                                                content: "\n        ".to_string(),
                                            }),
                                            VNode::Element(VElement {
                                                id: 22,
                                                tag: "p".to_string(),
                                                ns: None,
                                                attrs: vec![],
                                                children: vec![VNode::Text(VTextNode {
                                                    id: 23,
                                                    content: "This is a test paragraph."
                                                        .to_string(),
                                                })],
                                            }),
                                            VNode::Text(VTextNode {
                                                id: 24,
                                                content: "\n        ".to_string(),
                                            }),
                                            VNode::Element(VElement {
                                                id: 25,
                                                tag: "button".to_string(),
                                                ns: None,
                                                attrs: vec![(
                                                    "onclick".to_string(),
                                                    "alert('clicked')".to_string(),
                                                )],
                                                children: vec![VNode::Text(VTextNode {
                                                    id: 26,
                                                    content: "Click me".to_string(),
                                                })],
                                            }),
                                            // Child 6: whitespace text node
                                            VNode::Text(VTextNode {
                                                id: 27,
                                                content: "\n        ".to_string(),
                                            }),
                                            // Child 7: SVG element with namespace
                                            VNode::Element(VElement {
                                                id: 28,
                                                tag: "svg".to_string(),
                                                ns: Some("http://www.w3.org/2000/svg".to_string()),
                                                attrs: vec![
                                                    ("width".to_string(), "100".to_string()),
                                                    ("height".to_string(), "100".to_string()),
                                                ],
                                                children: vec![VNode::Element(VElement {
                                                    id: 29,
                                                    tag: "circle".to_string(),
                                                    ns: Some(
                                                        "http://www.w3.org/2000/svg".to_string(),
                                                    ),
                                                    attrs: vec![
                                                        ("cx".to_string(), "50".to_string()),
                                                        ("cy".to_string(), "50".to_string()),
                                                        ("r".to_string(), "40".to_string()),
                                                        ("fill".to_string(), "red".to_string()),
                                                    ],
                                                    children: vec![],
                                                })],
                                            }),
                                            // Child 8: whitespace text node
                                            VNode::Text(VTextNode {
                                                id: 30,
                                                content: "\n        ".to_string(),
                                            }),
                                            VNode::Comment(VComment {
                                                id: 31,
                                                content: "[CDATA[This is CDATA content]]"
                                                    .to_string(),
                                            }),
                                            VNode::Text(VTextNode {
                                                id: 32,
                                                content: "\n    ".to_string(),
                                            }),
                                        ],
                                    }),
                                    // Child 4: whitespace text node
                                    VNode::Text(VTextNode {
                                        id: 33,
                                        content: "\n\n\n".to_string(),
                                    }),
                                ],
                            }),
                        ],
                    }),
                ],
            },
            asset_count: 1,
            viewport_width: 1920,
            viewport_height: 1080,
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
            node: VNode::Element(VElement {
                id: 99,
                tag: "span".to_string(),
                ns: None,
                attrs: vec![("class".to_string(), "new-element".to_string())],
                children: vec![VNode::Text(VTextNode {
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
        Frame::NewAdoptedStyleSheet(NewAdoptedStyleSheetData {
            style_sheet: VStyleSheet {
                id: 1,
                text: "body { color: red; }".to_string(),
                media: Some("screen".to_string()),
            },
            asset_count: 0,
        }),
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
