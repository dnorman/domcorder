import { Writer } from "./writer.ts";
import { VNode, VDocument } from "./vdom.ts";


export enum FrameType {
    Timestamp = 0,

    Keyframe = 1,

    ViewportResized = 2,
    ScrollOffsetChanged = 3,

    MouseMoved = 4,
    MouseClicked = 5,
    KeyPressed = 6,
    ElementFocused = 7,
    TextSelectionChanged = 8,

    DomNodeAdded = 9,
    DomNodeRemoved = 10,
    DomAttributeChanged = 11,
    DomAttributeRemoved = 12,
    DomTextChanged = 13,
    DomNodeResized = 14,

    StyleSheetChanged = 15,

    Asset = 16,
}

// BufferReader interface for decoding
interface BufferReader {
    readU32(): number;
    readU64(): bigint;
    readString(): string;
    readBytes(length: number): Uint8Array;
    peekU32(): number; // Peek at next u32 without consuming it
}

type DecoderFn = (r: BufferReader) => Frame | null;

const DECODERS: (DecoderFn | undefined)[] = [];
// populated below


// Helper function
const toU64 = (v: number | bigint) => (typeof v === "bigint" ? v : BigInt(v));

// Abstract base class for all frames
export abstract class Frame {
    abstract encode(w: Writer): Promise<void>;

    // Static factory method that handles frame type dispatch
    static decode(reader: BufferReader): Frame | null {
        const t = reader.peekU32(); // Peek at frame type without consuming it
        const dec = DECODERS[t]; // direct indexed lookup
        return dec ? dec(reader) : null;
    }
}

export class TimestampDataEnc extends Frame {
    constructor(public timestamp: number | bigint) {
        super();
    }

    static decode(reader: BufferReader): TimestampDataEnc | null {
        if (reader.readU32() !== FrameType.Timestamp) return null;
        const timestamp = reader.readU64();
        return new TimestampDataEnc(timestamp);
    }

    async encode(w: Writer): Promise<void> {
        if ((w as any).debug) console.log(`\n=== FRAME ${FrameType.Timestamp}: Timestamp ===`);
        w.u32(FrameType.Timestamp);         // enum variant index
        w.u64(toU64(this.timestamp));       // timestamp value
        await w.endFrame();
    }
}

export class KeyframeDataEnc extends Frame {
    constructor(public vdocument: VDocument) {
        super();
    }

    static decode(reader: BufferReader): KeyframeDataEnc | null {
        if (reader.readU32() !== FrameType.Keyframe) return null;
        const docType = reader.readString(); // Read and ignore doctype for now
        const vdocument = VDocument.decode(reader);
        return new KeyframeDataEnc(vdocument);
    }

    // Regular async - yields only at frame boundary
    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.Keyframe);

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
        w.u32(FrameType.Keyframe);

        // FIXME this needs to be removed.
        // Extract doctype from document - use full DOCTYPE string to match Rust
        const docType = "<!DOCTYPE html>";
        w.strUtf8(docType);

        // Encode the VDocument with streaming
        await this.vdocument.encodeStreaming(w);
        await w.endFrame();
    }
}

export class AssetDataEnc extends Frame {
    constructor(
        public id: number,
        public url: string,
        public assetType: string,
        public mime: string | undefined,
        public buf: ArrayBuffer
    ) {
        super();
    }

    static decode(reader: BufferReader): AssetDataEnc | null {
        if (reader.readU32() !== FrameType.Asset) return null;
        const id = reader.readU32();
        const url = reader.readString();
        const assetType = reader.readString();

        // Read optional mime type (this should be a byte, but we'll need to handle it properly)
        const hasFlag = reader.readU32(); // TODO: Should be readByte() when available
        const mime = hasFlag === 1 ? reader.readString() : undefined;

        // Read buffer
        const length = Number(reader.readU64());
        const bytes = reader.readBytes(length);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

        return new AssetDataEnc(id, url, assetType, mime, buf);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.Asset);
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

export class ViewportResizedDataEnc extends Frame {
    constructor(public width: number, public height: number) {
        super();
    }

    static decode(reader: BufferReader): ViewportResizedDataEnc | null {
        if (reader.readU32() !== FrameType.ViewportResized) return null;
        const width = reader.readU32();
        const height = reader.readU32();
        return new ViewportResizedDataEnc(width, height);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.ViewportResized);
        w.u32(this.width);  // u32 BE
        w.u32(this.height); // u32 BE
        await w.endFrame();
    }
}

export class ScrollOffsetChangedDataEnc extends Frame {
    constructor(public scroll_x_offset: number, public scroll_y_offset: number) {
        super();
    }

    static decode(reader: BufferReader): ScrollOffsetChangedDataEnc | null {
        if (reader.readU32() !== FrameType.ScrollOffsetChanged) return null;
        const scroll_x_offset = reader.readU32();
        const scroll_y_offset = reader.readU32();
        return new ScrollOffsetChangedDataEnc(scroll_x_offset, scroll_y_offset);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.ScrollOffsetChanged);
        w.u32(this.scroll_x_offset); // u32 BE
        w.u32(this.scroll_y_offset); // u32 BE
        await w.endFrame();
    }
}

export class MouseMovedDataEnc extends Frame {
    constructor(public x: number, public y: number) {
        super();
    }

    static decode(reader: BufferReader): MouseMovedDataEnc | null {
        if (reader.readU32() !== FrameType.MouseMoved) return null;
        const x = reader.readU32();
        const y = reader.readU32();
        return new MouseMovedDataEnc(x, y);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.MouseMoved);
        w.u32(this.x); // u32 BE
        w.u32(this.y); // u32 BE
        await w.endFrame();
    }
}

export class MouseClickedDataEnc extends Frame {
    constructor(public x: number, public y: number) {
        super();
    }

    static decode(reader: BufferReader): MouseClickedDataEnc | null {
        if (reader.readU32() !== FrameType.MouseClicked) return null;
        const x = reader.readU32();
        const y = reader.readU32();
        return new MouseClickedDataEnc(x, y);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.MouseClicked);
        w.u32(this.x); // u32 BE
        w.u32(this.y); // u32 BE
        await w.endFrame();
    }
}

export class KeyPressedDataEnc extends Frame {
    constructor(public key: string) {
        super();
    }

    static decode(reader: BufferReader): KeyPressedDataEnc | null {
        if (reader.readU32() !== FrameType.KeyPressed) return null;
        const key = reader.readString();
        return new KeyPressedDataEnc(key);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.KeyPressed);
        w.strUtf8(this.key); // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}

export class ElementFocusedDataEnc extends Frame {
    constructor(public elementId: number | bigint) {
        super();
    }

    static decode(reader: BufferReader): ElementFocusedDataEnc | null {
        if (reader.readU32() !== FrameType.ElementFocused) return null;
        const elementId = reader.readU64();
        return new ElementFocusedDataEnc(elementId);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.ElementFocused);
        w.u64(toU64(this.elementId)); // u64 BE
        await w.endFrame();
    }
}

export class TextSelectionChangedDataEnc extends Frame {
    constructor(
        public selectionStartNodeId: number | bigint,
        public selectionStartOffset: number,
        public selectionEndNodeId: number | bigint,
        public selectionEndOffset: number
    ) {
        super();
    }

    static decode(reader: BufferReader): TextSelectionChangedDataEnc | null {
        if (reader.readU32() !== FrameType.TextSelectionChanged) return null;
        const selectionStartNodeId = reader.readU64();
        const selectionStartOffset = reader.readU32();
        const selectionEndNodeId = reader.readU64();
        const selectionEndOffset = reader.readU32();
        return new TextSelectionChangedDataEnc(selectionStartNodeId, selectionStartOffset, selectionEndNodeId, selectionEndOffset);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.TextSelectionChanged);
        w.u64(toU64(this.selectionStartNodeId)); // u64 BE
        w.u32(this.selectionStartOffset);        // u32 BE
        w.u64(toU64(this.selectionEndNodeId));   // u64 BE
        w.u32(this.selectionEndOffset);          // u32 BE
        await w.endFrame();
    }
}

export class DomNodeAddedDataEnc extends Frame {
    constructor(
        public parentNodeId: number | bigint,
        public index: number,
        public vnode: VNode
    ) {
        super();
    }

    static decode(reader: BufferReader): DomNodeAddedDataEnc | null {
        if (reader.readU32() !== FrameType.DomNodeAdded) return null;
        const parentNodeId = reader.readU64();
        const index = reader.readU32();
        const vnode = VNode.decode(reader);
        return new DomNodeAddedDataEnc(parentNodeId, index, vnode);
    }

    // Regular async - yields only at frame boundary
    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.DomNodeAdded);
        w.u64(toU64(this.parentNodeId)); // u64 BE
        w.u32(this.index);               // u32 BE
        this.vnode.encode(w);            // Encode the VNode synchronously
        await w.endFrame();
    }

    // Streaming async - can yield during node encoding
    async encodeStreaming(w: Writer): Promise<void> {
        w.u32(FrameType.DomNodeAdded);
        w.u64(toU64(this.parentNodeId)); // u64 BE
        w.u32(this.index);               // u32 BE
        await this.vnode.encodeStreaming(w);  // Encode the VNode with streaming
        await w.endFrame();
    }
}

export class DomNodeRemovedDataEnc extends Frame {
    constructor(public nodeId: number | bigint) {
        super();
    }

    static decode(reader: BufferReader): DomNodeRemovedDataEnc | null {
        if (reader.readU32() !== FrameType.DomNodeRemoved) return null;
        const nodeId = reader.readU64();
        return new DomNodeRemovedDataEnc(nodeId);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.DomNodeRemoved);
        w.u64(toU64(this.nodeId)); // u64 BE
        await w.endFrame();
    }
}

export class DomAttributeChangedDataEnc extends Frame {
    constructor(
        public nodeId: number | bigint,
        public attributeName: string,
        public attributeValue: string
    ) {
        super();
    }

    static decode(reader: BufferReader): DomAttributeChangedDataEnc | null {
        if (reader.readU32() !== FrameType.DomAttributeChanged) return null;
        const nodeId = reader.readU64();
        const attributeName = reader.readString();
        const attributeValue = reader.readString();
        return new DomAttributeChangedDataEnc(nodeId, attributeName, attributeValue);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.DomAttributeChanged);
        w.u64(toU64(this.nodeId));     // u64 BE
        w.strUtf8(this.attributeName); // u64 length + UTF-8 bytes (BE)
        w.strUtf8(this.attributeValue); // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}

export class DomAttributeRemovedDataEnc extends Frame {
    constructor(
        public nodeId: number | bigint,
        public attributeName: string
    ) {
        super();
    }

    static decode(reader: BufferReader): DomAttributeRemovedDataEnc | null {
        if (reader.readU32() !== FrameType.DomAttributeRemoved) return null;
        const nodeId = reader.readU64();
        const attributeName = reader.readString();
        return new DomAttributeRemovedDataEnc(nodeId, attributeName);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.DomAttributeRemoved);
        w.u64(toU64(this.nodeId));     // u64 BE
        w.strUtf8(this.attributeName); // u64 length + UTF-8 bytes (BE)
        await w.endFrame();
    }
}


export type TextInsertOperationData = {
    op: 'insert';
    index: number;
    text: string;
}

export type TextRemoveOperationData = {
    op: 'remove';
    index: number;
    length: number;
}

export type TextOperationData = TextInsertOperationData | TextRemoveOperationData;

export class DomTextChangedDataEnc extends Frame {
    constructor(
        public nodeId: number | bigint,
        public operations: TextOperationData[]
    ) {
        super();
    }

    static decode(reader: BufferReader): DomTextChangedDataEnc | null {
        if (reader.readU32() !== FrameType.DomTextChanged) return null;
        const nodeId = reader.readU64();
        const operationCount = Number(reader.readU64());
        const operations: TextOperationData[] = [];

        for (let i = 0; i < operationCount; i++) {
            const opType = reader.readU32();
            if (opType === 0) { // Insert
                const index = reader.readU32();
                const text = reader.readString();
                operations.push({ op: 'insert', index, text });
            } else { // Remove
                const index = reader.readU32();
                const length = reader.readU32();
                operations.push({ op: 'remove', index, length });
            }
        }

        return new DomTextChangedDataEnc(nodeId, operations);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.DomTextChanged);
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

export class DomNodeResizedDataEnc extends Frame {
    constructor(
        public nodeId: number | bigint,
        public width: number,
        public height: number
    ) {
        super();
    }

    static decode(reader: BufferReader): DomNodeResizedDataEnc | null {
        if (reader.readU32() !== FrameType.DomNodeResized) return null;
        const nodeId = reader.readU64();
        const width = reader.readU32();
        const height = reader.readU32();
        return new DomNodeResizedDataEnc(nodeId, width, height);
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.DomNodeResized);
        w.u64(toU64(this.nodeId)); // u64 BE
        w.u32(this.width);         // u32 BE
        w.u32(this.height);        // u32 BE
        await w.endFrame();
    }
}

export class StyleSheetChangedDataEnc extends Frame {
    constructor() {
        super();
    }

    static decode(reader: BufferReader): StyleSheetChangedDataEnc | null {
        if (reader.readU32() !== FrameType.StyleSheetChanged) return null;
        // TODO: Add data fields when StyleSheetChangedData is defined
        return new StyleSheetChangedDataEnc();
    }

    async encode(w: Writer): Promise<void> {
        w.u32(FrameType.StyleSheetChanged);
        // TODO: Add data fields when StyleSheetChangedData is defined
        await w.endFrame();
    }
}


DECODERS[FrameType.Timestamp] = TimestampDataEnc.decode;
DECODERS[FrameType.Keyframe] = KeyframeDataEnc.decode;
DECODERS[FrameType.Asset] = AssetDataEnc.decode;
DECODERS[FrameType.ViewportResized] = ViewportResizedDataEnc.decode;
DECODERS[FrameType.ScrollOffsetChanged] = ScrollOffsetChangedDataEnc.decode;
DECODERS[FrameType.MouseMoved] = MouseMovedDataEnc.decode;
DECODERS[FrameType.MouseClicked] = MouseClickedDataEnc.decode;
DECODERS[FrameType.KeyPressed] = KeyPressedDataEnc.decode;
DECODERS[FrameType.ElementFocused] = ElementFocusedDataEnc.decode;
DECODERS[FrameType.TextSelectionChanged] = TextSelectionChangedDataEnc.decode;
DECODERS[FrameType.DomNodeAdded] = DomNodeAddedDataEnc.decode;
DECODERS[FrameType.DomNodeRemoved] = DomNodeRemovedDataEnc.decode;
DECODERS[FrameType.DomAttributeChanged] = DomAttributeChangedDataEnc.decode;
DECODERS[FrameType.DomAttributeRemoved] = DomAttributeRemovedDataEnc.decode;
DECODERS[FrameType.DomTextChanged] = DomTextChangedDataEnc.decode;
DECODERS[FrameType.DomNodeResized] = DomNodeResizedDataEnc.decode;
DECODERS[FrameType.StyleSheetChanged] = StyleSheetChangedDataEnc.decode;