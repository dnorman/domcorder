import { Writer } from "./writer.js";

// Forward declaration to avoid circular import
interface BufferReader {
  readU32(): number;
  readU64(): bigint;
  readString(): string;
}

// DOM Node Type Constants - sequential indices for bincode compatibility
export enum DomNodeType {
  Element = 0,
  Text = 1,
  CData = 2,
  Comment = 3,
  DocType = 4,
  ProcessingInstruction = 5
}

// Parent class for all virtual DOM nodes
export abstract class VNode {
  id: number;
  abstract nodeType: string;

  constructor(id: number) {
    this.id = id;
  }

  // Abstract methods that subclasses must implement
  abstract encode(w: Writer): void;
  abstract encodeStreaming(w: Writer): Promise<void>;

  // Static decode method dispatcher
  static decode(r: BufferReader): VNode {
    // Read node type (u32)
    const nodeType = r.readU32();

    switch (nodeType) {
      case DomNodeType.Element:
        return VElement.decode(r);
      case DomNodeType.Text:
        return VTextNode.decode(r);
      case DomNodeType.CData:
        return VCDATASection.decode(r);
      case DomNodeType.Comment:
        return VComment.decode(r);
      case DomNodeType.DocType:
        return VDocumentType.decode(r);
      case DomNodeType.ProcessingInstruction:
        return VProcessingInstruction.decode(r);
      default:
        throw new Error(`Unknown DOM node type: ${nodeType}`);
    }
  }
}

export class VTextNode extends VNode {
  nodeType: "text" = "text";
  text: string;

  constructor(id: number, text: string) {
    super(id);
    this.text = text;
  }

  encode(w: Writer): void {
    // Write enum variant index
    w.u32(DomNodeType.Text);
    // Write text content
    w.strUtf8(this.text);
  }

  async encodeStreaming(w: Writer): Promise<void> {
    // Yield at start of each node
    await w.streamWait();
    this.encode(w);
  }

  static decode(r: BufferReader): VTextNode {
    // Read text content
    const text = r.readString();
    // Note: id will be set by the caller since it's not stored in the binary format
    return new VTextNode(0, text);
  }
}

export class VCDATASection extends VNode {
  nodeType: "cdata" = "cdata";
  data: string;

  constructor(id: number, data: string) {
    super(id);
    this.data = data;
  }

  encode(w: Writer): void {
    // Write enum variant index
    w.u32(DomNodeType.CData);
    // Write CDATA content
    w.strUtf8(this.data);
  }

  async encodeStreaming(w: Writer): Promise<void> {
    // Yield at start of each node
    await w.streamWait();
    this.encode(w);
  }

  static decode(r: BufferReader): VCDATASection {
    // Read CDATA content
    const data = r.readString();
    return new VCDATASection(0, data);
  }
}

export class VComment extends VNode {
  nodeType: "comment" = "comment";
  data: string;

  constructor(id: number, data: string) {
    super(id);
    this.data = data;
  }

  encode(w: Writer): void {
    // Write enum variant index
    w.u32(DomNodeType.Comment);
    // Write comment content
    w.strUtf8(this.data);
  }

  async encodeStreaming(w: Writer): Promise<void> {
    // Yield at start of each node
    await w.streamWait();
    this.encode(w);
  }

  static decode(r: BufferReader): VComment {
    // Read comment content
    const data = r.readString();
    return new VComment(0, data);
  }
}

export class VProcessingInstruction extends VNode {
  nodeType: "processingInstruction" = "processingInstruction";
  target: string;
  data: string;

  constructor(id: number, target: string, data: string) {
    super(id);
    this.target = target;
    this.data = data;
  }

  encode(w: Writer): void {
    // Write enum variant index
    w.u32(DomNodeType.ProcessingInstruction);
    // Write target and data
    w.strUtf8(this.target);
    w.strUtf8(this.data);
  }

  async encodeStreaming(w: Writer): Promise<void> {
    // Yield at start of each node
    await w.streamWait();
    this.encode(w);
  }

  static decode(r: BufferReader): VProcessingInstruction {
    // Read target and data
    const target = r.readString();
    const data = r.readString();
    return new VProcessingInstruction(0, target, data);
  }
}

export class VDocumentType extends VNode {
  nodeType: "documentType" = "documentType";
  name: string;
  publicId?: string;
  systemId?: string;

  constructor(id: number, name: string, publicId?: string, systemId?: string) {
    super(id);
    this.name = name;
    this.publicId = publicId;
    this.systemId = systemId;
  }

  encode(w: Writer): void {
    // Write enum variant index
    w.u32(DomNodeType.DocType);
    // Write doctype name
    w.strUtf8(this.name);

    // Write public ID (optional) - bincode format: 1 byte for None, 1+u64+string for Some
    if (this.publicId) {
      w.byte(1); // Some
      w.strUtf8(this.publicId);
    } else {
      w.byte(0); // None
    }

    // Write system ID (optional) - bincode format: 1 byte for None, 1+u64+string for Some
    if (this.systemId) {
      w.byte(1); // Some
      w.strUtf8(this.systemId);
    } else {
      w.byte(0); // None
    }
  }

  async encodeStreaming(w: Writer): Promise<void> {
    // Yield at start of each node
    await w.streamWait();
    this.encode(w);
  }

  static decode(r: BufferReader): VDocumentType {
    // Read doctype name
    const name = r.readString();

    // Read optional public ID - bincode format: 1 byte for None/Some
    const hasPublicId = r.readU32(); // Note: readU32 for now, should be readU8 when available
    let publicId: string | undefined;
    if ((hasPublicId & 0xFF) === 1) {
      publicId = r.readString();
    }

    // Read optional system ID - bincode format: 1 byte for None/Some  
    const hasSystemId = r.readU32(); // Note: readU32 for now, should be readU8 when available
    let systemId: string | undefined;
    if ((hasSystemId & 0xFF) === 1) {
      systemId = r.readString();
    }

    return new VDocumentType(0, name, publicId, systemId);
  }
}

export class VElement extends VNode {
  nodeType: "element" = "element";
  tag: string;
  ns?: string;
  attrs: Record<string, string>;
  children: VNode[];
  shadow?: VNode[];

  constructor(id: number, tag: string, ns: string | undefined, attrs: Record<string, string>, children: VNode[], shadow?: VNode[]) {
    super(id);
    this.tag = tag;
    this.ns = ns;
    this.attrs = attrs;
    this.children = children;
    this.shadow = shadow;
  }

  encode(w: Writer): void {
    // Write enum variant index
    w.u32(DomNodeType.Element);
    // Write tag name
    w.strUtf8(this.tag.toLowerCase());

    // Encode attributes as Vec<(String, String)> - name/value pairs
    const attrs = this.attrs || {};
    const attrEntries = Object.entries(attrs);
    w.u64(BigInt(attrEntries.length));
    for (const [name, value] of attrEntries) {
      w.strUtf8(name);
      w.strUtf8(value);
    }

    // Encode children as Vec<VNode>
    const children = this.children || [];
    w.u64(BigInt(children.length));
    for (const child of children) {
      child.encode(w);
    }
  }

  async encodeStreaming(w: Writer): Promise<void> {
    // Yield at start of each node
    await w.streamWait();

    // Write enum variant index
    w.u32(DomNodeType.Element);
    // Write tag name
    w.strUtf8(this.tag.toLowerCase());

    // Encode attributes as Vec<(String, String)> - name/value pairs
    const attrs = this.attrs || {};
    const attrEntries = Object.entries(attrs);
    w.u64(BigInt(attrEntries.length));
    for (const [name, value] of attrEntries) {
      w.strUtf8(name);
      w.strUtf8(value);
    }

    // Encode children as Vec<VNode> - this is where we yield during recursion
    const children = this.children || [];
    w.u64(BigInt(children.length));
    for (const child of children) {
      await child.encodeStreaming(w);
    }
  }

  static decode(r: BufferReader): VElement {
    // Read tag name
    const tag = r.readString();

    // Read attributes (u64 count + pairs of strings)
    const attributeCount = Number(r.readU64());
    const attrs: Record<string, string> = {};
    for (let i = 0; i < attributeCount; i++) {
      const name = r.readString();
      const value = r.readString();
      attrs[name] = value;
    }

    // Read children (u64 count + VNodes)
    const childCount = Number(r.readU64());
    const children: VNode[] = [];
    for (let i = 0; i < childCount; i++) {
      children.push(VNode.decode(r));
    }

    return new VElement(0, tag, undefined, attrs, children);
  }
}

// VNode is now the parent class - no need for union type

export class VStyleSheet {
  id: number;
  media?: string;
  text: string;

  constructor(id: number, text: string, media?: string,) {
    this.id = id;
    this.media = media;
    this.text = text;
  }
}

export class VDocument extends VNode {
  nodeType: "document" = "document";
  adoptedStyleSheets: VStyleSheet[];
  children: VNode[];

  constructor(id: number, adoptedStyleSheets: VStyleSheet[] = [], children: VNode[] = []) {
    super(id);
    this.adoptedStyleSheets = adoptedStyleSheets;
    this.children = children;
  }

  encode(w: Writer): void {
    // VDocument doesn't have a node type - it represents the document itself
    // Encode children as Vec<VNode>
    w.u64(BigInt(this.children.length));
    for (const child of this.children) {
      child.encode(w);
    }
  }

  async encodeStreaming(w: Writer): Promise<void> {
    // VDocument doesn't have a node type - it represents the document itself
    // Encode children as Vec<VNode> - this is where we yield during recursion
    w.u64(BigInt(this.children.length));
    for (const child of this.children) {
      await child.encodeStreaming(w);
    }
  }

  static decode(r: BufferReader): VDocument {
    // Read children (u64 count + VNodes)
    const childCount = Number(r.readU64());
    const children: VNode[] = [];
    for (let i = 0; i < childCount; i++) {
      children.push(VNode.decode(r));
    }

    return new VDocument(0, [], children);
  }
}