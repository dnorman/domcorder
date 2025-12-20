import { Writer } from "./writer";
import { VNode, VDocument, VStyleSheet } from "./vdom";


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
    DomNodePropertyChanged = 15,

    Asset = 16,

    // New frame types
    AdoptedStyleSheetsChanged = 17,
    NewAdoptedStyleSheet = 18,
    ElementScrolled = 19,
    ElementBlurred = 20,
    WindowFocused = 21,
    WindowBlurred = 22,

    // Additional stylesheet frame types
    StyleSheetRuleInserted = 23,
    StyleSheetRuleDeleted = 24,
    StyleSheetReplaced = 25,

    CanvasChanged = 26,
    DomNodePropertyTextChanged = 27,
    RecordingMetadata = 28,
    AssetReference = 29,
    CacheManifest = 30,
    PlaybackConfig = 31,
    Heartbeat = 32,
}

// BufferReader interface for decoding
interface BufferReader {
    readU32(): number;
    readU64(): bigint;
    readString(): string;
    readBytes(length: number): Uint8Array;
    readByte(): number; // Read a single byte
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
        if (!dec) {
            return null;
        }
        return dec(reader); // Let concrete decoder exceptions bubble up
    }
}

export class Timestamp extends Frame {
    constructor(public timestamp: number | bigint) {
        super();
    }

    static decode(reader: BufferReader): Timestamp {
        if (reader.readU32() !== FrameType.Timestamp) throw new Error(`Expected Timestamp frame type`);
        const timestamp = reader.readU64();
        return new Timestamp(timestamp);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        if ((w as any).debug) console.log(`\n=== FRAME ${FrameType.Timestamp}: Timestamp ===`);
        w.u32(FrameType.Timestamp);         // enum variant index
        w.u64(toU64(this.timestamp));       // timestamp value
        await w.endFrame();
    }
}

export class Keyframe extends Frame {
    constructor(
        public vDocument: VDocument,
        public viewportWidth: number,
        public viewportHeight: number
    ) {
        super();
    }

    static decode(reader: BufferReader): Keyframe {
        if (reader.readU32() !== FrameType.Keyframe) throw new Error(`Expected Keyframe frame type`);
        const vdocument = VDocument.decode(reader);
        const viewportWidth = reader.readU32();
        const viewportHeight = reader.readU32();
        return new Keyframe(vdocument, viewportWidth, viewportHeight);
    }

    // Regular async - yields only at frame boundary
    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.Keyframe);
        // Encode the VDocument synchronously
        this.vDocument.encode(w);
        w.u32(this.viewportWidth);
        w.u32(this.viewportHeight);
        await w.endFrame();
    }
}

export type AssetFetchError = 
    | { type: 'none' }
    | { type: 'cors' }
    | { type: 'network' }
    | { type: 'http' }
    | { type: 'unknown'; message: string };

export class Asset extends Frame {
    constructor(
        public asset_id: number,
        public url: string,
        public mime: string | undefined,
        public buf: ArrayBuffer,
        public fetch_error: AssetFetchError = { type: 'none' }
    ) {
        super();
    }

    static decode(reader: BufferReader): Asset {
        if (reader.readU32() !== FrameType.Asset) throw new Error(`Expected Asset frame type`);
        const asset_id = reader.readU32();
        const url = reader.readString();

        // Read optional mime type - bincode format: 1 byte for None/Some
        const hasFlag = reader.readByte();
        const mime = hasFlag === 1 ? reader.readString() : undefined;

        // Read buffer
        const length = Number(reader.readU64());
        const bytes = reader.readBytes(length);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

        // Read fetch_error enum - bincode encodes enums as u32 discriminant + optional data
        const errorDiscriminant = reader.readU32();
        let fetch_error: AssetFetchError;
        if (errorDiscriminant === 0) {
            fetch_error = { type: 'none' };
        } else if (errorDiscriminant === 1) {
            fetch_error = { type: 'cors' };
        } else if (errorDiscriminant === 2) {
            fetch_error = { type: 'network' };
        } else if (errorDiscriminant === 3) {
            fetch_error = { type: 'http' };
        } else if (errorDiscriminant === 4) {
            const message = reader.readString();
            fetch_error = { type: 'unknown', message };
        } else {
            throw new Error(`Unknown AssetFetchError discriminant: ${errorDiscriminant}`);
        }

        return new Asset(asset_id, url, mime, buf, fetch_error);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.Asset);
        w.u32(this.asset_id);                    // u32 BE
        w.strUtf8(this.url);               // u64 length + UTF-8 bytes (BE)

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

        // Encode fetch_error enum
        if (this.fetch_error.type === 'none') {
            w.u32(0);
        } else if (this.fetch_error.type === 'cors') {
            w.u32(1);
        } else if (this.fetch_error.type === 'network') {
            w.u32(2);
        } else if (this.fetch_error.type === 'http') {
            w.u32(3);
        } else if (this.fetch_error.type === 'unknown') {
            w.u32(4);
            w.strUtf8(this.fetch_error.message);
        }

        await w.endFrame();
    }
}

export class RecordingMetadata extends Frame {
    constructor(
        public initial_url: string,
        public heartbeat_interval_seconds: number = 0
    ) {
        super();
    }

    static decode(reader: BufferReader): RecordingMetadata {
        if (reader.readU32() !== FrameType.RecordingMetadata) throw new Error(`Expected RecordingMetadata frame type`);
        const initial_url = reader.readString();
        const heartbeat_interval_seconds = reader.readU32();
        return new RecordingMetadata(initial_url, heartbeat_interval_seconds);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.RecordingMetadata);
        w.strUtf8(this.initial_url);
        w.u32(this.heartbeat_interval_seconds);
        await w.endFrame();
    }
}

export class Heartbeat extends Frame {
    constructor() {
        super();
    }

    static decode(reader: BufferReader): Heartbeat {
        if (reader.readU32() !== FrameType.Heartbeat) {
            throw new Error(`Expected Heartbeat frame type`);
        }
        return new Heartbeat();
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.Heartbeat);
        await w.endFrame();
    }
}

export class AssetReference extends Frame {
    constructor(
        public asset_id: number,
        public url: string,
        public hash: string,
        public mime?: string
    ) {
        super();
    }

    static decode(reader: BufferReader): AssetReference {
        if (reader.readU32() !== FrameType.AssetReference) throw new Error(`Expected AssetReference frame type`);
        const asset_id = reader.readU32();
        const url = reader.readString();
        const hash = reader.readString();
        // Read optional mime type - bincode format: 1 byte for None/Some
        const hasMime = reader.readByte();
        const mime = hasMime === 1 ? reader.readString() : undefined;
        return new AssetReference(asset_id, url, hash, mime);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.AssetReference);
        w.u32(this.asset_id);
        w.strUtf8(this.url);
        w.strUtf8(this.hash);
        // Write optional mime type - bincode format: 1 byte for None/Some
        if (this.mime !== undefined) {
            w.byte(1);
            w.strUtf8(this.mime);
        } else {
            w.byte(0);
        }
        await w.endFrame();
    }
}

export class ManifestEntry {
    constructor(
        public url: string,
        public sha256_hash: string
    ) {}
}

export class CacheManifest extends Frame {
    constructor(
        public site_origin: string,
        public assets: ManifestEntry[]
    ) {
        super();
    }

    static decode(reader: BufferReader): CacheManifest {
        if (reader.readU32() !== FrameType.CacheManifest) throw new Error(`Expected CacheManifest frame type`);
        const site_origin = reader.readString();
        const asset_count = reader.readU32();
        const assets: ManifestEntry[] = [];
        for (let i = 0; i < asset_count; i++) {
            const url = reader.readString();
            const sha256_hash = reader.readString();
            assets.push(new ManifestEntry(url, sha256_hash));
        }
        return new CacheManifest(site_origin, assets);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.CacheManifest);
        w.strUtf8(this.site_origin);
        w.u32(this.assets.length);
        for (const entry of this.assets) {
            w.strUtf8(entry.url);
            w.strUtf8(entry.sha256_hash);
        }
        await w.endFrame();
    }
}

export class PlaybackConfig extends Frame {
    constructor(
        public storage_type: string,
        public config_json: string,
        public is_live: boolean,
        public latest_timestamp: number | null
    ) {
        super();
    }

    static decode(reader: BufferReader): PlaybackConfig {
        if (reader.readU32() !== FrameType.PlaybackConfig) throw new Error(`Expected PlaybackConfig frame type`);
        const storage_type = reader.readString();
        const config_json = reader.readString();
        const is_live = reader.readByte() !== 0;
        const has_timestamp = reader.readByte() !== 0;
        const latest_timestamp = has_timestamp ? Number(reader.readU64()) : null;
        return new PlaybackConfig(storage_type, config_json, is_live, latest_timestamp);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.PlaybackConfig);
        w.strUtf8(this.storage_type);
        w.strUtf8(this.config_json);
        w.byte(this.is_live ? 1 : 0);
        if (this.latest_timestamp !== null) {
            w.byte(1);
            w.u64(BigInt(this.latest_timestamp));
        } else {
            w.byte(0);
        }
        await w.endFrame();
    }
}

export class ViewportResized extends Frame {
    constructor(public width: number, public height: number) {
        super();
    }

    static decode(reader: BufferReader): ViewportResized {
        if (reader.readU32() !== FrameType.ViewportResized) throw new Error(`Expected ViewportResized frame type`);
        const width = reader.readU32();
        const height = reader.readU32();
        return new ViewportResized(width, height);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.ViewportResized);
        w.u32(this.width);  // u32 BE
        w.u32(this.height); // u32 BE
        await w.endFrame();
    }
}

export class ScrollOffsetChanged extends Frame {
    constructor(public scrollXOffset: number, public scrollYOffset: number) {
        super();
    }

    static decode(reader: BufferReader): ScrollOffsetChanged {
        if (reader.readU32() !== FrameType.ScrollOffsetChanged) throw new Error(`Expected ScrollOffsetChanged frame type`);
        const scrollXOffset = reader.readU32();
        const scrollYOffset = reader.readU32();
        return new ScrollOffsetChanged(scrollXOffset, scrollYOffset);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.ScrollOffsetChanged);
        w.u32(this.scrollXOffset);
        w.u32(this.scrollYOffset);
        await w.endFrame();
    }
}

export class MouseMoved extends Frame {
    constructor(public x: number, public y: number) {
        super();
    }

    static decode(reader: BufferReader): MouseMoved {
        if (reader.readU32() !== FrameType.MouseMoved) throw new Error(`Expected MouseMoved frame type`);
        const x = reader.readU32();
        const y = reader.readU32();
        return new MouseMoved(x, y);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.MouseMoved);
        w.u32(this.x); // u32 BE
        w.u32(this.y); // u32 BE
        await w.endFrame();
    }
}

export class MouseClicked extends Frame {
    constructor(public x: number, public y: number) {
        super();
    }

    static decode(reader: BufferReader): MouseClicked {
        if (reader.readU32() !== FrameType.MouseClicked) throw new Error(`Expected MouseClicked frame type`);
        const x = reader.readU32();
        const y = reader.readU32();
        return new MouseClicked(x, y);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.MouseClicked);
        w.u32(this.x); // u32 BE
        w.u32(this.y); // u32 BE
        await w.endFrame();
    }
}

export class KeyPressed extends Frame {
    constructor(
        public code: string,
        public altKey: boolean,
        public ctrlKey: boolean,
        public metaKey: boolean,
        public shiftKey: boolean
    ) {
        super();
    }

    static decode(reader: BufferReader): KeyPressed {
        if (reader.readU32() !== FrameType.KeyPressed) throw new Error(`Expected KeyPressed frame type`);
        const code = reader.readString();
        const altKey = reader.readByte() === 1;
        const ctrlKey = reader.readByte() === 1;
        const metaKey = reader.readByte() === 1;
        const shiftKey = reader.readByte() === 1;
        return new KeyPressed(code, altKey, ctrlKey, metaKey, shiftKey);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.KeyPressed);
        w.strUtf8(this.code); // u64 length + UTF-8 bytes (BE)
        w.byte(this.altKey ? 1 : 0);
        w.byte(this.ctrlKey ? 1 : 0);
        w.byte(this.metaKey ? 1 : 0);
        w.byte(this.shiftKey ? 1 : 0);
        await w.endFrame();
    }
}

export class ElementFocused extends Frame {
    constructor(public node_id: number) {
        super();
    }

    static decode(reader: BufferReader): ElementFocused {
        if (reader.readU32() !== FrameType.ElementFocused) throw new Error(`Expected ElementFocused frame type`);
        const node_id = reader.readU32();
        return new ElementFocused(node_id);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.ElementFocused);
        w.u32(this.node_id);
        await w.endFrame();
    }
}

export class TextSelectionChanged extends Frame {
    constructor(
        public selectionStartNodeId: number,
        public selectionStartOffset: number,
        public selectionEndNodeId: number,
        public selectionEndOffset: number
    ) {
        super();
    }

    static decode(reader: BufferReader): TextSelectionChanged {
        if (reader.readU32() !== FrameType.TextSelectionChanged) throw new Error(`Expected TextSelectionChanged frame type`);
        const selectionStartNodeId = reader.readU32();
        const selectionStartOffset = reader.readU32();
        const selectionEndNodeId = reader.readU32();
        const selectionEndOffset = reader.readU32();
        return new TextSelectionChanged(selectionStartNodeId, selectionStartOffset, selectionEndNodeId, selectionEndOffset);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.TextSelectionChanged);
        w.u32(this.selectionStartNodeId);
        w.u32(this.selectionStartOffset);
        w.u32(this.selectionEndNodeId);
        w.u32(this.selectionEndOffset);
        await w.endFrame();
    }
}

export class DomNodeAdded extends Frame {
    constructor(
        public parentNodeId: number,
        public index: number,
        public vNode: VNode
    ) {
        super();
    }

    static decode(reader: BufferReader): DomNodeAdded {
        if (reader.readU32() !== FrameType.DomNodeAdded) throw new Error(`Expected DomNodeAdded frame type`);
        const parentNodeId = reader.readU32();
        const index = reader.readU32();
        const vnode = VNode.decode(reader);
        return new DomNodeAdded(parentNodeId, index, vnode);
    }

    // Regular async - yields only at frame boundary
    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.DomNodeAdded);
        w.u32(this.parentNodeId);
        w.u32(this.index);
        this.vNode.encode(w);            // Encode the VNode synchronously
        await w.endFrame();
    }
}

export class DomNodeRemoved extends Frame {
    constructor(public nodeId: number) {
        super();
    }

    static decode(reader: BufferReader): DomNodeRemoved {
        if (reader.readU32() !== FrameType.DomNodeRemoved) throw new Error(`Expected DomNodeRemoved frame type`);
        const nodeId = reader.readU32();
        return new DomNodeRemoved(nodeId);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.DomNodeRemoved);
        w.u32(this.nodeId);
        await w.endFrame();
    }
}

export class DomAttributeChanged extends Frame {
    constructor(
        public nodeId: number,
        public attributeName: string,
        public attributeValue: string
    ) {
        super();
    }

    static decode(reader: BufferReader): DomAttributeChanged {
        if (reader.readU32() !== FrameType.DomAttributeChanged) throw new Error(`Expected DomAttributeChanged frame type`);
        const nodeId = reader.readU32();
        const attributeName = reader.readString();
        const attributeValue = reader.readString();
        return new DomAttributeChanged(nodeId, attributeName, attributeValue);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.DomAttributeChanged);
        w.u32(this.nodeId);
        w.strUtf8(this.attributeName);
        w.strUtf8(this.attributeValue);
        await w.endFrame();
    }
}

export class DomAttributeRemoved extends Frame {
    constructor(
        public nodeId: number,
        public attributeName: string
    ) {
        super();
    }

    static decode(reader: BufferReader): DomAttributeRemoved {
        if (reader.readU32() !== FrameType.DomAttributeRemoved) throw new Error(`Expected DomAttributeRemoved frame type`);
        const nodeId = reader.readU32();
        const attributeName = reader.readString();
        return new DomAttributeRemoved(nodeId, attributeName);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.DomAttributeRemoved);
        w.u32(this.nodeId);
        w.strUtf8(this.attributeName);
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

export class DomTextChanged extends Frame {
    constructor(
        public nodeId: number,
        public operations: TextOperationData[]
    ) {
        super();
    }

    static decode(reader: BufferReader): DomTextChanged {
        if (reader.readU32() !== FrameType.DomTextChanged) throw new Error(`Expected DomTextChanged frame type`);
        const nodeId = reader.readU32();
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

        return new DomTextChanged(nodeId, operations);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.DomTextChanged);
        w.u32(this.nodeId);

        // Encode the array of operations
        w.u64(BigInt(this.operations.length));

        for (const op of this.operations) {
            if (op.op === 'insert') {
                w.u32(0); // Insert variant = 0
                w.u32(op.index);
                w.strUtf8(op.text);
            } else { // 'remove'
                w.u32(1); // Remove variant = 1
                w.u32(op.index);
                w.u32(op.length);
            }
        }

        await w.endFrame();
    }
}

export class DomNodeResized extends Frame {
    constructor(
        public nodeId: number,
        public width: number,
        public height: number
    ) {
        super();
    }

    static decode(reader: BufferReader): DomNodeResized {
        if (reader.readU32() !== FrameType.DomNodeResized) throw new Error(`Expected DomNodeResized frame type`);
        const nodeId = reader.readU32();
        const width = reader.readU32();
        const height = reader.readU32();
        return new DomNodeResized(nodeId, width, height);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.DomNodeResized);
        w.u32(this.nodeId);
        w.u32(this.width);
        w.u32(this.height);
        await w.endFrame();
    }
}



export class DomNodePropertyTextChanged extends Frame {
    constructor(
        public nodeId: number,
        public propertyName: string,
        public operations: TextOperationData[]
    ) {
        super();
    }

    static decode(reader: BufferReader): DomNodePropertyTextChanged {
        if (reader.readU32() !== FrameType.DomNodePropertyTextChanged) throw new Error(`Expected DomNodePropertyTextChanged frame type`);
        const nodeId = reader.readU32();
        const propertyName = reader.readString();
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

        return new DomNodePropertyTextChanged(nodeId, propertyName, operations);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.DomNodePropertyTextChanged);
        w.u32(this.nodeId);
        w.strUtf8(this.propertyName);
        w.u64(BigInt(this.operations.length));

        for (const operation of this.operations) {
            if (operation.op === 'insert') {
                w.u32(0); // Insert type
                w.u32(operation.index);
                w.strUtf8(operation.text);
            } else { // remove
                w.u32(1); // Remove type
                w.u32(operation.index);
                w.u32(operation.length);
            }
        }

        await w.endFrame();
    }
}

// FIXME remove the JSON encoding step
export class DomNodePropertyChanged extends Frame {
    constructor(
        public nodeId: number,
        public propertyName: string,
        public propertyValue: string | boolean | number | null
    ) {
        super();
    }

    static decode(reader: BufferReader): DomNodePropertyChanged {
        if (reader.readU32() !== FrameType.DomNodePropertyChanged) throw new Error(`Expected DomNodePropertyChanged frame type`);
        const nodeId = reader.readU32();
        const propertyName = reader.readString();
        const propertyValue = JSON.parse(reader.readString());
        return new DomNodePropertyChanged(nodeId, propertyName, propertyValue);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.DomNodePropertyChanged);
        w.u32(this.nodeId);
        w.strUtf8(this.propertyName);
        w.strUtf8(JSON.stringify(this.propertyValue));
        await w.endFrame();
    }
}

export class CanvasChanged extends Frame {
    constructor(
        public nodeId: number,
        public mimeType: string,
        public data: ArrayBuffer
    ) {
        super();
    }

    static decode(reader: BufferReader): CanvasChanged {
        if (reader.readU32() !== FrameType.CanvasChanged) throw new Error(`Expected DomNodePropertyChanged frame type`);
        const nodeId = reader.readU32();
        const mimeType = reader.readString();
        // Read buffer
        const length = Number(reader.readU64());
        const bytes = reader.readBytes(length);
        const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

        return new CanvasChanged(nodeId, mimeType, data);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.CanvasChanged);
        w.u32(this.nodeId);
        w.strUtf8(this.mimeType);
        
        // Encode buffer
        const bytes = new Uint8Array(this.data);
        w.u64(BigInt(bytes.length));  // u64 length (BE)
        w.bytes(bytes);               // Raw bytes
        await w.endFrame();
    }
}

export class AdoptedStyleSheetsChanged extends Frame {
    constructor(
        public styleSheetIds: number[],
        public addedCount: number
    ) {
        super();
    }

    static decode(reader: BufferReader): AdoptedStyleSheetsChanged {
        if (reader.readU32() !== FrameType.AdoptedStyleSheetsChanged) throw new Error(`Expected AdoptedStyleSheetsChanged frame type`);
        const idsLength = Number(reader.readU64());
        const styleSheetIds: number[] = [];
        for (let i = 0; i < idsLength; i++) {
            styleSheetIds.push(reader.readU32());
        }
        const addedCount = reader.readU32();
        return new AdoptedStyleSheetsChanged(styleSheetIds, addedCount);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.AdoptedStyleSheetsChanged);
        w.u64(BigInt(this.styleSheetIds.length));
        for (const id of this.styleSheetIds) {
            w.u32(id);
        }
        w.u32(this.addedCount);
        await w.endFrame();
    }
}

export class NewAdoptedStyleSheet extends Frame {
    constructor(
        public styleSheet: VStyleSheet
    ) {
        super();
    }

    static decode(reader: BufferReader): NewAdoptedStyleSheet {
        if (reader.readU32() !== FrameType.NewAdoptedStyleSheet) throw new Error(`Expected NewAdoptedStyleSheet frame type`);
        const styleSheet = VStyleSheet.decode(reader);
        return new NewAdoptedStyleSheet(styleSheet);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.NewAdoptedStyleSheet);
        this.styleSheet.encode(w);
        await w.endFrame();
    }
}

export class ElementScrolled extends Frame {
    constructor(
        public node_id: number,
        public scrollXOffset: number,
        public scrollYOffset: number
    ) {
        super();
    }

    static decode(reader: BufferReader): ElementScrolled {
        if (reader.readU32() !== FrameType.ElementScrolled) throw new Error(`Expected ElementScrolled frame type`);
        const node_id = reader.readU32();
        const scrollXOffset = reader.readU32();
        const scrollYOffset = reader.readU32();
        return new ElementScrolled(node_id, scrollXOffset, scrollYOffset);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.ElementScrolled);
        w.u32(this.node_id);
        w.u32(this.scrollXOffset);
        w.u32(this.scrollYOffset);
        await w.endFrame();
    }
}

export class ElementBlurred extends Frame {
    constructor(public node_id: number) {
        super();
    }

    static decode(reader: BufferReader): ElementBlurred {
        if (reader.readU32() !== FrameType.ElementBlurred) throw new Error(`Expected ElementBlurred frame type`);
        const node_id = reader.readU32();
        return new ElementBlurred(node_id);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.ElementBlurred);
        w.u32(this.node_id);
        await w.endFrame();
    }
}

export class WindowFocused extends Frame {
    constructor() {
        super();
    }

    static decode(reader: BufferReader): WindowFocused {
        if (reader.readU32() !== FrameType.WindowFocused) throw new Error(`Expected WindowFocused frame type`);
        return new WindowFocused();
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.WindowFocused);
        await w.endFrame();
    }
}

export class WindowBlurred extends Frame {
    constructor() {
        super();
    }

    static decode(reader: BufferReader): WindowBlurred {
        if (reader.readU32() !== FrameType.WindowBlurred) throw new Error(`Expected WindowBlurred frame type`);
        return new WindowBlurred();
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.WindowBlurred);
        await w.endFrame();
    }
}

export class StyleSheetRuleInserted extends Frame {
    constructor(
        public styleSheetId: number,
        public ruleIndex: number,
        public content: string
    ) {
        super();
    }

    static decode(reader: BufferReader): StyleSheetRuleInserted {
        if (reader.readU32() !== FrameType.StyleSheetRuleInserted) throw new Error(`Expected StyleSheetRuleInserted frame type`);
        const styleSheetId = reader.readU32();
        const ruleIndex = reader.readU32();
        const content = reader.readString();
        return new StyleSheetRuleInserted(styleSheetId, ruleIndex, content);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.StyleSheetRuleInserted);
        w.u32(this.styleSheetId);
        w.u32(this.ruleIndex);
        w.strUtf8(this.content);
        await w.endFrame();
    }
}

export class StyleSheetRuleDeleted extends Frame {
    constructor(
        public styleSheetId: number,
        public ruleIndex: number
    ) {
        super();
    }

    static decode(reader: BufferReader): StyleSheetRuleDeleted {
        if (reader.readU32() !== FrameType.StyleSheetRuleDeleted) throw new Error(`Expected StyleSheetRuleDeleted frame type`);
        const styleSheetId = reader.readU32();
        const ruleIndex = reader.readU32();
        return new StyleSheetRuleDeleted(styleSheetId, ruleIndex);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.StyleSheetRuleDeleted);
        w.u32(this.styleSheetId);
        w.u32(this.ruleIndex);
        await w.endFrame();
    }
}

export class StyleSheetReplaced extends Frame {
    constructor(
        public styleSheetId: number,
        public content: string
    ) {
        super();
    }

    static decode(reader: BufferReader): StyleSheetReplaced {
        if (reader.readU32() !== FrameType.StyleSheetReplaced) throw new Error(`Expected StyleSheetReplaced frame type`);
        const styleSheetId = reader.readU32();
        const content = reader.readString();
        return new StyleSheetReplaced(styleSheetId, content);
    }

    async encode(w: Writer): Promise<void> {
        w.startFrame();
        w.u32(FrameType.StyleSheetReplaced);
        w.u32(this.styleSheetId);
        w.strUtf8(this.content);
        await w.endFrame();
    }
}

DECODERS[FrameType.Timestamp] = Timestamp.decode;
DECODERS[FrameType.Keyframe] = Keyframe.decode;
DECODERS[FrameType.Asset] = Asset.decode;
DECODERS[FrameType.ViewportResized] = ViewportResized.decode;
DECODERS[FrameType.ScrollOffsetChanged] = ScrollOffsetChanged.decode;
DECODERS[FrameType.MouseMoved] = MouseMoved.decode;
DECODERS[FrameType.MouseClicked] = MouseClicked.decode;
DECODERS[FrameType.KeyPressed] = KeyPressed.decode;
DECODERS[FrameType.ElementFocused] = ElementFocused.decode;
DECODERS[FrameType.TextSelectionChanged] = TextSelectionChanged.decode;
DECODERS[FrameType.DomNodeAdded] = DomNodeAdded.decode;
DECODERS[FrameType.DomNodeRemoved] = DomNodeRemoved.decode;
DECODERS[FrameType.DomAttributeChanged] = DomAttributeChanged.decode;
DECODERS[FrameType.DomAttributeRemoved] = DomAttributeRemoved.decode;
DECODERS[FrameType.DomTextChanged] = DomTextChanged.decode;
DECODERS[FrameType.DomNodeResized] = DomNodeResized.decode;
DECODERS[FrameType.DomNodePropertyChanged] = DomNodePropertyChanged.decode;
DECODERS[FrameType.AdoptedStyleSheetsChanged] = AdoptedStyleSheetsChanged.decode;
DECODERS[FrameType.NewAdoptedStyleSheet] = NewAdoptedStyleSheet.decode;
DECODERS[FrameType.ElementScrolled] = ElementScrolled.decode;
DECODERS[FrameType.ElementBlurred] = ElementBlurred.decode;
DECODERS[FrameType.WindowFocused] = WindowFocused.decode;
DECODERS[FrameType.WindowBlurred] = WindowBlurred.decode;
DECODERS[FrameType.StyleSheetRuleInserted] = StyleSheetRuleInserted.decode;
DECODERS[FrameType.StyleSheetRuleDeleted] = StyleSheetRuleDeleted.decode;
DECODERS[FrameType.StyleSheetReplaced] = StyleSheetReplaced.decode;
DECODERS[FrameType.CanvasChanged] = CanvasChanged.decode;
DECODERS[FrameType.DomNodePropertyTextChanged] = DomNodePropertyTextChanged.decode;
DECODERS[FrameType.RecordingMetadata] = RecordingMetadata.decode;
DECODERS[FrameType.AssetReference] = AssetReference.decode;
DECODERS[FrameType.CacheManifest] = CacheManifest.decode;
DECODERS[FrameType.PlaybackConfig] = PlaybackConfig.decode;
DECODERS[FrameType.Heartbeat] = Heartbeat.decode;