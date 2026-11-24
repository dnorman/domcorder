import 'global-jsdom/register';
import { DomNodeAdded, Frame, Keyframe, VElement, VNode } from '@domcorder/proto-ts';
import { NodeIdBiMap } from '../../src/common';
import { DomChangeDetector } from '../../src/recorder/DomChangeDetector';
import { inlineSubTree } from '../../src/recorder/inliner';
import { AssetTracker } from '../../src/recorder/inliner/AssetTracker';
import { delay } from './DomSyncTestUtils';
import {
  MASKED,
  PASSWORD,
  addedSubtrees,
  encodedText,
  framesRecordedWhile,
  pageWith,
  recorderOf,
  typeInto,
  valueAttributeChanges,
} from './PasswordFieldsTestUtils';

/**
 * The snapshot `inlineSubTree` takes of `node`, a node the change detector did not copy, when it
 * asks the detector for the live elements, as the recorder does.
 */
async function snapshotOfUnlinkedCopy(node: Node): Promise<VElement> {
  let snapshot: VNode | undefined;
  await inlineSubTree(node, new NodeIdBiMap(), new AssetTracker(), DomChangeDetector.liveNodeOf, {
    onInlineStarted: event => { snapshot = event.node; },
    onAsset: () => {},
  });
  return snapshot as VElement;
}

describe('the recorder asks the field in the live page whether to mask its value attribute, whatever id the field carries', () => {
  it('in the keyframe of a later start, for a field in an open shadow root', async () => {
    document.body.innerHTML = '<div id="top"></div><div id="host"></div>';
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<input type="password" value="${PASSWORD}">`;
    const frames: Frame[] = [];
    const recorder = recorderOf(document, frames);
    recorder.start();
    // Each start numbers the nodes outside shadow roots afresh, and the field inside keeps the id
    // the first start gave it, which a node the page adds outside takes in the second start
    document.getElementById('top')!.innerHTML = '<span></span><span></span><span></span>';
    await delay(50);
    recorder.stop();
    const fromSecondStart = frames.length;
    recorder.start();
    recorder.stop();

    const keyframes = frames.slice(fromSecondStart).filter(frame => frame instanceof Keyframe);
    expect(keyframes).toHaveLength(1);
    // The encoding the recorder's client sends leaves shadow roots out, so the frame is read whole
    expect(JSON.stringify(keyframes)).not.toContain(PASSWORD);
    expect(JSON.stringify(keyframes)).toContain(MASKED);
  });

  // A second start with no stop between leaves the first start's change detector running, so
  // each of these recorders records a document of its own, which no other test changes
  async function framesRecordedAfterSecondStart(
    page: Document,
    inTaskOfSecondStart: () => void,
    act: () => void | Promise<void>
  ): Promise<Frame[]> {
    const frames: Frame[] = [];
    const recorder = recorderOf(page, frames);
    recorder.start();
    await delay(50);
    inTaskOfSecondStart();
    recorder.start();
    await delay(50);
    await act();
    await delay(50);
    recorder.stop();
    return frames;
  }

  /** Nodes added in the task of a second start, which give the field an id that names another node. */
  function addNodesBeforeTheField(page: Document) {
    page.getElementById('top')!.innerHTML = '<span>a</span><span>b</span><input type="text"><input type="text">';
  }

  it('as a script sets the field\'s value attribute after a second start', async () => {
    const page = document.implementation.createHTMLDocument();
    page.body.innerHTML = '<div id="top"></div><input type="text"><input type="password">';
    const field = page.querySelector<HTMLInputElement>('input[type="password"]')!;

    const frames = await framesRecordedAfterSecondStart(
      page,
      () => addNodesBeforeTheField(page),
      () => field.setAttribute('value', PASSWORD)
    );

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(new Set(valueAttributeChanges(frames))).toEqual(new Set([MASKED]));
  });

  it('as the page makes the field hidden after a second start, which copies what was typed into its value attribute', async () => {
    const page = document.implementation.createHTMLDocument();
    page.body.innerHTML = '<div id="top"></div><input type="text"><input type="password">';
    const field = page.querySelector<HTMLInputElement>('input[type="password"]')!;

    const frames = await framesRecordedAfterSecondStart(page, () => addNodesBeforeTheField(page), async () => {
      typeInto(field, PASSWORD);
      await delay(50);
      field.type = 'hidden';
    });

    expect(field.getAttribute('value')).toBe(PASSWORD);
    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(new Set(valueAttributeChanges(frames))).toEqual(new Set([MASKED]));
  });

  it('in the snapshot of a field added as a password field and shown as text in the same task, after a second start', async () => {
    const page = document.implementation.createHTMLDocument();
    page.body.innerHTML = '<div id="destination"></div>';

    const frames = await framesRecordedAfterSecondStart(page, () => {}, () => {
      page.getElementById('destination')!.innerHTML = `<div><input type="password" value="${PASSWORD}"></div>`;
      page.querySelector('input')!.type = 'text';
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(addedSubtrees(frames)).toContain(MASKED);
  });

  // The change detector records the moved field's new place, then, recording that the field left
  // its old place, drops the field's id from the recorder's numbering of the page
  it('in the snapshot of a field shown as text that the page moves before its sibling', async () => {
    const field = pageWith(`<div><span>x</span><input type="password" value="${PASSWORD}"></div>`);

    const frames = await framesRecordedWhile(async () => {
      field.type = 'text';
      await delay(50);
      field.parentElement!.prepend(field);
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(addedSubtrees(frames)).toContain(MASKED);
  });

  it('in the snapshot of a field made hidden that the page moves into an element it changed in the same task', async () => {
    const field = pageWith('<div><span>x</span><input type="password"></div><div id="destination"></div>');

    const frames = await framesRecordedWhile(async () => {
      typeInto(field, PASSWORD);
      field.type = 'hidden';
      await delay(50);
      const destination = document.getElementById('destination')!;
      destination.setAttribute('class', 'filled');
      destination.append(field);
    });

    expect(field.getAttribute('value')).toBe(PASSWORD);
    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(addedSubtrees(frames)).toContain(MASKED);
  });
});

describe('the recorder asks the field in the live page whether to mask its value attribute, however the change detector copied it', () => {
  it('masks the value attribute of a copy linked to no live element, even a text field\'s, and no other', async () => {
    const field = pageWith(`<input type="text" class="sign-in" value="${PASSWORD}">`);

    // The change detector links each copy it makes to the live element; this copy it did not make
    const snapshot = await snapshotOfUnlinkedCopy(field.cloneNode());

    expect(snapshot.attrs).toEqual({ type: 'text', class: 'sign-in', value: MASKED });
  });

  it('masks the value attribute of a stylesheet link and of a resource hint linked to no live element', async () => {
    document.head.innerHTML =
      `<link rel="stylesheet" href="data:text/css," media="print" value="${PASSWORD}">` +
      `<link rel="preload" href="data:text/javascript," as="script" value="${PASSWORD}">`;
    const [stylesheet, hint] = Array.from(document.head.querySelectorAll('link'));

    const snapshots = [
      await snapshotOfUnlinkedCopy(stylesheet.cloneNode()),
      await snapshotOfUnlinkedCopy(hint.cloneNode()),
    ];
    document.head.innerHTML = '';

    expect(snapshots.map(snapshot => [snapshot.attrs.value, snapshot.attrs.media ?? snapshot.attrs.as])).toEqual([
      [MASKED, 'print'],
      [MASKED, 'script'],
    ]);
  });

  it('while the value attributes of other fields are recorded as they are, below the root of an added subtree and moved before a sibling', async () => {
    document.body.innerHTML = '<form><span>x</span><input type="text" value="dave"></form>';

    const frames = await framesRecordedWhile(async () => {
      // The change detector copies the added div with the field below it
      document.querySelector('form')!.insertAdjacentHTML('beforeend', '<div><input type="text" value="carol"></div>');
      await delay(50);
      // It copies the moved field as it puts the field in the place of the span
      const dave = document.querySelector<HTMLInputElement>('input[value="dave"]')!;
      dave.parentElement!.prepend(dave);
    });

    expect(addedSubtrees(frames)).toContain('"value":"carol"');
    expect(addedSubtrees(frames)).toContain('"value":"dave"');
  });

  it('in the snapshot of a custom element that reorders the children of a copy its code runs for, each field with its own id', async () => {
    // A browser runs a custom element's attribute callback for a copy of the element made in the
    // page's document before the copy is returned; this one moves the copy's first child to its end
    if (!customElements.get('reordering-fields')) {
      customElements.define('reordering-fields', class extends HTMLElement {
        static observedAttributes = ['data-order'];
        attributeChangedCallback() { if (this.firstChild) this.append(this.firstChild); }
      });
    }
    document.body.innerHTML = '<form></form>';
    let fields: HTMLInputElement[] = [];

    const frames = await framesRecordedWhile(() => {
      document.querySelector('form')!.innerHTML =
        '<reordering-fields data-order="first-to-last">' +
        `<input type="password" value="${PASSWORD}"><input type="text" value="alice"><input type="text" value="bob">` +
        '</reordering-fields>';
      fields = Array.from(document.querySelectorAll('input'));
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    const element = frames
      .filter((frame): frame is DomNodeAdded => frame instanceof DomNodeAdded)
      .map(frame => frame.vNode as VElement)
      .find(vNode => vNode.tag === 'reordering-fields')!;
    // Each recorded field carries the id of the live field whose value attribute it records
    expect((element.children as VElement[]).map(child => [child.id, child.attrs.value])).toEqual(
      fields.map(field => [NodeIdBiMap.getNodeId(field), field.type === 'password' ? MASKED : field.getAttribute('value')])
    );
  });
});
