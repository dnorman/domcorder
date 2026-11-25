import 'global-jsdom/register';
import { DomChangeDetector } from '../../src/recorder/DomChangeDetector';
import { liveNodeOf } from '../../src/recorder/LiveNodeCopies';
import { NodeIdBiMap } from '../../src/common/NodeIdBiMap';
import { waitForMutations } from './DomSyncTestUtils';

/**
 * Tests of the copies the change detector makes of the page's nodes: the subtrees its insert
 * operations hand over, and its snapshot of the page. jsdom has no scoped custom element registries
 * and runs no custom element code for a copy made outside the page's document, so where a test
 * needs the copying a browser with scoped registries takes, it makes every element say it belongs
 * to a registry (`withElementRegistries`), and it tells which copies the browser made by the
 * elements `importNode` was given (`elementsGivenToImportNode`). Nodes are compared by identity:
 * a failed deep comparison of jsdom's nodes prints their whole window.
 */

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

describe('the change detector\'s copies of live nodes', () => {
  let container: HTMLElement;
  let liveNodeMap: NodeIdBiMap;
  let operations: any[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    liveNodeMap = new NodeIdBiMap();
    operations = [];
  });

  afterEach(() => {
    container.remove();
  });

  function createDetector(root: Node): DomChangeDetector {
    return new DomChangeDetector(root, liveNodeMap, ops => operations.push(...ops), 1000, true);
  }

  function insertedCopies(): Node[] {
    return operations.filter(op => op.op === 'insert').map(op => op.node);
  }

  /** Runs `body` with every element saying it belongs to a custom element registry. */
  async function withElementRegistries(body: () => Promise<void> | void): Promise<void> {
    const registry = {};
    Object.defineProperty(Element.prototype, 'customElementRegistry', { configurable: true, get: () => registry });
    try {
      await body();
    } finally {
      delete (Element.prototype as any).customElementRegistry;
    }
  }

  /** Replaces `object[name]` with `replacement(original)` while `body` runs. */
  async function replacing<T extends object, K extends keyof T>(
    object: T, name: K, replacement: (original: T[K]) => T[K], body: () => Promise<void> | void,
  ): Promise<void> {
    const original = object[name];
    object[name] = replacement(original);
    try {
      await body();
    } finally {
      object[name] = original;
    }
  }

  /** Runs `body` with a record of the elements any document's `importNode` is given meanwhile. */
  async function elementsGivenToImportNode(body: (given: Element[]) => Promise<void> | void): Promise<void> {
    const given: Element[] = [];
    await replacing(Document.prototype, 'importNode', original => function (this: Document, node: Node, deep?: any) {
      if (node.nodeType === Node.ELEMENT_NODE) given.push(node as Element);
      return original.call(this, node, deep);
    } as any, () => body(given));
  }

  /**
   * Runs `body` with a `trustedTypes` whose `getAttributeType` names `onclick` and an iframe's
   * `srcdoc` alone, and records what it is asked.
   */
  async function withTrustedTypesNamingOnclickAndSrcdoc(body: (asked: unknown[][]) => Promise<void> | void): Promise<void> {
    const asked: unknown[][] = [];
    const typeOf = ([element, attribute]: unknown[]) =>
      attribute === 'onclick' ? 'TrustedScript' : element === 'iframe' && attribute === 'srcdoc' ? 'TrustedHTML' : null;
    (globalThis as any).trustedTypes = {
      getAttributeType: (...names: unknown[]) => { asked.push(names); return typeOf(names); },
    };
    try {
      await body(asked);
    } finally {
      delete (globalThis as any).trustedTypes;
    }
  }

  /** Runs `body` with the detector watching the whole document, as the recorder's does, stopping it after. */
  async function watchingTheDocument(body: (detector: DomChangeDetector) => Promise<void> | void): Promise<void> {
    document.body.replaceChildren(container);
    liveNodeMap.assignNodeIdsToSubTree(document);
    const detector = createDetector(document);
    try {
      await body(detector);
    } finally {
      // Or it would see the other tests' changes
      detector.disconnect();
    }
  }

  describe('the first snapshot', () => {
    test('copies the page\'s doctype, which WebKit\'s importNode refuses', async () => {
      expect(document.doctype).not.toBeNull();
      await replacing(Document.prototype, 'importNode', original => function (this: Document, node: Node, deep?: any) {
        if (node.nodeType === Node.DOCUMENT_TYPE_NODE) throw new DOMException('The operation is not supported.', 'NotSupportedError');
        return original.call(this, node, deep);
      } as any, () => watchingTheDocument(detector => {
        const snapshot = detector.getActualSnapshotRoot() as Document;
        expect([snapshot.doctype?.name, snapshot.doctype?.ownerDocument === snapshot]).toEqual([document.doctype!.name, true]);
      }));
    });

    test('copies by hand an HTML element of an XML document, a template with its content, and as the browser does an element of no namespace named template, which has no content', () => {
      const xml = document.implementation.createDocument(null, 'root', null);
      const template = xml.createElementNS(HTML_NAMESPACE, 'template') as HTMLTemplateElement;
      template.content.append(xml.createElementNS(HTML_NAMESPACE, 'b'));
      template.content.firstChild!.textContent = 'inside';
      const namedTemplate = xml.createElementNS(null, 'template');
      namedTemplate.textContent = 'a child';
      xml.documentElement.append(template, namedTemplate);
      liveNodeMap.assignNodeIdsToSubTree(xml);
      return withElementRegistries(() => elementsGivenToImportNode(given => {
        const detector = createDetector(xml);
        try {
          const [copy, namedCopy] = Array.from((detector.getActualSnapshotRoot() as Document).documentElement.children);
          expect([copy.namespaceURI, copy.localName, (copy as HTMLTemplateElement).content.textContent]).toEqual([HTML_NAMESPACE, 'template', 'inside']);
          expect([namedCopy.namespaceURI, namedCopy.localName, namedCopy.textContent]).toEqual([null, 'template', 'a child']);
          // The browser copies the elements of no namespace, which are no custom elements, each alone
          expect(given.map(element => element.localName)).toEqual(['root', 'template']);
        } finally {
          detector.disconnect();
        }
      }));
    });

    test('is the browser\'s copy of the whole document when a DOM call refuses to put a child\'s copy into the snapshot document', async () => {
      const warnings: unknown[][] = [];
      await replacing(console, 'warn', () => (...args: unknown[]) => { warnings.push(args); }, () =>
        replacing(Node.prototype, 'appendChild', original => function <T extends Node>(this: Node, child: T): T {
          if (this.nodeType === Node.DOCUMENT_NODE && this !== document) throw new DOMException('Refused for this test', 'TestDocumentRefusalError');
          return original.call(this, child) as T;
        }, () => withElementRegistries(() => watchingTheDocument(async detector => {
          const snapshot = detector.getActualSnapshotRoot() as Document;
          expect([snapshot === document, snapshot.documentElement.outerHTML]).toEqual([false, document.documentElement.outerHTML]);
          container.innerHTML = '<p>added</p>';
          await waitForMutations(100);

          expect(insertedCopies().map(copy => (copy as Element).outerHTML)).toEqual(['<p>added</p>']);
          expect(warnings.map(([message, refusal]) => [String(message).includes('the document,'), (refusal as DOMException).name]))
            .toEqual([[true, 'TestDocumentRefusalError']]);
        }))));
    });
  });

  describe('an added subtree', () => {
    test('copies an added template with its content, which is not among its children', async () => {
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);
      const detector = createDetector(root);

      root.innerHTML = '<template><b>inside</b></template>';
      await waitForMutations(100);

      const insertOps = operations.filter(op => op.op === 'insert');
      expect(insertOps.length).toBe(1);
      expect((insertOps[0].node as HTMLTemplateElement).content.textContent).toBe('inside');

      detector.disconnect();
    });

    test('copies the content of an added template made in a frame, which is no instance of the page\'s HTMLTemplateElement', async () => {
      const frame = document.createElement('iframe');
      container.appendChild(frame);
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);
      const detector = createDetector(root);
      try {
        const template = frame.contentDocument!.createElement('template');
        template.innerHTML = '<b>from the frame</b>';
        root.appendChild(template);
        await waitForMutations(100);

        expect(template instanceof HTMLTemplateElement).toBe(false);
        const insertOps = operations.filter(op => op.op === 'insert');
        expect(insertOps.length).toBe(1);
        expect((insertOps[0].node as HTMLTemplateElement).content.textContent).toBe('from the frame');
      } finally {
        detector.disconnect();
      }
    });

    test('copies an added subtree as it is in the page, each copy linked to and numbered as its own live node, with a custom element in it that reorders the children of a copy its code runs for', async () => {
      // A browser runs a custom element's attribute callback for a copy of the element made in the
      // page's document before the copy is returned; this one moves the copy's first child to its end
      if (!customElements.get('reordering-children')) {
        customElements.define('reordering-children', class extends HTMLElement {
          static observedAttributes = ['data-order'];
          attributeChangedCallback() { if (this.firstChild) this.append(this.firstChild); }
        });
      }
      await watchingTheDocument(async () => {
        container.innerHTML =
          '<reordering-children data-order="first-to-last"><i id="a"></i><i id="b"></i><i id="c"></i></reordering-children>';
        await waitForMutations(100);

        const insertOps = operations.filter(op => op.op === 'insert');
        expect(insertOps.length).toBe(1);
        const live = Array.from(container.firstElementChild!.children);
        const copies = Array.from((insertOps[0].node as Element).children);
        expect(copies.map(copy => copy.id)).toEqual(live.map(node => node.id));
        expect(copies.map((copy, i) => liveNodeOf(copy) === live[i])).toEqual([true, true, true]);
        expect(copies.map(copy => NodeIdBiMap.getNodeId(copy))).toEqual(live.map(node => NodeIdBiMap.getNodeId(node)));
      });
    });

    test('copies an added subtree as it is in the page, each copy numbered as its own live node, though a custom element adds a child to each copy of itself', async () => {
      // A copy that ran this callback would have a child more than the live element, so the ids,
      // which go from the live subtree to the copies by position, could not all be copied: the
      // copying would throw, and neither the subtree nor any later change would be recorded
      if (!customElements.get('stamping-children')) {
        customElements.define('stamping-children', class extends HTMLElement {
          static observedAttributes = ['data-stamp'];
          attributeChangedCallback() { this.append(document.createElement('b')); }
        });
      }
      await watchingTheDocument(async () => {
        container.innerHTML = '<stamping-children data-stamp="on"><i id="a"></i><i id="b"></i></stamping-children>';
        await waitForMutations(100);

        const insertOps = operations.filter(op => op.op === 'insert');
        expect(insertOps.length).toBe(1);
        const live = Array.from(container.firstElementChild!.children);
        const copies = Array.from((insertOps[0].node as Element).children);
        expect(copies.map(copy => copy.outerHTML)).toEqual(['<i id="a"></i>', '<i id="b"></i>', '<b></b>']);
        expect(copies.map(copy => NodeIdBiMap.getNodeId(copy))).toEqual(live.map(node => NodeIdBiMap.getNodeId(node)));
      });
    });

    test('makes the copies of a detector watching an element in a document of its own, where the page\'s custom elements are not defined', async () => {
      const constructed: string[] = [];
      if (!customElements.get('counting-constructions')) {
        customElements.define('counting-constructions', class extends HTMLElement {
          constructor() { super(); constructed.push(this.ownerDocument === document ? 'in the page\'s document' : 'elsewhere'); }
        });
      }
      const root = document.createElement('div');
      root.innerHTML = '<counting-constructions></counting-constructions>';
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);
      const added = document.createElement('counting-constructions');
      constructed.length = 0;

      const detector = createDetector(root);
      try {
        root.append(added);
        await waitForMutations(100);

        expect(constructed).toEqual([]);
        expect(insertedCopies().map(copy => copy.ownerDocument === document)).toEqual([false]);
      } finally {
        detector.disconnect();
      }
    });

    test('makes the snapshot\'s copy of an added subtree from the operation\'s copy, not from the live subtree again', async () => {
      const clones: { source: Node, deep: boolean | undefined, copy: Node }[] = [];
      const root = document.createElement('div');
      container.appendChild(root);
      liveNodeMap.assignNodeIdsToSubTree(root);
      await withElementRegistries(() => elementsGivenToImportNode(given =>
        replacing(Node.prototype, 'cloneNode', original => function (this: Node, deep?: boolean) {
          const copy = original.call(this, deep);
          clones.push({ source: this, deep, copy });
          return copy;
        }, async () => {
          const detector = createDetector(root);
          try {
            const added = document.createElement('section');
            added.innerHTML = '<b>bold</b> text';
            root.append(added);
            await waitForMutations(100);

            const [operationCopy] = insertedCopies();
            const snapshotCopy = detector.getSnapshotNodeMap().getNodeById(liveNodeMap.getNodeId(added));
            expect(clones.filter(clone => clone.source === operationCopy && clone.deep).map(clone => clone.copy === snapshotCopy)).toEqual([true]);
            expect(given.map(element => element.nodeName)).toEqual([]);
          } finally {
            detector.disconnect();
          }
        })));
    });

    test('where elements carry a custom element registry, copies each element of an added subtree by hand, with its attributes in their namespaces and what was typed or set in its fields', () =>
      // As in a browser with scoped registries, whose own copy of an element keeps a scoped
      // registry and runs the element's code for it. jsdom runs no such code, so this holds that
      // the browser is given no element to copy, and what the element made by hand carries.
      withElementRegistries(() => elementsGivenToImportNode(given => watchingTheDocument(async () => {
        const added = document.createElement('div');
        added.setAttributeNS('urn:example', 'ex:note', 'n');
        // Names the HTML parser takes that the DOM's setters refuse or read otherwise: `=x`, which
        // `setAttribute` refuses, and `v-on:click`, whose colon `setAttributeNS` reads as a prefix;
        // and an element's colon, which `createElementNS` reads as a prefix
        added.innerHTML = '<p =x="1" v-on:click="go"><my:el></my:el></p><input value="attr"><input type="checkbox"><textarea>orig</textarea>';
        const [text, checkbox] = Array.from(added.querySelectorAll('input'));
        text.value = 'typed';
        checkbox.checked = true;
        checkbox.indeterminate = true;
        added.querySelector('textarea')!.value = 'edited';
        container.append(added);
        await waitForMutations(100);

        expect(given.map(element => element.nodeName)).toEqual([]);
        const [copy] = insertedCopies() as HTMLDivElement[];
        const note = copy.attributes[0];
        expect([note.namespaceURI, note.prefix, note.localName, note.value]).toEqual(['urn:example', 'ex', 'note', 'n']);
        const p = copy.querySelector('p')!;
        expect(Array.from(p.attributes).map(a => [a.prefix, a.localName, a.value])).toEqual([[null, '=x', '1'], [null, 'v-on:click', 'go']]);
        expect(p.firstElementChild!.localName).toBe('my:el');
        const [textCopy, checkboxCopy] = Array.from(copy.querySelectorAll('input'));
        expect([textCopy.value, textCopy.getAttribute('value')]).toEqual(['typed', 'attr']);
        expect([checkboxCopy.checked, checkboxCopy.indeterminate, checkboxCopy.hasAttribute('value')]).toEqual([true, true, false]);
        expect(copy.querySelector('textarea')!.value).toBe('edited');
        const live = [added, ...Array.from(added.querySelectorAll('*'))];
        const copies = [copy, ...Array.from(copy.querySelectorAll('*'))];
        expect(copies.map((copy, i) => liveNodeOf(copy) === live[i])).toEqual(live.map(() => true));
      }))));

    test('copies by hand an element with its own namespace, prefix and local name: capitals in the local name, and a prefix', () =>
      withElementRegistries(() => elementsGivenToImportNode(given => watchingTheDocument(async () => {
        const added = document.createElement('div');
        // An element of no kind HTML knows that shows its text, not a script, and an HTML `pre`
        // with a prefix: only `createElementNS` makes either
        const unknown = document.createElementNS(HTML_NAMESPACE, 'SCRIPT');
        unknown.textContent = 'shown';
        added.append(unknown, document.createElementNS(HTML_NAMESPACE, 'h:pre'));
        container.append(added);
        await waitForMutations(100);

        expect(given.map(element => element.nodeName)).toEqual([]);
        const copies = Array.from((insertedCopies()[0] as Element).children);
        expect(copies.map(copy => [copy.namespaceURI, copy.prefix, copy.localName, copy.textContent]))
          .toEqual([[HTML_NAMESPACE, null, 'SCRIPT', 'shown'], [HTML_NAMESPACE, 'h', 'pre', '']]);
      }))));

    test('copies as the browser does an element that no method of the DOM makes in the snapshot document', () =>
      withElementRegistries(() => elementsGivenToImportNode(given => watchingTheDocument(async () => {
        // An XHTML document's `createElement` keeps capitals, so it makes an HTML element whose
        // local name holds capitals and a colon and that has no prefix; in an HTML document,
        // `createElement` lowercases such a name, and `createElementNS` reads the colon as a prefix
        const xhtml = document.implementation.createDocument(HTML_NAMESPACE, 'html', null);
        const named = document.adoptNode(xhtml.createElement('My:El'));
        container.append(named);
        await waitForMutations(100);

        expect(given.map(element => element === named)).toEqual([true]);
        const [copy] = insertedCopies() as Element[];
        expect([copy.namespaceURI, copy.prefix, copy.localName]).toEqual([HTML_NAMESPACE, null, 'My:El']);
      }))));

    test('copies a script as the browser does, and by hand an element with an attribute that Trusted Types checks, carrying that attribute in a namespace, which Trusted Types does not check', () =>
      withTrustedTypesNamingOnclickAndSrcdoc(asked => withElementRegistries(() => elementsGivenToImportNode(given => watchingTheDocument(async () => {
        asked.length = 0;
        given.length = 0;
        const added = document.createElement('div');
        added.innerHTML = '<script>start()</script><span onclick="go()">s</span><b title="t">plain</b><iframe srcdoc="x"></iframe>';
        container.append(added);
        await waitForMutations(100);

        expect(given.map(element => element.localName)).toEqual(['script']);
        expect(asked).toEqual([
          ['span', 'onclick', HTML_NAMESPACE, null],
          ['b', 'title', HTML_NAMESPACE, null],
          ['iframe', 'srcdoc', HTML_NAMESPACE, null],
        ]);
        const [copy] = insertedCopies() as Element[];
        const checked = [copy.querySelector('span')!.attributes[0], copy.querySelector('iframe')!.attributes[0]];
        expect(checked.map(attribute => [attribute.namespaceURI === null, attribute.prefix, attribute.name, attribute.value]))
          .toEqual([[false, null, 'onclick', 'go()'], [false, null, 'srcdoc', 'x']]);
        expect(copy.innerHTML).toBe(added.innerHTML);
      })))));

    test('records a later change and removal of an attribute that a copy carries in a namespace of its own, in the first snapshot and in an added subtree', async () => {
      container.innerHTML = '<span id="at-start" onclick="go()">s</span>';
      await withTrustedTypesNamingOnclickAndSrcdoc(() => withElementRegistries(() => watchingTheDocument(async () => {
        const added = document.createElement('span');
        added.setAttribute('onclick', 'go()');
        container.append(added);
        await waitForMutations(100);
        const spans = [container.querySelector('#at-start')!, added];

        spans.forEach(span => span.setAttribute('onclick', 'stop()'));
        await waitForMutations(100);
        spans.forEach(span => span.removeAttribute('onclick'));
        await waitForMutations(100);

        expect(spans.map(span => operations.filter(op => op.nodeId === NodeIdBiMap.getNodeId(span)).map(op => [op.op, op.name, op.value])))
          .toEqual(spans.map(() => [['updateAttribute', 'onclick', 'stop()'], ['removeAttribute', 'onclick', undefined]]));
      })));
    });

    test('copies as the browser does an element whose copy made by hand a DOM call refuses, reports each kind of refusal once, and records later changes', async () => {
      const warnings: unknown[][] = [];
      await replacing(console, 'warn', () => (...args: unknown[]) => { warnings.push(args); }, () =>
        replacing(Element.prototype, 'setAttributeNode', original => function (this: Element, attribute: Attr) {
          if (attribute.name === 'data-refused') throw new DOMException('Refused for this test', 'TestRefusalError');
          return original.call(this, attribute);
        }, () => withElementRegistries(() => elementsGivenToImportNode(given => watchingTheDocument(async () => {
          container.innerHTML = '<p id="elsewhere">before</p>';
          await waitForMutations(100);
          const added = document.createElement('section');
          added.innerHTML = '<b data-refused="1">one</b><i data-refused="2">two</i>';
          container.append(added);
          await waitForMutations(100);
          (container.querySelector('#elsewhere')!.firstChild as Text).data = 'after';
          await waitForMutations(100);

          const refused = Array.from(added.children);
          expect(given.map((element, i) => element === refused[i])).toEqual([true, true]);
          const [, copy] = insertedCopies() as Element[];
          expect(copy.innerHTML).toBe(added.innerHTML);
          expect(Array.from(copy.children).map((child, i) => liveNodeOf(child) === refused[i])).toEqual([true, true]);
          expect(warnings.map(([message, refusal]) => [String(message).includes('TestRefusalError'), (refusal as DOMException).name]))
            .toEqual([[true, 'TestRefusalError']]);
          const later = operations.at(-1);
          expect([later.op, later.nodeId]).toEqual(['updateText', NodeIdBiMap.getNodeId(container.querySelector('#elsewhere')!.firstChild!)]);
        })))));
    });

    test('removes the children that a custom element\'s code gives the browser\'s copy of an element, such as a label it renders, before adding the copies of the live children', async () => {
      // A browser runs a scoped custom element's attribute callback for its own copy of the element
      // before returning it; jsdom runs none for a copy, so here `importNode` does that callback's
      // work, rendering the element's label as its text and a `b` after it, two children, and the
      // copy made by hand is refused
      await replacing(console, 'warn', () => () => {}, () =>
        replacing(Element.prototype, 'setAttributeNode', original => function (this: Element, attribute: Attr) {
          if (attribute.name === 'data-label') throw new DOMException('Refused for this test', 'TestLabelRefusalError');
          return original.call(this, attribute);
        }, () => replacing(Document.prototype, 'importNode', original => function (this: Document, node: Node, deep?: any) {
          const copy = original.call(this, node, deep);
          if (node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute('data-label')) {
            copy.textContent = (node as Element).getAttribute('data-label');
            copy.appendChild(this.createElement('b'));
          }
          return copy;
        } as any, () => withElementRegistries(() => watchingTheDocument(async () => {
          const added = document.createElement('div');
          added.innerHTML = '<p data-label="hello">hello</p>';
          container.append(added);
          await waitForMutations(100);

          const liveText = added.firstElementChild!.firstChild!;
          const copies = Array.from((insertedCopies()[0] as Element).firstElementChild!.childNodes);
          expect(copies.map(copy => [copy.textContent, liveNodeOf(copy) === liveText, NodeIdBiMap.getNodeId(copy) === NodeIdBiMap.getNodeId(liveText)]))
            .toEqual([['hello', true, true]]);
        })))));
    });

    test('copies as the browser does a subtree whose copy a DOM call refuses outside one element\'s own copy, links only its root, and records later changes', async () => {
      const warnings: unknown[][] = [];
      await replacing(console, 'warn', () => (...args: unknown[]) => { warnings.push(args); }, () =>
        replacing(Node.prototype, 'appendChild', original => function <T extends Node>(this: Node, child: T): T {
          if (this.ownerDocument !== document && child.nodeName === 'SPAN') throw new DOMException('Refused for this test', 'TestAppendRefusalError');
          return original.call(this, child) as T;
        }, () => withElementRegistries(() => elementsGivenToImportNode(given => watchingTheDocument(async () => {
          container.innerHTML = '<p id="elsewhere">before</p>';
          await waitForMutations(100);
          const added = document.createElement('section');
          added.innerHTML = '<b>bold</b><span>refused</span><input type="password" value="attr">';
          container.append(added);
          await waitForMutations(100);
          (container.querySelector('#elsewhere')!.firstChild as Text).data = 'after';
          await waitForMutations(100);

          expect(given.map(element => element === added)).toEqual([true]);
          const [, copy] = insertedCopies() as Element[];
          expect(copy.outerHTML).toBe(added.outerHTML);
          const copies = [copy, ...Array.from(copy.children)];
          const live = [added, ...Array.from(added.children)];
          // The recorder masks the `value` attribute of a copy linked to no live node
          expect(copies.map(node => liveNodeOf(node) === undefined ? 'unlinked' : liveNodeOf(node) === added ? 'linked to the section' : 'linked elsewhere'))
            .toEqual(['linked to the section', 'unlinked', 'unlinked', 'unlinked']);
          expect(copies.map(node => NodeIdBiMap.getNodeId(node))).toEqual(live.map(node => NodeIdBiMap.getNodeId(node)));
          expect(warnings.map(([message, refusal]) => [String(message).includes('the subtree of an element named "section"'), (refusal as DOMException).name]))
            .toEqual([[true, 'TestAppendRefusalError']]);
          const later = operations.at(-1);
          expect([later.op, later.nodeId]).toEqual(['updateText', NodeIdBiMap.getNodeId(container.querySelector('#elsewhere')!.firstChild!)]);
        })))));
    });

    test('reports a refusal whose name cannot be read, and copies the element as the browser does', async () => {
      const warnings: unknown[][] = [];
      await replacing(console, 'warn', () => (...args: unknown[]) => { warnings.push(args); }, () =>
        replacing(Element.prototype, 'setAttributeNode', original => function (this: Element, attribute: Attr) {
          if (attribute.name === 'data-nameless') throw { get name(): string { throw new Error('A name getter that throws, for this test'); } };
          return original.call(this, attribute);
        }, () => withElementRegistries(() => elementsGivenToImportNode(given => watchingTheDocument(async () => {
          const added = document.createElement('section');
          added.innerHTML = '<b data-nameless="1">b</b>';
          container.append(added);
          await waitForMutations(100);

          expect(given.map(element => element === added.firstElementChild)).toEqual([true]);
          const [copy] = insertedCopies() as Element[];
          expect(copy.outerHTML).toBe(added.outerHTML);
          expect(warnings.map(([message]) => String(message).includes('later refusals named a refusal whose name cannot be read'))).toEqual([true]);
        })))));
    });
  });
});
