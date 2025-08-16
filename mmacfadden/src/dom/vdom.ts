export type VTextNode = {
  id: number;
  nodeType: "text"; 
  text: string
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

export type VNode = VTextNode | VElement;

export type VStyleSheet = {id: string; media?: string; text?: string };

export interface VDocument {
  baseURI: string;
  lang?: string | null;
  dir?: string | null;
  styleSheets: VStyleSheet[];
  documentElement: VElement;
}