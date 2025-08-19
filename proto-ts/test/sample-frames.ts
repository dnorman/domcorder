// Shared frame generation for tests
import { JSDOM } from "jsdom";
import { Writer } from "../src/writer.ts";
import {
    TimestampDataEnc,
    KeyframeDataEnc,
    AssetDataEnc,
    ViewportResizedDataEnc,
    ScrollOffsetChangedDataEnc,
    MouseMovedDataEnc,
    MouseClickedDataEnc,
    KeyPressedDataEnc,
    ElementFocusedDataEnc,
    DomTextChangedDataEnc,
    DomNodeAddedDataEnc,
    DomNodeRemovedDataEnc,
    DomAttributeChangedDataEnc
} from "../src/frames.ts";
import { convertDOMDocumentToVDocument, convertDOMElementToVElement } from "../src/dom-converter.ts";

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

export async function generateTestFrames(writer: Writer): Promise<void> {
    const timestamp = 1722550000000n; // Fixed timestamp to match frames-basic.bin

    // Frame 0: Timestamp
    await TimestampDataEnc.encode(writer, timestamp);

    // Frame 1: Keyframe with DOM
    const vdocument = convertDOMDocumentToVDocument(dom.window.document);
    await KeyframeDataEnc.encode(writer, vdocument);

    // Frame 2: Asset (sample image data)
    const sampleImageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG header
    await AssetDataEnc.encode(writer, 123, "https://example.com/image.png", "image", "image/png", sampleImageData.buffer);

    // Frame 3: ViewportResized
    await ViewportResizedDataEnc.encode(writer, 1920, 1080);

    // Frame 4: ScrollOffsetChanged
    await ScrollOffsetChangedDataEnc.encode(writer, 0, 240);

    // Frame 5: MouseMoved
    await MouseMovedDataEnc.encode(writer, 150, 200);

    // Frame 6: MouseClicked
    await MouseClickedDataEnc.encode(writer, 150, 200);

    // Frame 7: KeyPressed
    await KeyPressedDataEnc.encode(writer, "Enter");

    // Frame 8: ElementFocused
    await ElementFocusedDataEnc.encode(writer, 42n);

    // Frame 9: DomTextChanged with operations
    const textOperations = [
        { op: 'remove' as const, index: 0, length: 5 },  // Remove first 5 chars
        { op: 'insert' as const, index: 0, text: 'Updated' }  // Insert "Updated"
    ];
    await DomTextChangedDataEnc.encode(writer, 42n, textOperations);

    // Frame 10: DomNodeAdded
    const velement = convertDOMElementToVElement(createSimpleNode());
    await DomNodeAddedDataEnc.encode(writer, 1n, 0, velement);

    // Frame 11: DomNodeRemoved
    await DomNodeRemovedDataEnc.encode(writer, 43n);

    // Frame 12: DomAttributeChanged
    await DomAttributeChangedDataEnc.encode(writer, 42n, "class", "updated-class");
}