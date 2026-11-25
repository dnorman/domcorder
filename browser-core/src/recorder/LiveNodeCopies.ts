/**
 * The copies the change detector makes of the page's nodes: its snapshot of the page, and the
 * subtree each insert operation hands over, which shows the subtree as it was when the change was
 * found. The page's code must not change a copy: code run for a copy makes the recording differ
 * from the page, and a copy with a child more or fewer than its live node does not take the
 * page's ids right, since they go to it by position. Each node of an operation's copy is linked to
 * the live node it copies, so that the recorder can ask the live node what the copy cannot tell,
 * such as whether a field has been a password field.
 */

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** The live node each linked copy copies. Weak, so that it keeps no copy alive. */
const liveNodesOfCopies = new WeakMap<Node, Node>();

/** The live node that `copy`, a node of an insert operation's subtree, copies, if it is one. */
export function liveNodeOf<T extends Node>(copy: T): T | undefined {
  return liveNodesOfCopies.get(copy) as T | undefined;
}

/**
 * The change detector's first snapshot of `liveDomRoot`, made as its later copies are, in a copy of
 * the live root's document without its children, where the detector also makes its later copies.
 * A detector watching an element makes its copies there too, not in the page's document, where
 * the page's custom elements are defined. The copy of a page's document defines no custom
 * elements, so no custom element's code runs for an element made there (see `copyOfNodeAlone` for
 * an element the browser copies). A document that a script made and gave a scoped registry
 * differs: the DOM's cloning rules keep a scoped registry in the document's copy, so a browser
 * that follows them would run that registry's constructors for the elements made there by hand.
 * Chromium and WebKit drop it from the copy, and no code runs.
 *
 * If a DOM call refuses to put a child's copy into the snapshot document, the snapshot is the
 * browser's copy of the whole document, for which the page's code can run, reported as
 * `reportRefusal` says, so that the refusal does not keep the recording from starting. That code
 * can still keep it from starting: nothing removes the children it gives the copy, and a copy whose
 * children differ in number or order from the page's element's does not take the page's ids right,
 * since they go to it by position.
 */
export function snapshotOf(liveDomRoot: Node): Node {
  const liveDocument = liveDomRoot.ownerDocument ?? (liveDomRoot as Document);
  const snapshotDocument = liveDocument.cloneNode(false) as Document;
  if (liveDomRoot !== liveDocument) return copyOf(liveDomRoot, snapshotDocument, { linked: false });
  try {
    for (const child of Array.from(liveDocument.childNodes)) {
      snapshotDocument.appendChild(copyOf(child, snapshotDocument, { linked: false }));
    }
    return snapshotDocument;
  } catch (refusal) {
    reportRefusal(refusal, "the document");
    return liveDocument.cloneNode(true);
  }
}

/**
 * Copies `liveNode`'s subtree into `document` node by node (`copyNodeByNode`). With `linked`, each
 * copy is linked to the live node it copies as the copy is made. If a DOM call refuses the copy
 * outside one node's own copy, such as the append of a child's copy, the subtree's copy is the
 * browser's, reported as `reportRefusal` says, so that the refusal does not stop the recording. The
 * page's code can run for that copy (see `copyOfNodeAlone`), and nothing removes the children it
 * gives the copy, so that code can still stop the recording, or keep it from starting. Only the
 * copy's root is linked: the recorder cannot ask the live nodes below it whether they have been
 * password fields, so it masks every `value` attribute there.
 */
export function copyOf(liveNode: Node, document: Document, { linked }: { linked: boolean }): Node {
  try {
    return copyNodeByNode(liveNode, document, { linked });
  } catch (refusal) {
    reportRefusal(refusal, `the subtree of ${namedInReport(liveNode)}`);
    const copy = document.importNode(liveNode, true);
    if (linked) liveNodesOfCopies.set(copy, liveNode);
    return copy;
  }
}

/**
 * Copies `liveNode`'s subtree into `document` one node at a time, each with `copyOfNodeAlone`,
 * linking each copy as `copyOf` says. The nodes of a template's content, which the recorder does
 * not record, and of a shadow root's copy are not linked, and the recorder masks their `value`.
 */
function copyNodeByNode(liveNode: Node, document: Document, { linked }: { linked: boolean }): Node {
  const copy = copyOfNodeAlone(liveNode, document);
  if (linked) liveNodesOfCopies.set(copy, liveNode);
  if (isTemplate(liveNode)) {
    // A template's content is not among its children
    (copy as HTMLTemplateElement).content.append(copyOf(liveNode.content, document, { linked: false }));
  }
  for (const child of Array.from(liveNode.childNodes)) {
    copy.appendChild(copyOf(child, document, { linked }));
  }
  return copy;
}

/**
 * A copy of `liveNode` without its children, made in `document`, the detector's snapshot document.
 *
 * Where elements carry a custom element registry, an HTML element is copied by hand
 * (`handMadeCopyOf`). The browser's copy of an element the page created with a scoped registry
 * keeps that registry, and the element's constructor and callbacks run for the copy; so do those of
 * such an element inside a clonable shadow root, open or closed, which the browser copies along
 * with its host. A closed shadow root cannot be seen from its host, so no element can be told safe
 * for the browser to copy.
 *
 * The browser copies an HTML element all the same in two cases: a `script`, whose copy the browser
 * keeps "already started", where a script made by hand would be prepared again in the snapshot
 * document and its text checked by a page that enforces Trusted Types; and an element whose copy
 * made by hand a DOM call refused, once the refusal is reported, so that the refusal does not stop
 * the recording. For the copy of such an element the page's code can run: the constructor and
 * callbacks of an element the page created with a scoped registry, and of the scoped elements in a
 * clonable shadow root it hosts, open or closed, which the browser copies with it. That code can
 * give the copy children before the browser returns it, such as a label it renders from an
 * attribute. They are removed from this copy: `copyNodeByNode` appends the copies of the live
 * children, and with them the copy would have more children than the live element, and the ids,
 * which go to the copies by position, would land on the wrong nodes. The snapshot's copy of an
 * inserted node, which the browser makes from the operation's copy, runs that code again once its
 * children are copied, and nothing undoes what the code does to it there.
 *
 * The browser copies every other node, none of which is a custom element or a shadow host, and
 * every node where elements carry no registry. A doctype is cloned and adopted, since WebKit's
 * `importNode` refuses one.
 */
function copyOfNodeAlone(liveNode: Node, document: Document): Node {
  if (liveNode.nodeType === Node.DOCUMENT_TYPE_NODE) return document.adoptNode(liveNode.cloneNode(false));
  if (isCopiedByHand(liveNode)) {
    try {
      return handMadeCopyOf(liveNode, document);
    } catch (refusal) {
      reportRefusal(refusal, namedInReport(liveNode));
    }
  }
  const copy = document.importNode(liveNode, false);
  while (copy.lastChild !== null) copy.removeChild(copy.lastChild);
  return copy;
}

/**
 * Whether `copyOfNodeAlone` copies `liveNode` by hand: an HTML element other than a script, where
 * elements carry a custom element registry.
 */
function isCopiedByHand(liveNode: Node): liveNode is Element {
  return liveNode.nodeType === Node.ELEMENT_NODE &&
    (liveNode as Element).namespaceURI === HTML_NAMESPACE &&
    (liveNode as Element).localName !== "script" &&
    "customElementRegistry" in Element.prototype;
}

/**
 * The namespace in which a copy made by hand carries an attribute that Trusted Types checks: one
 * of the copies' own, which no browser checks.
 */
const COPY_NAMESPACE = "urn:domcorder:copy";

/**
 * A new element of `document` made from `liveElement`, with copies of its attributes and of what
 * else the browser's copy carries: what was typed or set in a form field, and an open clonable
 * shadow root. A closed one is not copied; the recorder records none.
 */
function handMadeCopyOf(liveElement: Element, document: Document): Element {
  const copy = elementNamedAs(liveElement, document);
  for (const attribute of Array.from(liveElement.attributes)) {
    if (isCheckedByTrustedTypes(liveElement, attribute)) {
      // A page that enforces Trusted Types would refuse this attribute on the copy or run its own
      // policy for it, and one that only reports would send its site a report. On an HTML element
      // Trusted Types checks only attributes of no namespace, which have no prefix, so the copy
      // carries it in a namespace of its own under the same name, by which the recorder reads,
      // compares and changes it. There it is no event handler either: no code is compiled for it,
      // and none runs when the recorder adopts the copy into the page's document.
      copy.setAttributeNS(COPY_NAMESPACE, attribute.localName, attribute.value);
    } else {
      // A copy of the attribute node keeps its namespace and prefix, and a name the HTML parser
      // took that the DOM's setters refuse or read otherwise (`=x`, which `setAttribute` refuses;
      // `v-on:click`, whose colon `setAttributeNS` reads as a prefix)
      copy.setAttributeNode(document.importNode(attribute, false));
    }
  }
  copyFormFieldState(liveElement, copy);
  const shadowRoot = liveElement.shadowRoot;
  if (shadowRoot?.clonable) {
    const shadowRootCopy = copy.attachShadow({
      mode: shadowRoot.mode,
      clonable: true,
      serializable: shadowRoot.serializable,
      delegatesFocus: shadowRoot.delegatesFocus,
      slotAssignment: shadowRoot.slotAssignment,
    });
    // Its nodes are not linked, as in the copy the browser makes where elements carry no registry,
    // so that a recording is the same in either
    for (const child of Array.from(shadowRoot.childNodes)) {
      shadowRootCopy.appendChild(copyOf(child, document, { linked: false }));
    }
  }
  return copy;
}

/**
 * A new element of `document` with `liveElement`'s namespace, prefix and local name.
 * `createElement` lowercases a name in an HTML document and makes an element of no namespace in an
 * XML document that is not XHTML, so the element is made by `createElementNS`; but that would read
 * a colon in a local name as the end of a prefix, so an element without a prefix whose local name
 * holds one, as the HTML parser makes, is made by `createElement`. An element that neither makes
 * with the live element's name, such as one whose name holds a colon and a capital in an HTML
 * document, is refused.
 */
function elementNamedAs(liveElement: Element, document: Document): Element {
  const { namespaceURI, prefix, localName } = liveElement;
  const element = prefix === null && localName.includes(":")
    ? document.createElement(localName)
    : document.createElementNS(namespaceURI, prefix === null ? localName : `${prefix}:${localName}`);
  if (element.namespaceURI !== namespaceURI || element.prefix !== prefix || element.localName !== localName) {
    throw new DOMException(`No method of the DOM makes the element ${liveElement.nodeName} in this document`, "NotSupportedError");
  }
  return element;
}

/** The part of Trusted Types that the copying asks; TypeScript's DOM library does not declare it. */
interface TrustedTypesAttributeTypes {
  getAttributeType(tagName: string, attribute: string, elementNs?: string | null, attrNs?: string | null): string | null;
}

/**
 * Whether a page that enforces Trusted Types checks setting `attribute` on an element named as
 * `liveElement`: whether `trustedTypes.getAttributeType` names it, as it names an inline event
 * handler, a script's `src` and an iframe's `srcdoc`. It answers alike on every page, and no script
 * can tell a page that enforces Trusted Types from one that only reports or will begin to.
 */
function isCheckedByTrustedTypes(liveElement: Element, attribute: Attr): boolean {
  const trustedTypes = (globalThis as { trustedTypes?: TrustedTypesAttributeTypes }).trustedTypes;
  return trustedTypes !== undefined &&
    trustedTypes.getAttributeType(liveElement.localName, attribute.localName, liveElement.namespaceURI, attribute.namespaceURI) !== null;
}

/** The kinds of refusal that `reportRefusal` has reported, so that each kind is reported once. */
const reportedRefusals = new Set<string>();

/**
 * Reports that a DOM call refused the copy made by hand of `refused`, whose copy is then the
 * browser's, as the recorder reports a problem that does not stop it, once for each kind of
 * refusal: a page can refuse the same call for each of thousands of elements.
 */
function reportRefusal(refusal: unknown, refused: string): void {
  const kind = nameOfRefusal(refusal);
  if (reportedRefusals.has(kind)) return;
  reportedRefusals.add(kind);
  console.warn(
    `[LiveNodeCopies] A DOM call refused the copy made by hand of ${refused}, so the browser's copy of it ` +
    `is taken, for which the page's code can run; later refusals named ${kind} are not reported:`,
    refusal,
  );
}

/**
 * The name of `refusal`, by which `reportRefusal` tells its kind. A page's code can throw anything,
 * such as a string, or an object whose `name` getter throws; reading the name must not stop the
 * recording either, and the refusal is reported all the same.
 */
function nameOfRefusal(refusal: unknown): string {
  try {
    const name = (refusal as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name : "a refusal that is no error";
  } catch {
    return "a refusal whose name cannot be read";
  }
}

/** How `reportRefusal`'s warning names `node`. */
function namedInReport(node: Node): string {
  return node.nodeType === Node.ELEMENT_NODE
    ? `an element named "${(node as Element).localName}"`
    : `a node named "${node.nodeName}"`;
}

/**
 * Gives `copy`, a new element made from `liveElement` and its attributes, what the browser's copy
 * of a form field carries besides them: the value typed or set in an input or a text area, and an
 * input's checkedness and indeterminate state. It carries no option's selectedness.
 */
function copyFormFieldState(liveElement: Element, copy: Element): void {
  if (liveElement.localName === "input") {
    const liveField = liveElement as HTMLInputElement;
    const field = copy as HTMLInputElement;
    // Set only when it differs: a checkbox's, radio button's or button's value is its `value`
    // attribute, which setting it would add. A script cannot set a file input's.
    if (liveField.type !== "file" && field.value !== liveField.value) field.value = liveField.value;
    field.checked = liveField.checked;
    field.indeterminate = liveField.indeterminate;
  } else if (liveElement.localName === "textarea") {
    (copy as HTMLTextAreaElement).value = (liveElement as HTMLTextAreaElement).value;
  }
}

/**
 * Whether `node` is a template, told by its namespace and local name: one made in another
 * document's realm, such as a same-origin frame's, is no instance of this realm's
 * `HTMLTemplateElement`, and an element of another namespace named `template` has no content.
 */
function isTemplate(node: Node): node is HTMLTemplateElement {
  return node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).localName === "template" &&
    (node as Element).namespaceURI === HTML_NAMESPACE;
}
