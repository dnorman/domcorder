export class DomInlineTransformer {

  constructor() {
  }

  public async inlineDocument(sourceDoc: Document): Promise<Document> {
    // TODO we are doing this now because the approach in this file
    // uses async await.  Therefore we need to clone the exiting
    // document, so that it is stable.
    // const sourceDocSnapshot = sourceDoc.cloneNode(true) as Document;
  
    const targetDoc = sourceDoc.cloneNode(false) as Document;
    const docElement = await this.inlineSubtree(sourceDoc.documentElement, targetDoc) as HTMLElement;
    targetDoc.appendChild(docElement);
    
    return targetDoc;
  }

  public async inlineSubtree(source: Node, targetDocument: Document = document.implementation.createHTMLDocument()): Promise<Node | null> {
    switch (source.nodeType) {
      case Node.ELEMENT_NODE: {
        return await this._processElement(source as Element, targetDocument);
      }
      
        case Node.TEXT_NODE: {
        return targetDocument.createTextNode(source.textContent!)
      }
      
      case Node.DOCUMENT_NODE: {
        const sourceDoc = source as Document;
        sourceDoc.childNodes.forEach(async (child) => {
          const transformed = await this.inlineSubtree(child, targetDocument);
          if (transformed) {
            targetDocument.body.appendChild(transformed);
          }
        });
        return targetDocument;
      }

      case Node.DOCUMENT_FRAGMENT_NODE: {
        throw new Error("Not implemented");
      }

      case Node.ATTRIBUTE_NODE: {
        throw new Error("Not implemented");
      }

      case Node.CDATA_SECTION_NODE: {
        return targetDocument.createCDATASection((source as CDATASection).data);
      }

      case Node.COMMENT_NODE: {
        return targetDocument.createCDATASection((source as Comment).data);
      }

      case Node.PROCESSING_INSTRUCTION_NODE: {
        throw new Error("Not implemented");
      }

      case Node.DOCUMENT_TYPE_NODE: {
        const docType = source as DocumentType;
        return targetDocument.implementation.createDocumentType(docType.name, docType.publicId, docType.systemId);
      }

      case Node.NOTATION_NODE: {
        throw new Error("Not implemented");
      }

      default: {
        return null;
      }
    }
  }


  private async _fetchImageToDataUrl(url: string) {
    const response = await fetch(url);
    const data = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(data);
    });
  }

  private _toCssUnicodeEscape(str: string): string {
    if (!str) {
      return str;
    }

    let result = '';
    for (let char of Array.from(str) as string[]) {
      
      const charCode = char.codePointAt(0)!;
      if (charCode > 255) {
      
        const hexString = charCode.toString(16).padStart(4, '0').toUpperCase();
        result += '\\' + hexString;
      } else {
        result += char;
      }
    }
    return result;
  }

  private async _processStyleProperty(style: CSSStyleDeclaration, property: string) {
    let text = ""
    
    // Note simply doing style[prop] will not return the
    // value of css variables.
    let valueToSet = style.getPropertyValue(property);
    
    if (valueToSet) {
      let processedValue = this._decodeCSSValue(valueToSet);    
      processedValue = this._toCssUnicodeEscape(processedValue);

      const re = /url(?:\(['"]?)(.*?)(?:['"]?\))/g;
      const matches = processedValue.matchAll(re);
      for (const [originalValue, url] of matches) {
        const dataUri = await this._fetchImageToDataUrl(url) as string;
        processedValue = processedValue.replace(originalValue, `url(${dataUri})`);
      }
      valueToSet = processedValue; 
    } else {
      return "";
    }
        
    const priority = style.getPropertyPriority(property);
    text += `    ${property}: ${valueToSet}${
      priority ? " !" + priority : ""
    };\n`;

    return text;
  }

  private async _processCssRule(rule: CSSRule) {
    let ruleText = "";
    
    if (rule instanceof CSSStyleRule) {
      ruleText += await this._processCssStyleRule(rule);
    } else if (rule instanceof CSSFontFaceRule) {
      ruleText += await this._processCssFontFaceRule(rule);
    } else if (rule instanceof CSSMediaRule) {
      ruleText += await this._processCssMediaRule(rule);
    } else {
      ruleText += rule.cssText + "\n";
    }

    return ruleText;
  }


  private async _processCssStyleRule(rule: CSSStyleRule): Promise<string> {
    let ruleText = `${rule.selectorText} {\n`;
    
    const style = rule.style;
    const processedProperties: string[] = [];
    for (let i = 0; i < style.length; i++) {
      const prop = style.item(i);
      const propValue = await this._processStyleProperty(style, prop);
      if (propValue != "") {
        processedProperties.push(prop);
      }
      
      ruleText += propValue;
    }

    // This is a workaround.  When you supply the background property normally
    // it will set properties like backgroundColor, etc.  However if the background
    // is set with a css variable, then this doesn't happen. Even though the style
    // will tell you there is something in background color, there won't be.
    // this might just be in chrome.
    if (style.getPropertyValue("background") && 
       !processedProperties.includes("background") &&
       !processedProperties.includes("background-image") &&
       !processedProperties.includes("background-color")) {
      ruleText += await this._processStyleProperty(style, "background");
    }
  
    // Check for any vendor-prefixed properties that might not be enumerated
    const vendorProps = ["-webkit-", "-moz-", "-ms-", "-o-"];
    vendorProps.forEach((prefix) => {
      const prefixedMask = prefix + "mask-image";
      
      // @ts-ignore
      // Use direct property access for vendor prefixes too
      const value = style[prefixedMask];
      if (value) {
        ruleText += `    ${prefixedMask}: ${this._decodeCSSValue(value)};\n`;
      }
    });

    ruleText += "}\n";

    return ruleText;
  }


  private async _processCssFontFaceRule(rule: CSSFontFaceRule): Promise<string> {
    let ruleText = `\n@font-face {\n`;
      
    const style = rule.style;
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      // @ts-ignore
      const rawValue = style[prop];
      let value = this._decodeCSSValue(rawValue);
      
      const re = /url(?:\(['"]?)(.*?)(?:['"]?\))/g;
      const matches = value.matchAll(re);
      for (const [originalValue, url] of matches) {
        const dataUri = await this._fetchImageToDataUrl(url) as string;
        value = value.replace(originalValue, `url(${dataUri})`);
      }   
      
      const priority = style.getPropertyPriority(prop);
      ruleText += `    ${prop}: ${value}${priority ? " !" + priority : ""};\n`;
    }

    ruleText += "}\n";

    return ruleText;
  }

  private async _processCssMediaRule(rule: CSSMediaRule): Promise<string> {
    let ruleText = `@media ${rule.media.mediaText} {\n`;
      
    for (const mediaRule of rule.cssRules) {
      ruleText += await this._processCssRule(mediaRule);
    }

    ruleText += "}\n";

    return ruleText;
  }

  private async _processStyleSheet(sheet: CSSStyleSheet, targetDoc: Document): Promise<HTMLStyleElement> {
    if (
      sheet.href &&
      new URL(sheet.href).origin !== window.location.origin
    ) {
      // For cross-origin sheets, preserve the link tag
      const link = targetDoc.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      if (sheet.media?.mediaText) {
        link.media = sheet.media.mediaText;
      }
      
      return link;
    } else {
      // For same-origin sheets, copy their rules into a style tag
      const style = targetDoc.createElement("style");
      style.setAttribute("data-original-href", sheet.href!);

      if (sheet.media?.mediaText) {
        style.media = sheet.media.mediaText;
      }

      // Get all rules as text
      let cssText = "";
      for (let rule of sheet.cssRules) {
        const ruleText = await this._processCssRule(rule);
        cssText += ruleText;
      }

      style.textContent = cssText;

      return style;
    }
  }

  private async _findAndInlineStyleSheet(source: HTMLStyleElement | HTMLLinkElement, targetDoc: Document): Promise<HTMLElement> {
    const styleSheet = Array.from(source.ownerDocument.styleSheets).find(
      sheet => sheet.ownerNode === source
    );

    if (styleSheet) {
      return await this._processStyleSheet(styleSheet, targetDoc);
    } else {

      return source.cloneNode(true) as HTMLLinkElement;
    }
  }
   
  private async _processElement(sourceEl: Element, targetDocument: Document): Promise<Element | null> {
    if (sourceEl.tagName === "SCRIPT" || sourceEl.tagName === "IFRAME") {
      return null;
    }

    if (sourceEl instanceof HTMLLinkElement) {
      if (sourceEl.rel === "stylesheet") {
        return await this._findAndInlineStyleSheet(sourceEl, targetDocument);
      } else {
        return sourceEl.cloneNode(true) as HTMLLinkElement;
      }
    }

    if (sourceEl instanceof HTMLStyleElement) {
      return await this._findAndInlineStyleSheet(sourceEl, targetDocument);
    }

    if (sourceEl instanceof HTMLCanvasElement) {
      return this._processCanvasElement(sourceEl, targetDocument);
    }

    // Create the new element
    let targetEl: HTMLElement | SVGElement;
    if (sourceEl instanceof SVGElement) {
      targetEl = this._processSvgElement(sourceEl, targetDocument);
    } else {
      targetEl = targetDocument.createElement(sourceEl.tagName);
    }

    await this._cloneAttributes(sourceEl, targetEl);

    if (sourceEl instanceof HTMLImageElement && targetEl instanceof HTMLImageElement) {
      await this._inlineImage(sourceEl, targetEl);
    }

    for (const child of sourceEl.childNodes) {
      if (child instanceof Element) {
        const inlined = await this._processElement(child, targetDocument);
        if (inlined) {
          targetEl.appendChild(inlined);
        }
      } else if (child instanceof Node) {
        if (child.textContent) {
          targetEl.appendChild(targetDocument.createTextNode(child.textContent));
        }
      }
    }

    return targetEl;
  };

  private _processCanvasElement(sourceEl: HTMLCanvasElement, targetDocument: Document): HTMLImageElement {
    const img = targetDocument.createElement("img");
    img.src = (sourceEl).toDataURL("image/png");
    // Copy over style attribute if it exists
    if (sourceEl.hasAttribute("style")) {
      img.setAttribute("style", sourceEl.getAttribute("style")!);
    }

    return img;
  }

  private _processSvgElement(sourceEl: SVGElement, targetDocument: Document) {
    const targetEl = targetDocument.createElementNS("http://www.w3.org/2000/svg", sourceEl.tagName);
    
    // For root SVG elements, ensure we capture the sizing correctly
    if (sourceEl.tagName === "svg") {
      // Preserve the viewBox if it exists
      const viewBox = sourceEl.getAttribute("viewBox");
      if (viewBox) {
        targetEl.setAttribute("viewBox", viewBox);
      }

      // Get the computed size
      const computedStyle = window.getComputedStyle(sourceEl);
      const width = computedStyle.width;
      const height = computedStyle.height;

      // Set explicit width/height if they're not percentages
      if (!width.includes("%")) targetEl.setAttribute("width", width);
      if (!height.includes("%")) targetEl.setAttribute("height", height);

      // Preserve the aspect ratio
      const preserveAspectRatio = sourceEl.getAttribute("preserveAspectRatio");
      if (preserveAspectRatio) {
        targetEl.setAttribute("preserveAspectRatio", preserveAspectRatio);
      }
    }

    return targetEl;
  }

  private async _inlineImage(sourceEl: HTMLImageElement, targetEl: HTMLImageElement) {
    // Try to inline the image
    try {
      // Only try to inline if the image is loaded
      if (sourceEl.complete && sourceEl.naturalWidth !== 0) {
        const canvas = document.createElement("canvas");
        canvas.width = sourceEl.naturalWidth;
        canvas.height = sourceEl.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(sourceEl, 0, 0);
        targetEl.src = canvas.toDataURL("image/png");
      } else {
        // Image not loaded, use absolute URL.

        // TODO we should set an onload listener for the image
        // and handle this asynchronously. We can just create
        // an async helper method for this and await it.
        targetEl.src = new URL(sourceEl.src, window.location.href).href;
      }
    } catch (e) {
      try {
        targetEl.src = new URL(sourceEl.src, window.location.href).href;
      } catch (e) {
        targetEl.src = sourceEl.src;
      }
    }

    // Copy all other attributes except src (which we just handled)
    for (const attr of sourceEl.attributes) {
      if (attr.name !== "src") {
        targetEl.setAttribute(attr.name, attr.value);
      }
    }
  }

  private async _cloneAttributes(sourceEl: Element, targetEl: Element) {
    // Copy all attributes for non-image elements
    for (const attr of sourceEl.attributes) {
      targetEl.setAttribute(attr.name, attr.value);
    }

    const styleAttr = targetEl.getAttribute("style");

    if (styleAttr) {
      const re = /url(?:\(['"]?)(.*?)(?:['"]?\))/;
      const matches = styleAttr.match(re);
      if (matches) {
        const original = matches[0];
        const url = matches[1];
        
        const dataUri = await this._fetchImageToDataUrl(url);
        const newUrl = `url(${dataUri})`;
    
        const updatedAttr =  styleAttr.replace(original, newUrl);
        targetEl.setAttribute("style", updatedAttr);
      }
    }
  }

  private async _bufferToBase64(buffer: any) {
    // use a FileReader to generate a base64 data URI:
    const base64url: string = await new Promise((r) => {
      const reader = new FileReader();
      reader.onload = () => r(reader.result as string);
      reader.readAsDataURL(new Blob([buffer]));
    });

    // remove the `data:...;base64,` part from the start
    return base64url.slice(base64url.indexOf(",") + 1);
  }

  private _decodeCSSValue(value: string) {
    // If it's a URL value, decode the entities inside the url() wrapper
    if (value && value.includes("url(")) {
      return value.replace(/url\((.*?)\)/g, (match, url) => {
        // Remove quotes if present
        url = url.trim().replace(/^['"]|['"]$/g, "");
        // Decode HTML entities
        const decoded = url
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        return `url("${decoded}")`;
      });
    }
    return value;
  };
}