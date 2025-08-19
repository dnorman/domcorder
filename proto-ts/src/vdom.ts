export class VTextNode {
  id: number;
  nodeType: "text";
  text: string;

  constructor(id: number, text: string) {
    this.id = id;
    this.nodeType = "text";
    this.text = text;
  }
}

export class VCDATASection {
  id: number;
  nodeType: "cdata";
  data: string;

  constructor(id: number, data: string) {
    this.id = id;
    this.nodeType = "cdata";
    this.data = data;
  }
}

export class VComment {
  id: number;
  nodeType: "comment";
  data: string;

  constructor(id: number, data: string) {
    this.id = id;
    this.nodeType = "comment";
    this.data = data;
  }
}

export class VProcessingInstruction {
  id: number;
  nodeType: "processingInstruction";
  target: string;
  data: string;

  constructor(id: number, target: string, data: string) {
    this.id = id;
    this.nodeType = "processingInstruction";
    this.target = target;
    this.data = data;
  }
}

export class VDocumentType {
  id: number;
  nodeType: "documentType";
  name: string;
  publicId?: string;
  systemId?: string;

  constructor(id: number, name: string, publicId?: string, systemId?: string) {
    this.id = id;
    this.nodeType = "documentType";
    this.name = name;
    this.publicId = publicId;
    this.systemId = systemId;
  }
}

export class VElement {
  id: number;
  nodeType: "element";
  tag: string;
  ns?: string;
  attrs?: Record<string, string>;
  children?: VNode[];
  shadow?: VNode[];

  constructor(id: number, tag: string, ns?: string, attrs?: Record<string, string>, children?: VNode[], shadow?: VNode[]) {
    this.id = id;
    this.nodeType = "element";
    this.tag = tag;
    this.ns = ns;
    this.attrs = attrs;
    this.children = children;
    this.shadow = shadow;
  }
}

export type VNode = VTextNode | VElement | VCDATASection | VComment | VProcessingInstruction | VDocumentType;

export class VStyleSheet {
  id: string;
  media?: string;
  text?: string;

  constructor(id: string, media?: string, text?: string) {
    this.id = id;
    this.media = media;
    this.text = text;
  }
}

export class VDocument {
  id: number;
  adoptedStyleSheets: VStyleSheet[];
  children: VNode[];

  constructor(id: number, adoptedStyleSheets: VStyleSheet[] = [], children: VNode[] = []) {
    this.id = id;
    this.adoptedStyleSheets = adoptedStyleSheets;
    this.children = children;
  }
}