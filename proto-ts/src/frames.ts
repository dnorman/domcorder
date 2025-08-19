import { Writer } from "./writer.ts";
import { FrameType, type TextOperationData } from "./protocol.ts";
import { VNode, VDocument } from "./vdom.ts";



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
    static async encode(w: Writer, vdocument: VDocument): Promise<void> {
        w.u32(this.tag);

        // Extract doctype from document - use full DOCTYPE string to match Rust
        const docType = "<!DOCTYPE html>";
        w.strUtf8(docType);

        // Encode the VDocument synchronously
        vdocument.encode(w);
        await w.endFrame();
    }

    // Streaming async - can yield during DOM recursion
    static async encodeStreaming(w: Writer, vdocument: VDocument): Promise<void> {
        w.u32(this.tag);

        // Extract doctype from document - use full DOCTYPE string to match Rust
        const docType = "<!DOCTYPE html>";
        w.strUtf8(docType);

        // Encode the VDocument with streaming
        await vdocument.encodeStreaming(w);
        await w.endFrame();
    }
}

export class AssetDataEnc {
    static readonly tag = FrameType.Asset;
    private constructor() { }

    static async encode(w: Writer, id: number, url: string, assetType: string, mime: string | undefined, buf: ArrayBuffer): Promise<void> {
        w.u32(this.tag);
        w.u32(id);                    // u32 BE
        w.strUtf8(url);               // u64 length + UTF-8 bytes (BE)
        w.strUtf8(assetType);         // u64 length + UTF-8 bytes (BE)

        // Encode optional mime type
        if (mime) {
            w.byte(1); // Some flag
            w.strUtf8(mime);
        } else {
            w.byte(0); // None flag
        }

        // Encode buffer
        const bytes = new Uint8Array(buf);
        w.u64(BigInt(bytes.length));  // u64 length (BE)
        w.bytes(bytes);               // Raw bytes
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
    static async encode(w: Writer, parentNodeId: number | bigint, index: number, vnode: VNode): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(parentNodeId)); // u64 BE
        w.u32(index);               // u32 BE
        vnode.encode(w);            // Encode the VNode synchronously
        await w.endFrame();
    }

    // Streaming async - can yield during node encoding
    static async encodeStreaming(w: Writer, parentNodeId: number | bigint, index: number, vnode: VNode): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(parentNodeId)); // u64 BE
        w.u32(index);               // u32 BE
        await vnode.encodeStreaming(w);  // Encode the VNode with streaming
        await w.endFrame();
    }
}

export class DomNodeRemovedDataEnc {
    static readonly tag = FrameType.DomNodeRemoved;
    private constructor() { }
    static async encode(w: Writer, nodeId: number | bigint): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(nodeId)); // u64 BE
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
    static async encode(w: Writer, nodeId: number | bigint, operations: TextOperationData[]): Promise<void> {
        w.u32(this.tag);
        w.u64(toU64(nodeId)); // u64 BE

        // Encode the array of operations
        w.u64(BigInt(operations.length)); // u64 length (BE)

        for (const op of operations) {
            if (op.op === 'insert') {
                w.u32(0); // Insert variant = 0
                w.u32(op.index); // u32 BE
                w.strUtf8(op.text); // u64 length + UTF-8 bytes (BE)
            } else { // 'remove'
                w.u32(1); // Remove variant = 1
                w.u32(op.index); // u32 BE
                w.u32(op.length); // u32 BE
            }
        }

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