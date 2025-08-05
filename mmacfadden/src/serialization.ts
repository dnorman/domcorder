
export type SerializedDomNode =
  | { type: 'text'; text: string }
  | { type: 'element'; tag: string; attributes: Record<string, string>; children: SerializedDomNode[] }
  | { type: 'document'; attributes: Record<string, string>; children: SerializedDomNode[] }
  | { type: 'documentType'; name: string; publicId: string; systemId: string }
  | { type: 'documentFragment'; children: SerializedDomNode[] }
  | { type: 'processingInstruction'; target: string; data: string }
  | { type: 'comment'; text: string }
  | { type: 'cdata'; text: string };

// Convert a DOM Node to a SerializedNode
export function serializeDomNode(node: Node): SerializedDomNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: 'text', text: node.textContent || '' };
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const attributes: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
      attributes[el.attributes[i].name] = el.attributes[i].value;
    }
    const children = Array.from(el.childNodes).map(serializeDomNode);
    return { type: 'element', tag: el.tagName.toLowerCase(), attributes, children };
  } else {
    // Ignore comments and others
    return { type: 'text', text: '' };
  }
}

export function deserializeDomNode(doc: Document, node: SerializedDomNode): Node {
  if (node.type === 'text') {
    return doc.createTextNode(node.text);
  } else if (node.type === 'element') {
    const el = doc.createElement(node.tag);
    for (const [k, v] of Object.entries(node.attributes)) {
      el.setAttribute(k, v);
    }
    for (const child of node.children) {
      el.appendChild(deserializeDomNode(doc, child));
    }
    return el;
  } else {
    throw new Error(`Unimplemented node type: ${node.type}`);
  }
}