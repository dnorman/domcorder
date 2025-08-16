// .dcrr Binary Format Types and Utilities

export const DCRR_MAGIC = new Uint8Array([0x44, 0x43, 0x52, 0x52]); // "DCRR"
export const DCRR_VERSION = 1;
export const HEADER_SIZE = 32;
export const FRAME_HEADER_SIZE = 16;

export interface DCRRHeader {
    magic: Uint8Array;
    version: number;
    createdAt: bigint;
}

export interface FrameHeader {
    timestamp: bigint;
    frameType: FrameType;
    dataSize: number;
}

export interface Frame {
    header: FrameHeader;
    data: any;
}

export enum FrameType {
    Viewport = 0,
    Keyframe = 1,
    Delta = 2,
    Input = 3,
    Metadata = 4,
}

export interface ViewportData {
    width: number;
    height: number;
}

export interface KeyframeData {
    html: string;
}

export interface DeltaData {
    mutations: Mutation[];
}

export interface Mutation {
    type: MutationType;
    target: string; // Will be element selector/xpath
    data: any;
}

export enum MutationType {
    ElementAdded = 0,
    ElementRemoved = 1,
    AttributeChanged = 2,
    TextChanged = 3,
}

export interface InputEventData {
    eventType: InputEventType;
    data: any;
}

export enum InputEventType {
    KeyPress = 0,
    KeyRelease = 1,
    MouseMove = 2,
    MouseClick = 3,
    MouseScroll = 4,
}

export interface MetadataEventData {
    key: string;
    value: string;
}

export class DCRRWriter {
    private startTime: bigint;
    private frames: Uint8Array[] = [];

    constructor() {
        this.startTime = BigInt(Date.now());
    }

    getStartTime(): bigint {
        return this.startTime;
    }

    addViewport(width: number, height: number): void {
        const frame = this.createFrame(FrameType.Viewport, { width, height } as ViewportData);
        this.frames.push(frame);
    }

    addKeyframe(html: string): void {
        const frame = this.createFrame(FrameType.Keyframe, { html } as KeyframeData);
        this.frames.push(frame);
    }

    addDelta(mutations: Mutation[]): void {
        const frame = this.createFrame(FrameType.Delta, { mutations } as DeltaData);
        this.frames.push(frame);
    }

    addInputEvent(eventType: InputEventType, data: any): void {
        const frame = this.createFrame(FrameType.Input, { eventType, data } as InputEventData);
        this.frames.push(frame);
    }

    addMetadata(key: string, value: string): void {
        const frame = this.createFrame(FrameType.Metadata, { key, value } as MetadataEventData);
        this.frames.push(frame);
    }

    serialize(): Uint8Array {
        // Calculate total size
        const totalSize = HEADER_SIZE + this.frames.reduce((sum, frame) => sum + frame.length, 0);
        const buffer = new Uint8Array(totalSize);

        // Write header
        this.writeHeader(buffer);

        // Write frames
        let offset = HEADER_SIZE;
        for (const frame of this.frames) {
            buffer.set(frame, offset);
            offset += frame.length;
        }

        return buffer;
    }

    // Get individual frame as binary (for WebSocket streaming)
    serializeFrame(type: FrameType, data: any): Uint8Array {
        return this.createFrame(type, data);
    }

    private createFrame(type: FrameType, data: any): Uint8Array {
        const frameData = this.serializeFrameData(type, data);
        const frameBuffer = new Uint8Array(FRAME_HEADER_SIZE + frameData.length);

        // Write frame header
        const view = new DataView(frameBuffer.buffer);
        const timestamp = BigInt(Date.now()) - this.startTime;

        view.setBigUint64(0, timestamp, true);
        view.setUint8(8, type);
        // Reserved 3 bytes (already zero)
        view.setUint32(12, frameData.length, true);

        // Write frame data
        frameBuffer.set(frameData, FRAME_HEADER_SIZE);

        return frameBuffer;
    }

    private writeHeader(buffer: Uint8Array): void {
        const view = new DataView(buffer.buffer);
        let offset = 0;

        // Magic bytes
        buffer.set(DCRR_MAGIC, offset);
        offset += 4;

        // Version
        view.setUint32(offset, DCRR_VERSION, true);
        offset += 4;

        // Created at
        view.setBigUint64(offset, this.startTime, true);
        offset += 8;

        // Reserved (16 bytes of zeros - already zero in new Uint8Array)
    }

    private serializeFrameData(type: FrameType, data: any): Uint8Array {
        switch (type) {
            case FrameType.Viewport:
                return this.serializeViewport(data as ViewportData);
            case FrameType.Keyframe:
                return this.serializeKeyframe(data as KeyframeData);
            case FrameType.Delta:
                return this.serializeDelta(data as DeltaData);
            case FrameType.Input:
                return this.serializeInput(data as InputEventData);
            case FrameType.Metadata:
                return this.serializeMetadata(data as MetadataEventData);
            default:
                throw new Error(`Unknown frame type: ${type}`);
        }
    }

    private serializeViewport(data: ViewportData): Uint8Array {
        const buffer = new Uint8Array(8);
        const view = new DataView(buffer.buffer);

        view.setUint32(0, data.width, true);
        view.setUint32(4, data.height, true);

        return buffer;
    }

    private serializeKeyframe(data: KeyframeData): Uint8Array {
        const htmlBytes = new TextEncoder().encode(data.html);
        return htmlBytes;
    }

    private serializeDelta(data: DeltaData): Uint8Array {
        // Simplified for now - just JSON encode mutations
        const json = JSON.stringify(data.mutations);
        const jsonBytes = new TextEncoder().encode(json);
        const buffer = new Uint8Array(4 + jsonBytes.length);
        const view = new DataView(buffer.buffer);

        view.setUint32(0, data.mutations.length, true);
        buffer.set(jsonBytes, 4);

        return buffer;
    }

    private serializeInput(data: InputEventData): Uint8Array {
        // Simplified for now - just JSON encode
        const json = JSON.stringify(data.data);
        const jsonBytes = new TextEncoder().encode(json);
        const buffer = new Uint8Array(1 + jsonBytes.length);

        buffer[0] = data.eventType;
        buffer.set(jsonBytes, 1);

        return buffer;
    }

    private serializeMetadata(data: MetadataEventData): Uint8Array {
        const keyBytes = new TextEncoder().encode(data.key);
        const valueBytes = new TextEncoder().encode(data.value);
        const buffer = new Uint8Array(6 + keyBytes.length + valueBytes.length);
        const view = new DataView(buffer.buffer);

        view.setUint16(0, keyBytes.length, true);
        buffer.set(keyBytes, 2);
        view.setUint32(2 + keyBytes.length, valueBytes.length, true);
        buffer.set(valueBytes, 6 + keyBytes.length);

        return buffer;
    }
}

export class DCRRReader {
    private buffer: Uint8Array;
    private header: DCRRHeader;
    private frames: Frame[] = [];

    constructor(buffer: Uint8Array) {
        this.buffer = buffer;
        this.header = this.readHeader();
        this.frames = this.readAllFrames();
    }

    getHeader(): DCRRHeader {
        return this.header;
    }

    getFrameCount(): number {
        return this.frames.length;
    }

    getFrames(): Frame[] {
        return this.frames;
    }

    getFrameAt(frameIndex: number): Frame {
        if (frameIndex >= this.frames.length) {
            throw new Error(`Frame index ${frameIndex} out of bounds`);
        }
        return this.frames[frameIndex];
    }

    findFrameByTimestamp(timestamp: bigint): number {
        // Binary search for frame with largest timestamp <= target
        let left = 0;
        let right = this.frames.length - 1;
        let result = 0;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (this.frames[mid].header.timestamp <= timestamp) {
                result = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        return result;
    }

    findLatestViewport(beforeTimestamp: bigint): ViewportData | null {
        for (let i = this.frames.length - 1; i >= 0; i--) {
            const frame = this.frames[i];
            if (frame.header.timestamp <= beforeTimestamp && frame.header.frameType === FrameType.Viewport) {
                return frame.data as ViewportData;
            }
        }
        return null;
    }

    findLatestKeyframe(beforeTimestamp: bigint): { index: number; frame: Frame } | null {
        for (let i = this.frames.length - 1; i >= 0; i--) {
            const frame = this.frames[i];
            if (frame.header.timestamp <= beforeTimestamp && frame.header.frameType === FrameType.Keyframe) {
                return { index: i, frame };
            }
        }
        return null;
    }

    private readHeader(): DCRRHeader {
        const view = new DataView(this.buffer.buffer);
        let offset = 0;

        const magic = this.buffer.slice(offset, offset + 4);
        offset += 4;

        // Verify magic bytes
        if (!magic.every((byte, i) => byte === DCRR_MAGIC[i])) {
            throw new Error("Invalid DCRR file: bad magic bytes");
        }

        const version = view.getUint32(offset, true);
        offset += 4;

        if (version !== DCRR_VERSION) {
            throw new Error(`Unsupported DCRR version: ${version}`);
        }

        const createdAt = view.getBigUint64(offset, true);

        return {
            magic,
            version,
            createdAt,
        };
    }

    private readAllFrames(): Frame[] {
        const frames: Frame[] = [];
        let offset = HEADER_SIZE;

        while (offset < this.buffer.length) {
            // Read frame header
            const frameHeader = this.readFrameHeader(offset);
            offset += FRAME_HEADER_SIZE;

            // Read frame data
            const frameData = this.buffer.slice(offset, offset + frameHeader.dataSize);
            offset += frameHeader.dataSize;

            // Parse frame data
            const parsedData = this.deserializeFrameData(frameHeader.frameType, frameData);

            frames.push({
                header: frameHeader,
                data: parsedData,
            });
        }

        return frames;
    }

    private readFrameHeader(offset: number): FrameHeader {
        const view = new DataView(this.buffer.buffer);

        return {
            timestamp: view.getBigUint64(offset, true),
            frameType: view.getUint8(offset + 8) as FrameType,
            dataSize: view.getUint32(offset + 12, true),
        };
    }

    private deserializeFrameData(type: FrameType, data: Uint8Array): any {
        switch (type) {
            case FrameType.Viewport:
                return this.deserializeViewport(data);
            case FrameType.Keyframe:
                return this.deserializeKeyframe(data);
            case FrameType.Delta:
                return this.deserializeDelta(data);
            case FrameType.Input:
                return this.deserializeInput(data);
            case FrameType.Metadata:
                return this.deserializeMetadata(data);
            default:
                throw new Error(`Unknown frame type: ${type}`);
        }
    }

    private deserializeViewport(data: Uint8Array): ViewportData {
        const view = new DataView(data.buffer);
        const width = view.getUint32(0, true);
        const height = view.getUint32(4, true);

        return { width, height };
    }

    private deserializeKeyframe(data: Uint8Array): KeyframeData {
        const html = new TextDecoder().decode(data);
        return { html };
    }

    private deserializeDelta(data: Uint8Array): DeltaData {
        const view = new DataView(data.buffer);
        const mutationCount = view.getUint32(0, true);
        const json = new TextDecoder().decode(data.slice(4));
        const mutations = JSON.parse(json);

        return { mutations };
    }

    private deserializeInput(data: Uint8Array): InputEventData {
        const eventType = data[0] as InputEventType;
        const json = new TextDecoder().decode(data.slice(1));
        const eventData = JSON.parse(json);

        return { eventType, data: eventData };
    }

    private deserializeMetadata(data: Uint8Array): MetadataEventData {
        const view = new DataView(data.buffer);
        const keyLength = view.getUint16(0, true);
        const key = new TextDecoder().decode(data.slice(2, 2 + keyLength));
        const valueLength = view.getUint32(2 + keyLength, true);
        const value = new TextDecoder().decode(data.slice(6 + keyLength, 6 + keyLength + valueLength));

        return { key, value };
    }
}

// Streaming reader for live files
export class DCRRStreamReader {
    private buffer: Uint8Array;
    private header: DCRRHeader | null = null;
    private offset: number = 0;

    constructor(initialBuffer?: Uint8Array) {
        this.buffer = initialBuffer || new Uint8Array(0);
    }

    // Append new data to the buffer (for streaming reads)
    appendData(newData: Uint8Array): void {
        const newBuffer = new Uint8Array(this.buffer.length + newData.length);
        newBuffer.set(this.buffer);
        newBuffer.set(newData, this.buffer.length);
        this.buffer = newBuffer;
    }

    // Try to read header if not already read
    tryReadHeader(): boolean {
        if (this.header || this.buffer.length < HEADER_SIZE) {
            return this.header !== null;
        }

        try {
            this.header = this.readHeader();
            this.offset = HEADER_SIZE;
            return true;
        } catch {
            return false;
        }
    }

    // Try to read next frame
    tryReadNextFrame(): Frame | null {
        if (!this.header || this.offset + FRAME_HEADER_SIZE > this.buffer.length) {
            return null;
        }

        // Try to read frame header
        const frameHeader = this.readFrameHeader(this.offset);
        const frameEndOffset = this.offset + FRAME_HEADER_SIZE + frameHeader.dataSize;

        // Check if we have all the frame data
        if (frameEndOffset > this.buffer.length) {
            return null;
        }

        // Read frame data
        const frameData = this.buffer.slice(
            this.offset + FRAME_HEADER_SIZE,
            frameEndOffset
        );

        // Parse frame data
        const parsedData = this.deserializeFrameData(frameHeader.frameType, frameData);

        // Advance offset
        this.offset = frameEndOffset;

        return {
            header: frameHeader,
            data: parsedData,
        };
    }

    private readHeader(): DCRRHeader {
        const view = new DataView(this.buffer.buffer);
        let offset = 0;

        const magic = this.buffer.slice(offset, offset + 4);
        offset += 4;

        // Verify magic bytes
        if (!magic.every((byte, i) => byte === DCRR_MAGIC[i])) {
            throw new Error("Invalid DCRR file: bad magic bytes");
        }

        const version = view.getUint32(offset, true);
        offset += 4;

        if (version !== DCRR_VERSION) {
            throw new Error(`Unsupported DCRR version: ${version}`);
        }

        const createdAt = view.getBigUint64(offset, true);

        return {
            magic,
            version,
            createdAt,
        };
    }

    private readFrameHeader(offset: number): FrameHeader {
        const view = new DataView(this.buffer.buffer);

        return {
            timestamp: view.getBigUint64(offset, true),
            frameType: view.getUint8(offset + 8) as FrameType,
            dataSize: view.getUint32(offset + 12, true),
        };
    }

    private deserializeFrameData(type: FrameType, data: Uint8Array): any {
        // Same implementation as DCRRReader
        const reader = new DCRRReader(new Uint8Array(0));
        return (reader as any).deserializeFrameData(type, data);
    }
} 