import { Writer } from "./writer.ts";
import { DomNodeData } from "./protocol.ts";

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
    Document = 4,
    DocType = 5
}

export class ElementNode {
    static readonly nodeType = DomNodeType.Element;
    private constructor() { }
    static encode(w: Writer, element: Element): void {
        // Write tag name (enum variant index written by bincode automatically)
        w.strUtf8(element.tagName.toLowerCase());

        // Encode attributes as Vec<(String, String)> - name/value pairs
        w.u64(BigInt(element.attributes.length));
        for (let i = 0; i < element.attributes.length; i++) {
            const attr = element.attributes[i];
            w.strUtf8(attr.name);
            w.strUtf8(attr.value);
        }

        // Encode children as Vec<DomNode>
        const children = Array.from(element.childNodes);
        w.u64(BigInt(children.length));
        for (const child of children) {
            DomNode.encode(w, child);
        }
    }

    // Streaming version that yields during recursion
    static async encodeStreaming(w: Writer, element: Element): Promise<void> {
        // Write tag name (enum variant index written by bincode automatically)
        w.strUtf8(element.tagName.toLowerCase());

        // Encode attributes as Vec<(String, String)> - name/value pairs
        w.u64(BigInt(element.attributes.length));
        for (let i = 0; i < element.attributes.length; i++) {
            const attr = element.attributes[i];
            w.strUtf8(attr.name);
            w.strUtf8(attr.value);
        }

        // Encode children as Vec<DomNode> - this is where we yield during recursion
        const children = Array.from(element.childNodes);
        w.u64(BigInt(children.length));
        for (const child of children) {
            await DomNode.encodeStreaming(w, child);
        }
    }

    // Decode method
    static decode(r: BufferReader): DomNodeData {
        // Read tag name
        const tag = r.readString();

        // Read attributes (u64 count + pairs of strings)
        const attributeCount = Number(r.readU64());
        const attributes: Record<string, string> = {};
        for (let i = 0; i < attributeCount; i++) {
            const name = r.readString();
            const value = r.readString();
            attributes[name] = value;
        }

        // Read children (u64 count + DOM nodes)
        const childCount = Number(r.readU64());
        const children: DomNodeData[] = [];
        for (let i = 0; i < childCount; i++) {
            children.push(DomNode.decode(r));
        }

        return {
            nodeType: DomNodeType.Element,
            tag,
            attributes,
            children
        };
    }
}

export class TextNode {
    static readonly nodeType = DomNodeType.Text;
    private constructor() { }
    static encode(w: Writer, textNode: Text): void {
        // Write text content (enum variant index written by bincode automatically)
        w.strUtf8(textNode.textContent || '');
    }

    static decode(r: BufferReader): DomNodeData {
        // Read text content
        const text = r.readString();

        return {
            nodeType: DomNodeType.Text,
            text,
            children: []
        };
    }
}

export class CDataNode {
    static readonly nodeType = DomNodeType.CData;
    private constructor() { }
    static encode(w: Writer, cdataNode: CDATASection): void {
        // Write CDATA content (enum variant index written by bincode automatically)
        w.strUtf8(cdataNode.textContent || '');
    }

    static decode(r: BufferReader): DomNodeData {
        // Read CDATA content
        const text = r.readString();

        return {
            nodeType: DomNodeType.CData,
            text,
            children: []
        };
    }
}

export class CommentNode {
    static readonly nodeType = DomNodeType.Comment;
    private constructor() { }
    static encode(w: Writer, commentNode: Comment): void {
        // Write comment content (enum variant index written by bincode automatically)
        w.strUtf8(commentNode.textContent || '');
    }

    static decode(r: BufferReader): DomNodeData {
        // Read comment content
        const text = r.readString();

        return {
            nodeType: DomNodeType.Comment,
            text,
            children: []
        };
    }
}

export class DocumentNode {
    static readonly nodeType = DomNodeType.Document;
    private constructor() { }
    static encode(w: Writer, document: Document): void {
        // Encode children as Vec<DomNode>
        const children = Array.from(document.childNodes);
        w.u64(BigInt(children.length));
        for (const child of children) {
            DomNode.encode(w, child);
        }
    }

    // Streaming version that yields during recursion
    static async encodeStreaming(w: Writer, document: Document): Promise<void> {
        // Encode children as Vec<DomNode> - this is where we yield during recursion
        const children = Array.from(document.childNodes);
        w.u64(BigInt(children.length));
        for (const child of children) {
            await DomNode.encodeStreaming(w, child);
        }
    }

    static decode(r: BufferReader): DomNodeData {
        // Read children (u64 count + DOM nodes)
        const childCount = Number(r.readU64());
        const children: DomNodeData[] = [];
        for (let i = 0; i < childCount; i++) {
            children.push(DomNode.decode(r));
        }

        return {
            nodeType: DomNodeType.Document,
            children
        };
    }
}

export class DocTypeNode {
    static readonly nodeType = DomNodeType.DocType;
    private constructor() { }
    static encode(w: Writer, docType: DocumentType): void {
        // Write doctype name (enum variant index written by bincode automatically)
        w.strUtf8(docType.name);

        // Write public ID (optional)
        if (docType.publicId) {
            w.u32(1); // Some
            w.strUtf8(docType.publicId);
        } else {
            w.u32(0); // None
        }

        // Write system ID (optional)
        if (docType.systemId) {
            w.u32(1); // Some
            w.strUtf8(docType.systemId);
        } else {
            w.u32(0); // None
        }
    }

    static decode(r: BufferReader): DomNodeData {
        // Read doctype name
        const tag = r.readString();

        // Read optional public ID
        const hasPublicId = r.readU32();
        let publicId: string | undefined;
        if (hasPublicId === 1) {
            publicId = r.readString();
        }

        // Read optional system ID
        const hasSystemId = r.readU32();
        let systemId: string | undefined;
        if (hasSystemId === 1) {
            systemId = r.readString();
        }

        // Store optional IDs in attributes for compatibility
        const attributes: Record<string, string> = {};
        if (publicId) attributes.publicId = publicId;
        if (systemId) attributes.systemId = systemId;

        return {
            nodeType: DomNodeType.DocType,
            tag,
            attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
            children: []
        };
    }
}

export class DomNode {
    private constructor() { }

    /** Encode any DOM node using the appropriate encoder */
    static encode(w: Writer, node: Node): void {
        if (node.nodeType === Node.ELEMENT_NODE) {
            w.u32(DomNodeType.Element);  // Write enum variant index
            ElementNode.encode(w, node as Element);
        } else if (node.nodeType === Node.TEXT_NODE) {
            w.u32(DomNodeType.Text);  // Write enum variant index
            TextNode.encode(w, node as Text);
        } else if (node.nodeType === Node.CDATA_SECTION_NODE) {
            w.u32(DomNodeType.CData);  // Write enum variant index
            CDataNode.encode(w, node as CDATASection);
        } else if (node.nodeType === Node.DOCUMENT_NODE) {
            w.u32(DomNodeType.Document);  // Write enum variant index
            DocumentNode.encode(w, node as Document);
        } else if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
            w.u32(DomNodeType.DocType);  // Write enum variant index
            DocTypeNode.encode(w, node as DocumentType);
        }
    }

    /** Streaming version that yields during recursion */
    static async encodeStreaming(w: Writer, node: Node): Promise<void> {
        // Yield at start of each node
        await w.streamWait();

        if (node.nodeType === Node.ELEMENT_NODE) {
            w.u32(DomNodeType.Element);  // Write enum variant index
            await ElementNode.encodeStreaming(w, node as Element);
        } else if (node.nodeType === Node.TEXT_NODE) {
            w.u32(DomNodeType.Text);  // Write enum variant index
            TextNode.encode(w, node as Text); // Text nodes are simple, no async needed
        } else if (node.nodeType === Node.CDATA_SECTION_NODE) {
            w.u32(DomNodeType.CData);  // Write enum variant index
            CDataNode.encode(w, node as CDATASection); // CDATA nodes are simple
        } else if (node.nodeType === Node.COMMENT_NODE) {
            w.u32(DomNodeType.Comment);  // Write enum variant index
            CommentNode.encode(w, node as Comment); // Comment nodes are simple
        } else if (node.nodeType === Node.DOCUMENT_NODE) {
            w.u32(DomNodeType.Document);  // Write enum variant index
            await DocumentNode.encodeStreaming(w, node as Document);
        } else if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
            w.u32(DomNodeType.DocType);  // Write enum variant index
            DocTypeNode.encode(w, node as DocumentType); // DocType nodes are simple
        }
    }

    /** Decode any DOM node using the appropriate decoder */
    static decode(r: BufferReader): DomNodeData {
        // Read node type (u32)
        const nodeType = r.readU32();

        switch (nodeType) {
            case DomNodeType.Element:
                return ElementNode.decode(r);
            case DomNodeType.Text:
                return TextNode.decode(r);
            case DomNodeType.CData:
                return CDataNode.decode(r);
            case DomNodeType.Comment:
                return CommentNode.decode(r);
            case DomNodeType.Document:
                return DocumentNode.decode(r);
            case DomNodeType.DocType:
                return DocTypeNode.decode(r);
            default:
                throw new Error(`Unknown DOM node type: ${nodeType}`);
        }
    }
}