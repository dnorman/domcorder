import { DomInlineTransformer } from "../../dist/index.js";

const transformer = new DomInlineTransformer();

async function screenshot() {
  const inlined = await transformer.inlineDocument(document);

  var ifrm = document.getElementById('screenshot');
  const subDoc = ifrm.contentWindow.document;
  subDoc.documentElement.innerHTML = inlined.documentElement.innerHTML;
  const links = [];
  for (const child of subDoc.head.children) {
    if (child.tagName === "LINK") {
      links.push(child);
    }
  }

  links.forEach(l => subDoc.head.removeChild(l));
}

screenshot();