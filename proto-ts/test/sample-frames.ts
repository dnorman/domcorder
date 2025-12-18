// Shared frame generation for tests
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
    TextSelectionChanged,
    DomTextChanged,
    DomNodeAdded,
    DomNodeRemoved,
    DomAttributeChanged,
    DomAttributeRemoved,
    DomNodeResized,
    AdoptedStyleSheetsChanged,
    NewAdoptedStyleSheet,
    ElementScrolled,
    ElementBlurred,
    WindowFocused,
    WindowBlurred
} from "../src/frames.ts";
import { VComment, VDocument, VDocumentType, VElement, VTextNode } from "../src/vdom.ts";
import { VStyleSheet } from "../src/vdom.ts";

// Hardcoded VDocument structure for tests
export const testVDocument = new VDocument(0, [], [
    new VDocumentType(1, "html", undefined, undefined),
    new VElement(2, "html", undefined, {}, [
        new VElement(3, "head", undefined, {}, [
            new VTextNode(4, "\n    "),
            new VElement(5, "meta", undefined, { "charset": "utf-8" }, []),
            new VTextNode(6, "\n    "),
            new VElement(7, "title", undefined, {}, [
                new VTextNode(8, "Test Document")
            ]),
            new VTextNode(9, "\n    "),
            new VComment(10, "?xml-stylesheet type=\"text/css\" href=\"style.css\"?"),
            new VTextNode(11, "\n")
        ]),
        new VTextNode(12, "\n"),
        new VElement(13, "body", undefined, {}, [
            new VTextNode(14, "\n    "),
            new VComment(15, " This is a comment "),
            new VTextNode(16, "\n    "),
            new VElement(17, "div", undefined, { "id": "root" }, [
                new VTextNode(18, "\n        "),
                new VElement(19, "h1", undefined, {}, [
                    new VTextNode(20, "Hello World")
                ]),
                new VTextNode(21, "\n        "),
                new VElement(22, "p", undefined, {}, [
                    new VTextNode(23, "This is a test paragraph.")
                ]),
                new VTextNode(24, "\n        "),
                new VElement(25, "button", undefined, { "onclick": "alert('clicked')" }, [
                    new VTextNode(26, "Click me")
                ]),
                new VTextNode(27, "\n        "),
                new VElement(28, "svg", "http://www.w3.org/2000/svg", { "width": "100", "height": "100" }, [
                    new VElement(29, "circle", "http://www.w3.org/2000/svg", { "cx": "50", "cy": "50", "r": "40", "fill": "red" }, [])
                ]),
                new VTextNode(30, "\n        "),
                new VComment(31, "[CDATA[This is CDATA content]]"),
                new VTextNode(32, "\n    ")
            ]),
            new VTextNode(33, "\n\n\n")
        ])
    ])
]);
/**
 * Generate the standard test frame sequence used across all tests
 */
// Create a simple node for testing DomNodeAdded
function createSimpleNode(): VElement {
    return new VElement(99, "span", undefined, { "class": "new-element" }, [
        new VTextNode(100, "New content")
    ]);
}

export async function generateTestFrames(writer: Writer): Promise<void> {
    const timestamp = 1722550000000n; // Fixed timestamp to match frames-basic.bin

    // Frame 0: Timestamp
    await new Timestamp(timestamp).encode(writer);

    // Frame 1: Keyframe with DOM
    const vdocument = testVDocument; // Use the hardcoded VDocument
    await new Keyframe(vdocument, 1920, 1080).encode(writer);

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
    const velement = createSimpleNode();
    await new DomNodeAdded(1, 0, velement).encode(writer);

    // Frame 11: DomNodeRemoved
    await new DomNodeRemoved(43).encode(writer);

    // Frame 12: DomAttributeChanged
    await new DomAttributeChanged(42, "class", "updated-class").encode(writer);

    // Frame 13: TextSelectionChanged
    await new TextSelectionChanged(42, 5, 42, 10).encode(writer);

    // Frame 14: DomAttributeRemoved
    await new DomAttributeRemoved(42, "onclick").encode(writer);

    // Frame 15: DomNodeResized
    await new DomNodeResized(42, 300, 200).encode(writer);

    // Frame 16: AdoptedStyleSheetsChanged
    await new AdoptedStyleSheetsChanged([1, 2, 3], 1).encode(writer);

    // Frame 17: NewAdoptedStyleSheet
    const testStyleSheet = new VStyleSheet(1, "body { color: red; }", "screen");
    await new NewAdoptedStyleSheet(testStyleSheet).encode(writer);

    // Frame 18: ElementScrolled
    await new ElementScrolled(42, 10, 20).encode(writer);

    // Frame 19: ElementBlurred
    await new ElementBlurred(42).encode(writer);

    // Frame 20: WindowFocused
    await new WindowFocused().encode(writer);

    // Frame 21: WindowBlurred
    await new WindowBlurred().encode(writer);
}