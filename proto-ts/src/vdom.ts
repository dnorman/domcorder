import { Writer } from "./writer.js";

// Forward declaration to avoid circular import
interface BufferReader {
  readU32(): number;
  readU64(): bigint;
  readString(): string;
  readBytes(length: number): Uint8Array;
  readByte(): number; // Read a single byte
  peekU32(): number; // Peek at next u32 without consuming it
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
    // Write node ID
    w.u32(this.id);
    // Write text content
    w.strUtf8(this.text);
  }

  static decode(r: BufferReader): VTextNode {
    // Read node ID
    const id = r.readU32();
    // Read text content
    const text = r.readString();
    return new VTextNode(id, text);
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
    // Write node ID
    w.u32(this.id);
    // Write CDATA content
    w.strUtf8(this.data);
  }

  static decode(r: BufferReader): VCDATASection {
    // Read node ID
    const id = r.readU32();
    // Read CDATA content
    const data = r.readString();
    return new VCDATASection(id, data);
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
    // Write node ID
    w.u32(this.id);
    // Write comment content
    w.strUtf8(this.data);
  }

  static decode(r: BufferReader): VComment {
    // Read node ID
    const id = r.readU32();
    // Read comment content
    const data = r.readString();
    return new VComment(id, data);
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
    // Write node ID
    w.u32(this.id);
    // Write target and data
    w.strUtf8(this.target);
    w.strUtf8(this.data);
  }

  static decode(r: BufferReader): VProcessingInstruction {
    // Read node ID
    const id = r.readU32();
    // Read target and data
    const target = r.readString();
    const data = r.readString();
    return new VProcessingInstruction(id, target, data);
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
    // Write node ID
    w.u32(this.id);
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

  static decode(r: BufferReader): VDocumentType {
    // Read node ID
    const id = r.readU32();
    // Read doctype name
    const name = r.readString();

    // Read optional public ID - bincode format: 1 byte for None/Some
    const hasPublicId = r.readByte();
    let publicId: string | undefined;
    if (hasPublicId === 1) {
      publicId = r.readString();
    }

    // Read optional system ID - bincode format: 1 byte for None/Some  
    const hasSystemId = r.readByte();
    let systemId: string | undefined;
    if (hasSystemId === 1) {
      systemId = r.readString();
    }

    return new VDocumentType(id, name, publicId, systemId);
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
    // Write node ID
    w.u32(this.id);
    // Write tag name
    w.strUtf8(this.tag.toLowerCase());

    // Write namespace (optional) - bincode format: 1 byte for None, 1+string for Some
    if (this.ns) {
      w.byte(1); // Some
      w.strUtf8(this.ns);
    } else {
      w.byte(0); // None
    }

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

  static decode(r: BufferReader): VElement {
    // Read node ID
    const id = r.readU32();
    // Read tag name
    const tag = r.readString();

    // Read optional namespace - bincode format: 1 byte for None/Some
    const hasNamespace = r.readByte();
    let ns: string | undefined;
    if (hasNamespace === 1) {
      ns = r.readString();
    }

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

    return new VElement(id, tag, ns, attrs, children);
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

  encode(w: Writer): void {
    w.u32(this.id);
    w.strUtf8(this.text);
    if (this.media) {
      w.byte(1); // Some flag
      w.strUtf8(this.media);
    } else {
      w.byte(0); // None flag
    }
  }

  static decode(r: BufferReader): VStyleSheet {
    const id = r.readU32();
    const text = r.readString();
    const hasMedia = r.readByte() === 1;
    const media = hasMedia ? r.readString() : undefined;
    return new VStyleSheet(id, text, media);
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
    // Write document ID
    w.u32(this.id);

    // Encode adopted stylesheets as Vec<VStyleSheet>
    w.u64(BigInt(this.adoptedStyleSheets.length));
    for (const sheet of this.adoptedStyleSheets) {
      sheet.encode(w);
    }

    // Encode children as Vec<VNode>
    w.u64(BigInt(this.children.length));
    for (const child of this.children) {
      child.encode(w);
    }
  }

  static decode(r: BufferReader): VDocument {
    // Read document ID
    const id = r.readU32();

    // Read adopted stylesheets (u64 count + VStyleSheets)
    const adoptedStyleSheetCount = Number(r.readU64());
    const adoptedStyleSheets: VStyleSheet[] = [];
    for (let i = 0; i < adoptedStyleSheetCount; i++) {
      adoptedStyleSheets.push(VStyleSheet.decode(r));
    }

    // Read children (u64 count + VNodes)
    const childCount = Number(r.readU64());
    const children: VNode[] = [];
    for (let i = 0; i < childCount; i++) {
      children.push(VNode.decode(r));
    }

    return new VDocument(id, adoptedStyleSheets, children);
  }
}