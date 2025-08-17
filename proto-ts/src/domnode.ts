import { Writer } from "./writer.ts";

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
}

export class TextNode {
    static readonly nodeType = DomNodeType.Text;
    private constructor() { }
    static encode(w: Writer, textNode: Text): void {
        // Write text content (enum variant index written by bincode automatically)
        w.strUtf8(textNode.textContent || '');
    }
}

export class CDataNode {
    static readonly nodeType = DomNodeType.CData;
    private constructor() { }
    static encode(w: Writer, cdataNode: CDATASection): void {
        // Write CDATA content (enum variant index written by bincode automatically)
        w.strUtf8(cdataNode.textContent || '');
    }
}

export class CommentNode {
    static readonly nodeType = DomNodeType.Comment;
    private constructor() { }
    static encode(w: Writer, commentNode: Comment): void {
        // Write comment content (enum variant index written by bincode automatically)
        w.strUtf8(commentNode.textContent || '');
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
}