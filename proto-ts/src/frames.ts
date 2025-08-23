import { Writer } from "./writer.ts";
import { FrameType, type TextOperationData } from "./protocol.ts";
import { VNode, VDocument } from "./vdom.ts";



// Helper function
const toU64 = (v: number | bigint) => (typeof v === "bigint" ? v : BigInt(v));

export class TimestampDataEnc {
    static readonly tag = FrameType.Timestamp;

    constructor(public timestamp: number | bigint) { }

    async encode(w: Writer): Promise<void> {
        if ((w as any).debug) console.log(`\n=== FRAME ${FrameType.Timestamp}: Timestamp ===`);
        w.u32(FrameType.Timestamp);         // enum variant index
        w.u64(toU64(this.timestamp));       // timestamp value
        await w.endFrame();
    }
}

export class KeyframeDataEnc {
    static readonly tag = FrameType.Keyframe;

    constructor(public vdocument: VDocument) { }

    // Regular async - yields only at frame boundary
    async encode(w: Writer): Promise<void> {
        w.u32(KeyframeDataEnc.tag);

        // FIXME this needs to be removed.
        // Extract doctype from document - use full DOCTYPE string to match Rust
        const docType = "<!DOCTYPE html>";
        w.strUtf8(docType);

        // Encode the VDocument synchronously
        this.vdocument.encode(w);
        await w.endFrame();
    }

    // Streaming async - can yield during DOM recursion
    async encodeStreaming(w: Writer): Promise<void> {
        w.u32(KeyframeDataEnc.tag);

        // FIXME this needs to be removed.
        // Extract doctype from document - use full DOCTYPE string to match Rust
        const docType = "<!DOCTYPE html>";
        w.strUtf8(docType);

        // Encode the VDocument with streaming
        await this.vdocument.encodeStreaming(w);
        await w.endFrame();
    }
}

export class AssetDataEnc {
    static readonly tag = FrameType.Asset;

    constructor(
        public id: number,
        public url: string,
        public assetType: string,
        public mime: string | undefined,
        public buf: ArrayBuffer
    ) { }

    async encode(w: Writer): Promise<void> {
        w.u32(AssetDataEnc.tag);
        w.u32(this.id);                    // u32 BE
        w.strUtf8(this.url);               // u64 length + UTF-8 bytes (BE)
        w.strUtf8(this.assetType);         // u64 length + UTF-8 bytes (BE)

        // Encode optional mime type
        if (this.mime) {
            w.byte(1); // Some flag
            w.strUtf8(this.mime);
        } else {
            w.byte(0); // None flag
        }

        // Encode buffer
        const bytes = new Uint8Array(this.buf);
        w.u64(BigInt(bytes.length));  // u64 length (BE)
        w.bytes(bytes);               // Raw bytes
        await w.endFrame();
    }
}

export class ViewportResizedDataEnc {
    static readonly tag = FrameType.ViewportResized;

    constructor(public width: number, public height: number) { }

    async encode(w: Writer): Promise<void> {
        w.u32(ViewportResizedDataEnc.tag);
        w.u32(this.width);  // u32 BE
        w.u32(this.height); // u32 BE
        await w.endFrame();
    }
}

export class ScrollOffsetChangedDataEnc {
    static readonly tag = FrameType.ScrollOffsetChanged;

    constructor(public scroll_x_offset: number, public scroll_y_offset: number) { }

    async encode(w: Writer): Promise<void> {
        w.u32(ScrollOffsetChangedDataEnc.tag);
        w.u32(this.scroll_x_offset); // u32 BE
        w.u32(this.scroll_y_offset); // u32 BE
        await w.endFrame();
    }
}

export class MouseMovedDataEnc {
    static readonly tag = FrameType.MouseMoved;

    constructor(public x: number, public y: number) { }

    async encode(w: Writer): Promise<void> {
        w.u32(MouseMovedDataEnc.tag);
        w.u32(this.x); // u32 BE
        w.u32(this.y); // u32 BE
        await w.endFrame();
    }
}

export class MouseClickedDataEnc {
    static readonly tag = FrameType.MouseClicked;

    constructor(public x: number, public y: number) { }

    async encode(w: Writer): Promise<void> {
        w.u32(MouseClickedDataEnc.tag);
        w.u32(this.x); // u32 BE
        w.u32(this.y); // u32 BE
        await w.endFrame();
    }
}

export class KeyPressedDataEnc {
    static readonly tag = FrameType.KeyPressed;

    constructor(public key: string) { }

    async encode(w: Writer): Promise<void> {
        w.u32(KeyPressedDataEnc.tag);
        w.strUtf8(this.key); // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}

export class ElementFocusedDataEnc {
    static readonly tag = FrameType.ElementFocused;

    constructor(public elementId: number | bigint) { }

    async encode(w: Writer): Promise<void> {
        w.u32(ElementFocusedDataEnc.tag);
        w.u64(toU64(this.elementId)); // u64 BE
        await w.endFrame();
    }
}

export class TextSelectionChangedDataEnc {
    static readonly tag = FrameType.TextSelectionChanged;

    constructor(
        public selectionStartNodeId: number | bigint,
        public selectionStartOffset: number,
        public selectionEndNodeId: number | bigint,
        public selectionEndOffset: number
    ) { }

    async encode(w: Writer): Promise<void> {
        w.u32(TextSelectionChangedDataEnc.tag);
        w.u64(toU64(this.selectionStartNodeId)); // u64 BE
        w.u32(this.selectionStartOffset);        // u32 BE
        w.u64(toU64(this.selectionEndNodeId));   // u64 BE
        w.u32(this.selectionEndOffset);          // u32 BE
        await w.endFrame();
    }
}

export class DomNodeAddedDataEnc {
    static readonly tag = FrameType.DomNodeAdded;

    constructor(
        public parentNodeId: number | bigint,
        public index: number,
        public vnode: VNode
    ) { }

    // Regular async - yields only at frame boundary
    async encode(w: Writer): Promise<void> {
        w.u32(DomNodeAddedDataEnc.tag);
        w.u64(toU64(this.parentNodeId)); // u64 BE
        w.u32(this.index);               // u32 BE
        this.vnode.encode(w);            // Encode the VNode synchronously
        await w.endFrame();
    }

    // Streaming async - can yield during node encoding
    async encodeStreaming(w: Writer): Promise<void> {
        w.u32(DomNodeAddedDataEnc.tag);
        w.u64(toU64(this.parentNodeId)); // u64 BE
        w.u32(this.index);               // u32 BE
        await this.vnode.encodeStreaming(w);  // Encode the VNode with streaming
        await w.endFrame();
    }
}

export class DomNodeRemovedDataEnc {
    static readonly tag = FrameType.DomNodeRemoved;

    constructor(public nodeId: number | bigint) { }

    async encode(w: Writer): Promise<void> {
        w.u32(DomNodeRemovedDataEnc.tag);
        w.u64(toU64(this.nodeId)); // u64 BE
        await w.endFrame();
    }
}

export class DomAttributeChangedDataEnc {
    static readonly tag = FrameType.DomAttributeChanged;

    constructor(
        public nodeId: number | bigint,
        public attributeName: string,
        public attributeValue: string
    ) { }

    async encode(w: Writer): Promise<void> {
        w.u32(DomAttributeChangedDataEnc.tag);
        w.u64(toU64(this.nodeId));     // u64 BE
        w.strUtf8(this.attributeName); // u64 length + UTF-8 bytes (BE)
        w.strUtf8(this.attributeValue); // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}

export class DomAttributeRemovedDataEnc {
    static readonly tag = FrameType.DomAttributeRemoved;

    constructor(
        public nodeId: number | bigint,
        public attributeName: string
    ) { }

    async encode(w: Writer): Promise<void> {
        w.u32(DomAttributeRemovedDataEnc.tag);
        w.u64(toU64(this.nodeId));     // u64 BE
        w.strUtf8(this.attributeName); // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}

export class DomTextChangedDataEnc {
    static readonly tag = FrameType.DomTextChanged;

    constructor(
        public nodeId: number | bigint,
        public operations: TextOperationData[]
    ) { }

    async encode(w: Writer): Promise<void> {
        w.u32(DomTextChangedDataEnc.tag);
        w.u64(toU64(this.nodeId)); // u64 BE

        // Encode the array of operations
        w.u64(BigInt(this.operations.length)); // u64 length (BE)

        for (const op of this.operations) {
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

    constructor(
        public nodeId: number | bigint,
        public width: number,
        public height: number
    ) { }

    async encode(w: Writer): Promise<void> {
        w.u32(DomNodeResizedDataEnc.tag);
        w.u64(toU64(this.nodeId)); // u64 BE
        w.u32(this.width);         // u32 BE
        w.u32(this.height);        // u32 BE
        await w.endFrame();
    }
}

export class StyleSheetChangedDataEnc {
    static readonly tag = FrameType.StyleSheetChanged;

    constructor() { }

    async encode(w: Writer): Promise<void> {
        w.u32(StyleSheetChangedDataEnc.tag);
        // TODO: Add data fields when StyleSheetChangedData is defined
        await w.endFrame();
    }
}