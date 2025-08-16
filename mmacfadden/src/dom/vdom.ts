export type VTextNode = {
  id: number;
  nodeType: "text"; 
  text: string
};

export type VCDATASection = {
  id: number;
  nodeType: "cdata"; 
  data: string
};

export type VComment = {
  id: number;
  nodeType: "comment"; 
  data: string
};

export type VProcessingInstruction = {
  id: number;
  nodeType: "processingInstruction"; 
  target: string;
  data: string
};

export type VDocumentType = {
  id: number;
  nodeType: "documentType"; 
  name: string;
  publicId?: string;
  systemId?: string;
};

export type VElement = {
  id: number;
  nodeType: "element";
  tag: string;
  ns?: string;
  attrs?: Record<string, string>;
  children?: VNode[];
  shadow?: VNode[];
};

export type VNode = VTextNode | VElement | VCDATASection | VComment | VProcessingInstruction | VDocumentType;

export type VStyleSheet = {id: string; media?: string; text?: string };

export interface VDocument {
  baseURI: string;
  adoptedStyleSheets: VStyleSheet[];
  children: VNode[];
}