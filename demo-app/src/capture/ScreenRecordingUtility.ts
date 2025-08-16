export class ScreenRecordingUtility {
  private observer: any;
  private isRecording: boolean;
  private pendingMutations: MutationRecord[];
  private frameRequested: boolean;
  private elementIdCounter: number;
  private lastKnownState: any;
  private lastCaptureTime: number;

  constructor() {
    this.observer = null;
    this.isRecording = false;
    this.pendingMutations = [];
    this.frameRequested = false;
    this.elementIdCounter = 0;
    this.lastKnownState = null;
    this.lastCaptureTime = 0;
  }

  public async captureKeyframe() {
    // Rate limit captures to max once per second
    const now = Date.now();
    if (now - this.lastCaptureTime < 1000) {
      throw new Error("Screenshot rate limit exceeded");
    }
    this.lastCaptureTime = now;

    // Create a document to build our snapshot
    const doc = document.implementation.createHTMLDocument();
    const html = doc.documentElement;
    const head = doc.head;
    const body = doc.body;

    // TODO why are we not just cloning the whole HTML element?

    // Copy all of the attributes on the HTML element.
    for (const attr of document.documentElement.attributes) {
        html.setAttribute(attr.name, attr.value);
    }

    // FIXME we need to remove the existing <LINK> tags for the 
    // stylesheets that we are inlining.
    await this._processStyleSheets(document, doc);
    await this._processElement(document.head, head);
    await this._processElement(document.body, body);

    // Store this as our last known state
    this.lastKnownState = html;    

    // Use the existing base64 encoding function
    return html.outerHTML;;
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
    // console.log(property, valueToSet);
    
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
      
      let value = this._decodeCSSValue(style[prop]);
      
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

  private async _processStyleSheet(targetDoc: Document, sheet: CSSStyleSheet): Promise<HTMLElement> {
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
      // console.log(sheet.href);

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

  private async _processStyleSheets(sourceDoc: Document, targetDoc: Document): Promise<void> {
    const sheetPromises: Promise<HTMLElement>[] = [];
    for (const sheet of sourceDoc.styleSheets) {
      const promise = this._processStyleSheet(targetDoc, sheet);
      sheetPromises.push(promise);
    }

    const linkOrStyleElements = await Promise.all(sheetPromises);
    linkOrStyleElements.forEach(element => targetDoc.head.appendChild(element));
  }

   
  private async _processElement(sourceEl: Element, targetParent: Element) {
    const targetDocument = targetParent.ownerDocument;

    // Skip script tags
    if (sourceEl.tagName === "SCRIPT" || sourceEl.tagName === "IFRAME") {
      return;
    }

    // Handle canvas elements specially
    if (sourceEl.tagName === "CANVAS") {
      try {
        const img = targetDocument.createElement("img");
        img.src = (sourceEl as HTMLCanvasElement).toDataURL("image/png");
        // Copy over style attribute if it exists
        if (sourceEl.hasAttribute("style")) {
          img.setAttribute("style", sourceEl.getAttribute("style")!);
        }
        targetParent.appendChild(img);
      } catch (e) {
        console.warn("Could not capture canvas content:", e);
      }
      return;
    }

    // Create the new element
    let targetEl: any;
    if (sourceEl instanceof SVGElement) {
      targetEl = targetDocument.createElementNS("http://www.w3.org/2000/svg", sourceEl.tagName);

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
    } else {
      targetEl = targetDocument.createElement(sourceEl.tagName);
    }

    // Special handling for images
    if (sourceEl instanceof HTMLImageElement) {
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
    } else {
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

    // Process children
    for (const child of sourceEl.childNodes) {
      if (child instanceof Element) {
        await this._processElement(child, targetEl);
      } else if (child instanceof Node) {
        if (child.textContent) {
          targetEl.appendChild(targetDocument.createTextNode(child.textContent));
        }
      }
    }

    targetParent.appendChild(targetEl);
  };

  processMutations(mutations: MutationRecord[]) {
    // Convert mutations into a serializable format that can be replayed
    const changes: any[] = [];

    for (const mutation of mutations) {
      // switch (mutation.type) {
      //   case "childList": {
      //     // Handle added nodes
      //     for (const node of mutation.addedNodes as any) {
      //       if (node.nodeType === Node.ELEMENT_NODE && mutation.target instanceof Element) {
      //         const parentId = mutation.target.getAttribute("data-cyrus-id");
      //         const id = this.generateElementId();
      //         node.setAttribute("data-cyrus-id", id);

      //         // Recursively add IDs to children
      //         const addIds = (element) => {
      //           for (const child of element.children) {
      //             const childId = this.generateElementId();
      //             child.setAttribute("data-cyrus-id", childId);
      //             addIds(child);
      //           }
      //         };
      //         addIds(node);

      //         // Serialize the added subtree
      //         const serializer = new XMLSerializer();
      //         const nodeHtml = serializer.serializeToString(node);

      //         changes.push({
      //           type: "add",
      //           parentId,
      //           id,
      //           html: nodeHtml,
      //           nextSiblingId:
      //             (mutation.nextSibling as Element)?.getAttribute("data-cyrus-id") || null,
      //         });
      //       }
      //     }

      //     // Handle removed nodes
      //     for (const node of mutation.removedNodes as any) {
      //       if (node.nodeType === Node.ELEMENT_NODE) {
      //         const id = node.getAttribute("data-cyrus-id");
      //         if (id) {
      //           changes.push({
      //             type: "remove",
      //             id,
      //           });
      //         }
      //       }
      //     }
      //     break;
      //   }

      //   case "attributes": {
      //     const id = (mutation.target as Element).getAttribute("data-cyrus-id");
      //     if (id) {
      //       changes.push({
      //         type: "attribute",
      //         id,
      //         name: mutation.attributeName,
      //         value: (mutation.target as Element).getAttribute(mutation.attributeName!),
      //       });
      //     }
      //     break;
      //   }

      //   case "characterData": {
      //     const id =
      //       mutation.target.parentElement?.getAttribute("data-cyrus-id");
      //     if (id) {
      //       changes.push({
      //         type: "text",
      //         id,
      //         value: mutation.target.textContent,
      //       });
      //     }
      //     break;
      //   }
      // }
    }

    return changes;
  }

  async startRecording(client: any) {
    if (this.isRecording) return;

    this.isRecording = true;
    this.elementIdCounter = 0; // Reset counter for new recording

    // Send initial keyframe
    const keyframe = await this.captureKeyframe();
    client.send({
      Telemetry: {
        ScreenRecordingKeyFrame: {
          frame: keyframe,
        },
      },
    });

    // Set up mutation observer for future deltas
    this.observer = new MutationObserver((mutations) => {
      this.pendingMutations.push(...mutations);

      if (!this.frameRequested) {
        this.frameRequested = true;
        requestAnimationFrame(() => {
          this.frameRequested = false;

          if (this.pendingMutations.length > 0) {
            const changes = this.processMutations(this.pendingMutations);

            if (changes.length > 0) {
              client.send({
                Telemetry: {
                  ScreenRecordingDelta: {
                    delta: changes,
                  },
                },
              });
            }

            this.pendingMutations = [];
          }
        });
      }
    });

    // Start observing
    this.observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  stopRecording() {
    if (!this.isRecording) {
      return;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.isRecording = false;
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