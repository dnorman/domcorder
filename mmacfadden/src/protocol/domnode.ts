import { Writer } from "./writer.ts";

// DOM Node Type Constants
export enum DomNodeType {
    Element = 1,
    Text = 3,
    Document = 9
}

export class ElementNode {
    static readonly nodeType = DomNodeType.Element;
    private constructor() { }
    static encode(w: Writer, tagName: string, attributes: string[], children: Node[]): void {
        w.strUtf8(tagName.toLowerCase());

        // Encode attributes as Vec<String>
        w.u64(BigInt(attributes.length));
        for (const attr of attributes) {
            w.strUtf8(attr);
        }

        // Encode children as Vec<DomNode>
        w.u64(BigInt(children.length));
        for (const child of children) {
            DomNode.encode(w, child);
        }
    }
}

export class TextNode {
    static readonly nodeType = DomNodeType.Text;
    static readonly tag = "#text";
    private constructor() { }
    static encode(w: Writer, textContent: string): void {
        w.strUtf8(this.tag);

        // Encode text as attribute "value=content"
        w.u64(1n);
        w.strUtf8(`value=${textContent}`);

        // No children
        w.u64(0n);
    }
}

export class DocumentNode {
    static readonly nodeType = DomNodeType.Document;
    static readonly tag = "#document";
    private constructor() { }
    static encode(w: Writer, children: Node[]): void {
        w.strUtf8(this.tag);

        // No attributes
        w.u64(0n);

        // Encode children as Vec<DomNode>
        w.u64(BigInt(children.length));
        for (const child of children) {
            DomNode.encode(w, child);
        }
    }
}

export class DomNode {
    private constructor() { }

    /** Encode any DOM node using the appropriate encoder */
    static encode(w: Writer, node: Node): void {
        if (node.nodeType === DomNodeType.Element) {
            const element = node as Element;
            const attributes: string[] = [];

            for (let i = 0; i < element.attributes.length; i++) {
                const attr = element.attributes[i];
                attributes.push(`${attr.name}=${attr.value}`);
            }

            const children = Array.from(element.childNodes);
            ElementNode.encode(w, element.tagName, attributes, children);

        } else if (node.nodeType === DomNodeType.Text) {
            const textContent = node.textContent?.trim() || '';
            if (textContent) {
                TextNode.encode(w, textContent);
            }

        } else if (node.nodeType === DomNodeType.Document) {
            const children = Array.from((node as Document).childNodes);
            DocumentNode.encode(w, children);
        }
    }
}