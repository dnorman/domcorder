// Shared frame generation for tests
import { JSDOM } from "jsdom";
import { Writer } from "../src/writer.ts";
import {
    Timestamp,
    Keyframe,
    Asset,
    ViewportResized,
    ScrollOffsetChanged,
    MouseMoved,
    MouseClicked,
    KeyPressed,
    ElementFocused,
    DomTextChanged,
    DomNodeAdded,
    DomNodeRemoved,
    DomAttributeChanged
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
    await new Timestamp(timestamp).encode(writer);

    // Frame 1: Keyframe with DOM
    const vdocument = convertDOMDocumentToVDocument(dom.window.document);
    await new Keyframe(vdocument, 1).encode(writer); // 1 asset follows

    // Frame 2: Asset (sample image data)
    const sampleImageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG header
    await new Asset(123, "https://example.com/image.png", "image/png", sampleImageData.buffer).encode(writer);

    // Frame 3: ViewportResized
    await new ViewportResized(1920, 1080).encode(writer);

    // Frame 4: ScrollOffsetChanged
    await new ScrollOffsetChanged(0, 240).encode(writer);

    // Frame 5: MouseMoved
    await new MouseMoved(150, 200).encode(writer);

    // Frame 6: MouseClicked
    await new MouseClicked(150, 200).encode(writer);

    // Frame 7: KeyPressed
    await new KeyPressed("Enter", false, false, false, false).encode(writer);

    // Frame 8: ElementFocused
    await new ElementFocused(42).encode(writer);

    // Frame 9: DomTextChanged with operations
    const textOperations = [
        { op: 'remove' as const, index: 0, length: 5 },  // Remove first 5 chars
        { op: 'insert' as const, index: 0, text: 'Updated' }  // Insert "Updated"
    ];
    await new DomTextChanged(42, textOperations).encode(writer);

    // Frame 10: DomNodeAdded
    const velement = convertDOMElementToVElement(createSimpleNode());
    await new DomNodeAdded(1, 0, velement, 0).encode(writer);

    // Frame 11: DomNodeRemoved
    await new DomNodeRemoved(43).encode(writer);

    // Frame 12: DomAttributeChanged
    await new DomAttributeChanged(42, "class", "updated-class").encode(writer);
}