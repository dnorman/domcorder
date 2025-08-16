// Shared frame generation for tests
import { JSDOM } from "jsdom";
import { Writer } from "../src/writer.ts";
import {
    TimestampDataEnc,
    KeyframeDataEnc,
    ViewportResizedDataEnc,
    ScrollOffsetChangedDataEnc,
    MouseMovedDataEnc,
    MouseClickedDataEnc,
    KeyPressedDataEnc,
    ElementFocusedDataEnc,
    DomTextChangedDataEnc,
    DomNodeAddedDataEnc,
    DomAttributeChangedDataEnc
} from "../src/frames.ts";

// Set up JSDOM for DOM polyfills  
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Test Document</title>
</head>
<body class="app">
    <div id="root">
        <h1>Hello World</h1>
        <p>This is a test paragraph.</p>
        <button onclick="alert('clicked')">Click me</button>
    </div>
</body>
</html>
`);

// Export DOM globals for tests
export function setupDOMGlobals() {
    globalThis.Document = dom.window.Document;
    globalThis.Element = dom.window.Element;
    globalThis.Text = dom.window.Text;
    globalThis.Comment = dom.window.Comment;
    globalThis.DocumentType = dom.window.DocumentType;
    globalThis.CDATASection = dom.window.CDATASection;
    globalThis.Node = dom.window.Node;
}

/**
 * Generate the standard test frame sequence used across all tests
 */
// Create a simple node for testing DomNodeAdded
function createSimpleNode(): Element {
    const span = dom.window.document.createElement('span');
    span.className = 'new-element';
    span.textContent = 'New content';
    return span;
}

export function generateTestFrames(writer: Writer): void {
    const timestamp = 1722550000000n; // Fixed timestamp to match frames-basic.bin
    
    // Frame 0: Timestamp
    TimestampDataEnc.encode(writer, timestamp);
    
    // Frame 1: Keyframe with DOM
    KeyframeDataEnc.encode(writer, dom.window.document);
    
    // Frame 2: ViewportResized
    ViewportResizedDataEnc.encode(writer, 1920, 1080);
    
    // Frame 3: ScrollOffsetChanged
    ScrollOffsetChangedDataEnc.encode(writer, 0, 240);
    
    // Frame 4: MouseMoved
    MouseMovedDataEnc.encode(writer, 150, 200);
    
    // Frame 5: MouseClicked
    MouseClickedDataEnc.encode(writer, 150, 200);
    
    // Frame 6: KeyPressed
    KeyPressedDataEnc.encode(writer, "Enter");
    
    // Frame 7: ElementFocused
    ElementFocusedDataEnc.encode(writer, 42n);
    
    // Frame 8: DomTextChanged
    DomTextChangedDataEnc.encode(writer, 42n, "Updated text content");
    
    // Frame 9: DomNodeAdded
    DomNodeAddedDataEnc.encode(writer, 1n, 0, createSimpleNode());
    
    // Frame 10: DomAttributeChanged
    DomAttributeChangedDataEnc.encode(writer, 42n, "class", "updated-class");
}