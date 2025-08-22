import { VNode, VElement, VTextNode, VComment, VCDATASection, VProcessingInstruction, VDocumentType, VDocument } from "./vdom.js";

/**
 * Converts a DOM Document to a VDocument instance
 */
export function convertDOMDocumentToVDocument(document: Document): VDocument {
    // Convert all document children (typically doctype + html element)
    const children: VNode[] = [];
    for (const child of Array.from(document.childNodes)) {
        const vChild = convertDOMNodeToVNode(child);
        if (vChild) {
            children.push(vChild);
        }
    }

    // TODO: Handle adoptedStyleSheets if needed
    return new VDocument(0, [], children);
}

/**
 * Converts a DOM Element to a VElement instance
 */
export function convertDOMElementToVElement(element: Element): VElement {
    // Get basic element info
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) {
        attrs[attr.name] = attr.value;
    }

    // Convert children recursively
    const children: VNode[] = [];
    for (const child of Array.from(element.childNodes)) {
        const vChild = convertDOMNodeToVNode(child);
        if (vChild) {
            children.push(vChild);
        }
    }

    return new VElement(
        0, // id - will be set by caller if needed
        element.tagName.toLowerCase(),
        element.namespaceURI || undefined,
        attrs,
        children
    );
}

/**
 * Converts any DOM Node to the appropriate VNode instance
 */
export function convertDOMNodeToVNode(node: Node): VNode | null {
    switch (node.nodeType) {
        case Node.ELEMENT_NODE:
            return convertDOMElementToVElement(node as Element);
        case Node.TEXT_NODE:
            return new VTextNode(0, node.nodeValue ?? "");
        case Node.COMMENT_NODE:
            return new VComment(0, node.nodeValue ?? "");
        case Node.CDATA_SECTION_NODE:
            return new VCDATASection(0, node.nodeValue ?? "");
        case Node.PROCESSING_INSTRUCTION_NODE: {
            const pi = node as ProcessingInstruction;
            return new VProcessingInstruction(0, pi.target, pi.data);
        }
        case Node.DOCUMENT_TYPE_NODE: {
            const dt = node as DocumentType;
            return new VDocumentType(0, dt.name, dt.publicId || undefined, dt.systemId || undefined);
        }
        // Skip document fragments, attributes, etc. for now
        default:
            return null;
    }
}