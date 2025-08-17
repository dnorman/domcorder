import { Writer } from "./writer.ts";
import { FrameType } from "./protocol.ts";
import { DomNode } from "./domnode.ts";



// Helper function
const toU64 = (v: number | bigint) => (typeof v === "bigint" ? v : BigInt(v));

export class TimestampDataEnc {
    static readonly tag = FrameType.Timestamp;
    private constructor() { }
    static async encode(w: Writer, timestamp: number | bigint): Promise<void> {
        if ((w as any).debug) console.log(`\n=== FRAME ${FrameType.Timestamp}: Timestamp ===`);
        w.u32(FrameType.Timestamp);         // enum variant index
        w.u64(toU64(timestamp));            // timestamp value
        await w.endFrame();
    }
}

export class KeyframeDataEnc {
    static readonly tag = FrameType.Keyframe;
    private constructor() { }

    // Regular async - yields only at frame boundary
    static async encode(w: Writer, document: Document): Promise<void> {
        w.u32(this.tag);

        // Extract doctype from document - use full DOCTYPE string to match Rust
        const docType = "<!DOCTYPE html>";
        w.strUtf8(docType);

        // Encode the document element synchronously
        DomNode.encode(w, document.documentElement);
        await w.endFrame();
    }

    // Streaming async - can yield during DOM recursion
    static async encodeStreaming(w: Writer, document: Document): Promise<void> {
        w.u32(this.tag);

        // Extract doctype from document - use full DOCTYPE string to match Rust
        const docType = "<!DOCTYPE html>";
        w.strUtf8(docType);

        // Encode the document element with streaming
        await DomNode.encodeStreaming(w, document.documentElement);
        await w.endFrame();
    }
}

export class ViewportResizedDataEnc {
    static readonly tag = FrameType.ViewportResized;
    private constructor() { }
    static async encode(w: Writer, width: number, height: number): Promise<void> {
        w.u32(this.tag);
        w.u32(width);  // u32 BE
        w.u32(height); // u32 BE
        await w.endFrame();
    }
}

export class ScrollOffsetChangedDataEnc {
    static readonly tag = FrameType.ScrollOffsetChanged;
    private constructor() { }
    static async encode(w: Writer, scroll_x_offset: number, scroll_y_offset: number): Promise<void> {
        w.u32(this.tag);
        w.u32(scroll_x_offset); // u32 BE
        w.u32(scroll_y_offset); // u32 BE
        await w.endFrame();
    }
}

export class MouseMovedDataEnc {
    static readonly tag = FrameType.MouseMoved;
    private constructor() { }
    static async encode(w: Writer, x: number, y: number): Promise<void> {
        w.u32(this.tag);
        w.u32(x); // u32 BE
        w.u32(y); // u32 BE
        await w.endFrame();
    }
}

export class MouseClickedDataEnc {
    static readonly tag = FrameType.MouseClicked;
    private constructor() { }
    static async encode(w: Writer, x: number, y: number): Promise<void> {
        w.u32(this.tag);
        w.u32(x); // u32 BE
        w.u32(y); // u32 BE
        await w.endFrame();
    }
}

export class KeyPressedDataEnc {
    static readonly tag = FrameType.KeyPressed;
    private constructor() { }
    static async encode(w: Writer, key: string): Promise<void> {
        w.u32(this.tag);
        w.strUtf8(key); // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}

export class ElementFocusedDataEnc {
    static readonly tag = FrameType.ElementFocused;
    private constructor() { }
    static async encode(w: Writer, elementId: number | bigint): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(elementId)); // u64 BE
        await w.endFrame();
    }
}

export class TextSelectionChangedDataEnc {
    static readonly tag = FrameType.TextSelectionChanged;
    private constructor() { }
    static async encode(w: Writer, selectionStartNodeId: number | bigint, selectionStartOffset: number, selectionEndNodeId: number | bigint, selectionEndOffset: number): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(selectionStartNodeId)); // u64 BE
        w.u32(selectionStartOffset);        // u32 BE
        w.u64(toU64(selectionEndNodeId));   // u64 BE
        w.u32(selectionEndOffset);          // u32 BE
        await w.endFrame();
    }
}

export class DomNodeAddedDataEnc {
    static readonly tag = FrameType.DomNodeAdded;
    private constructor() { }

    // Regular async - yields only at frame boundary
    static async encode(w: Writer, parentNodeId: number | bigint, index: number, node: Node): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(parentNodeId)); // u64 BE
        w.u32(index);               // u32 BE
        DomNode.encode(w, node);    // Encode the node synchronously
        await w.endFrame();
    }

    // Streaming async - can yield during node encoding
    static async encodeStreaming(w: Writer, parentNodeId: number | bigint, index: number, node: Node): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(parentNodeId)); // u64 BE
        w.u32(index);               // u32 BE
        await DomNode.encodeStreaming(w, node);  // Encode the node with streaming
        await w.endFrame();
    }
}

export class DomNodeRemovedDataEnc {
    static readonly tag = FrameType.DomNodeRemoved;
    private constructor() { }
    static async encode(w: Writer, parentNodeId: number | bigint, index: number): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(parentNodeId)); // u64 BE
        w.u32(index);               // u32 BE
        await w.endFrame();
    }
}

export class DomAttributeChangedDataEnc {
    static readonly tag = FrameType.DomAttributeChanged;
    private constructor() { }
    static async encode(w: Writer, nodeId: number | bigint, attributeName: string, attributeValue: string): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(nodeId));     // u64 BE
        w.strUtf8(attributeName); // u64 length + UTF-8 bytes (BE)
        w.strUtf8(attributeValue); // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}

export class DomAttributeRemovedDataEnc {
    static readonly tag = FrameType.DomAttributeRemoved;
    private constructor() { }
    static async encode(w: Writer, nodeId: number | bigint, attributeName: string): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(nodeId));     // u64 BE
        w.strUtf8(attributeName); // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}

export class DomTextChangedDataEnc {
    static readonly tag = FrameType.DomTextChanged;
    private constructor() { }
    static async encode(w: Writer, nodeId: number | bigint, text: string): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(nodeId)); // u64 BE
        w.strUtf8(text);      // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}

export class DomNodeResizedDataEnc {
    static readonly tag = FrameType.DomNodeResized;
    private constructor() { }
    static async encode(w: Writer, nodeId: number | bigint, width: number, height: number): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(nodeId)); // u64 BE
        w.u32(width);         // u32 BE
        w.u32(height);        // u32 BE
        await w.endFrame();
    }
}

export class StyleSheetChangedDataEnc {
    static readonly tag = FrameType.StyleSheetChanged;
    private constructor() { }
    static async encode(w: Writer): Promise<void> {
        w.u32(this.tag);
        // TODO: Add data fields when StyleSheetChangedData is defined
        await w.endFrame();
    }
}