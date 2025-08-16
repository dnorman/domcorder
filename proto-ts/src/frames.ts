import { Writer } from "./writer.ts";
import { FrameType } from "./protocol.ts";
import { DomNode } from "./domnode.ts";



// Helper function
const toU64 = (v: number | bigint) => (typeof v === "bigint" ? v : BigInt(v));

export class TimestampDataEnc {
    static readonly tag = FrameType.Timestamp;
    private constructor() { }
    static encode(w: Writer, timestamp: number | bigint): void {
        if ((w as any).debug) console.log(`\n=== FRAME ${FrameType.Timestamp}: Timestamp ===`);
        w.u32(FrameType.Timestamp);         // enum variant index
        w.u64(toU64(timestamp));            // timestamp value
    }
}

export class KeyframeDataEnc {
    static readonly tag = FrameType.Keyframe;
    private constructor() { }
    static encode(w: Writer, document: Document): void {
        w.u32(this.tag);

        // Extract doctype from document - use full DOCTYPE string to match Rust
        const docType = "<!DOCTYPE html>";
        w.strUtf8(docType);

        // Encode the document element
        DomNode.encode(w, document.documentElement);
    }
}

export class ViewportResizedDataEnc {
    static readonly tag = FrameType.ViewportResized;
    private constructor() { }
    static encode(w: Writer, width: number, height: number): void {
        w.u32(this.tag);
        w.u32(width);  // u32 BE
        w.u32(height); // u32 BE
    }
}

export class ScrollOffsetChangedDataEnc {
    static readonly tag = FrameType.ScrollOffsetChanged;
    private constructor() { }
    static encode(w: Writer, scroll_x_offset: number, scroll_y_offset: number): void {
        w.u32(this.tag);
        w.u32(scroll_x_offset); // u32 BE
        w.u32(scroll_y_offset); // u32 BE
    }
}

export class MouseMovedDataEnc {
    static readonly tag = FrameType.MouseMoved;
    private constructor() { }
    static encode(w: Writer, x: number, y: number): void {
        w.u32(this.tag);
        w.u32(x); // u32 BE
        w.u32(y); // u32 BE
    }
}

export class MouseClickedDataEnc {
    static readonly tag = FrameType.MouseClicked;
    private constructor() { }
    static encode(w: Writer, x: number, y: number): void {
        w.u32(this.tag);
        w.u32(x); // u32 BE
        w.u32(y); // u32 BE
    }
}

export class KeyPressedDataEnc {
    static readonly tag = FrameType.KeyPressed;
    private constructor() { }
    static encode(w: Writer, key: string): void {
        w.u32(this.tag);
        w.strUtf8(key); // u64 length + UTF-8 bytes (BE)
    }
}

export class ElementFocusedDataEnc {
    static readonly tag = FrameType.ElementFocused;
    private constructor() { }
    static encode(w: Writer, elementId: number | bigint): void {
        w.u32(this.tag);
        w.u64(toU64(elementId)); // u64 BE
    }
}

export class TextSelectionChangedDataEnc {
    static readonly tag = FrameType.TextSelectionChanged;
    private constructor() { }
    static encode(w: Writer, selectionStartNodeId: number | bigint, selectionStartOffset: number, selectionEndNodeId: number | bigint, selectionEndOffset: number): void {
        w.u32(this.tag);
        w.u64(toU64(selectionStartNodeId)); // u64 BE
        w.u32(selectionStartOffset);        // u32 BE
        w.u64(toU64(selectionEndNodeId));   // u64 BE
        w.u32(selectionEndOffset);          // u32 BE
    }
}

export class DomNodeAddedDataEnc {
    static readonly tag = FrameType.DomNodeAdded;
    private constructor() { }
    static encode(w: Writer, parentNodeId: number | bigint, index: number, node: Node): void {
        w.u32(this.tag);
        w.u64(toU64(parentNodeId)); // u64 BE
        w.u32(index);               // u32 BE
        DomNode.encode(w, node);    // Encode the node directly
    }
}

export class DomNodeRemovedDataEnc {
    static readonly tag = FrameType.DomNodeRemoved;
    private constructor() { }
    static encode(w: Writer, parentNodeId: number | bigint, index: number): void {
        w.u32(this.tag);
        w.u64(toU64(parentNodeId)); // u64 BE
        w.u32(index);               // u32 BE
    }
}

export class DomAttributeChangedDataEnc {
    static readonly tag = FrameType.DomAttributeChanged;
    private constructor() { }
    static encode(w: Writer, nodeId: number | bigint, attributeName: string, attributeValue: string): void {
        w.u32(this.tag);
        w.u64(toU64(nodeId));     // u64 BE
        w.strUtf8(attributeName); // u64 length + UTF-8 bytes (BE)
        w.strUtf8(attributeValue); // u64 length + UTF-8 bytes (BE)
    }
}

export class DomAttributeRemovedDataEnc {
    static readonly tag = FrameType.DomAttributeRemoved;
    private constructor() { }
    static encode(w: Writer, nodeId: number | bigint, attributeName: string): void {
        w.u32(this.tag);
        w.u64(toU64(nodeId));     // u64 BE
        w.strUtf8(attributeName); // u64 length + UTF-8 bytes (BE)
    }
}

export class DomTextChangedDataEnc {
    static readonly tag = FrameType.DomTextChanged;
    private constructor() { }
    static encode(w: Writer, nodeId: number | bigint, text: string): void {
        w.u32(this.tag);
        w.u64(toU64(nodeId)); // u64 BE
        w.strUtf8(text);      // u64 length + UTF-8 bytes (BE)
    }
}

export class DomNodeResizedDataEnc {
    static readonly tag = FrameType.DomNodeResized;
    private constructor() { }
    static encode(w: Writer, nodeId: number | bigint, width: number, height: number): void {
        w.u32(this.tag);
        w.u64(toU64(nodeId)); // u64 BE
        w.u32(width);         // u32 BE
        w.u32(height);        // u32 BE
    }
}

export class StyleSheetChangedDataEnc {
    static readonly tag = FrameType.StyleSheetChanged;
    private constructor() { }
    static encode(w: Writer): void {
        w.u32(this.tag);
        // TODO: Add data fields when StyleSheetChangedData is defined
    }
}