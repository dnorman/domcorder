import 'global-jsdom/register';
import {
  DomAttributeChanged,
  DomNodeAdded,
  DomNodePropertyChanged,
  DomNodePropertyTextChanged,
  Frame,
  Keyframe,
  KeyPressed,
  VElement,
  VNode,
  Writer,
} from '@domcorder/proto-ts';
import { NodeIdBiMap } from '../../src/common';
import { PageRecorder } from '../../src/recorder/PageRecorder';
import { isPasswordField, maskedValue } from '../../src/recorder/PasswordFields';
import { inlineSubTree } from '../../src/recorder/inliner';
import { AssetTracker } from '../../src/recorder/inliner/AssetTracker';
import { delay } from './DomSyncTestUtils';

const PASSWORD = 'hunter2';
/** What a recording holds for PASSWORD: one mask character for each of its characters. */
const MASKED = '•••••••';

// The value setter the browser itself uses as a person types, taken before a recorder patches
// the prototype's setter to see a script's changes.
const setValueAsTyping = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

/** Types `text` into `field` one character at a time, as a person does. */
function typeInto(field: HTMLInputElement, text: string) {
  for (const character of text) {
    setValueAsTyping.call(field, field.value + character);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
}

/** Presses the key of each character of `text` in `field`, holding shift for capitals. */
function pressKeysIn(field: HTMLInputElement, text: string) {
  for (const character of text) {
    const code = /[0-9]/.test(character) ? `Digit${character}` : `Key${character.toUpperCase()}`;
    const shiftKey = character !== character.toLowerCase();
    field.dispatchEvent(
      new window.KeyboardEvent('keydown', { code, key: character, shiftKey, bubbles: true, composed: true })
    );
  }
}

/** The page's body, made of `html`, and its first input. */
function pageWith(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  return document.querySelector('input')!;
}

/** A real recorder of `page`, which keeps every frame it emits in `frames`. */
function recorderOf(page: Document, frames: Frame[]): PageRecorder {
  // jsdom has no adopted style sheets, which the recorder's style sheet watcher reads
  if (!page.adoptedStyleSheets) {
    Object.defineProperty(page, 'adoptedStyleSheets', { value: [], writable: true, configurable: true });
  }
  const recorder = new PageRecorder(page);
  recorder.addFrameHandler(async frame => { frames.push(frame); });
  return recorder;
}

/** Every frame a real recorder emits while it records the page and `act` runs. */
async function framesRecordedWhile(act: () => void | Promise<void>): Promise<Frame[]> {
  const frames: Frame[] = [];
  const recorder = recorderOf(document, frames);
  recorder.start();
  try {
    await delay(50);
    await act();
    await delay(50);
  } finally {
    recorder.stop();
  }
  return frames;
}

/** The frames encoded as the recorder's client sends them, read as text. */
async function encodedText(frames: Frame[]): Promise<string> {
  const [writer, stream] = Writer.create();
  const chunks: Uint8Array[] = [];
  const reading = (async () => {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      chunks.push(value);
    }
  })();
  for (const frame of frames) {
    await frame.encode(writer);
  }
  writer.close();
  await reading;
  return chunks.map(chunk => new TextDecoder().decode(chunk)).join('');
}

/** What the recorder's changes of fields' text insert, joined in order. */
function insertedText(frames: Frame[]): string {
  return frames
    .filter((frame): frame is DomNodePropertyTextChanged => frame instanceof DomNodePropertyTextChanged)
    .flatMap(frame => frame.operations)
    .map(operation => (operation.op === 'insert' ? operation.text : ''))
    .join('');
}

/** The values the recorder recorded of `value` attributes as they changed, in order. */
function valueAttributeChanges(frames: Frame[]): string[] {
  return frames
    .filter((frame): frame is DomAttributeChanged => frame instanceof DomAttributeChanged && frame.attributeName === 'value')
    .map(frame => frame.attributeValue);
}

/** What the recorder recorded of the subtrees added to the page, as text. */
function addedSubtrees(frames: Frame[]): string {
  return JSON.stringify(frames.filter(frame => frame instanceof DomNodeAdded));
}

/** The keys the recorder recorded, each as its code and whether shift was held. */
function keysRecorded(frames: Frame[]): [string, boolean][] {
  return frames
    .filter((frame): frame is KeyPressed => frame instanceof KeyPressed)
    .map(key => [key.code, key.shiftKey]);
}

describe('which fields are password fields, and how their values are masked', () => {
  it('counts an input whose type is password', () => {
    expect(isPasswordField(pageWith('<input type="password">'))).toBe(true);
    expect(isPasswordField(pageWith('<input type="PASSWORD">'))).toBe(true);
  });

  it('counts an input whose autocomplete names a password', () => {
    expect(isPasswordField(pageWith('<input type="text" autocomplete="current-password">'))).toBe(true);
    expect(isPasswordField(pageWith('<input autocomplete="section-signup new-password">'))).toBe(true);
  });

  it('counts an input that was a password field when the recorder looked at it before', () => {
    const field = pageWith('<input type="password">');
    isPasswordField(field);

    field.type = 'text';

    expect(isPasswordField(field)).toBe(true);
  });

  it('is masked as one mask character for each character, however it is encoded', () => {
    expect(maskedValue('pässwörd😀')).toBe('•••••••••');
  });

  it('masks the value attribute of a copy linked to no live element, even a text field\'s, and no other', async () => {
    const field = pageWith(`<input type="text" class="sign-in" value="${PASSWORD}">`);
    // The change detector links each copy it makes to the live element; this copy it did not make
    const copy = field.cloneNode();
    let snapshot: VNode | undefined;

    await inlineSubTree(copy, new NodeIdBiMap(), new AssetTracker(), {
      onInlineStarted: event => { snapshot = event.node; },
      onAsset: () => {},
    });

    expect((snapshot as VElement).attrs).toEqual({ type: 'text', class: 'sign-in', value: MASKED });
  });

  it('does not count other fields', () => {
    expect(isPasswordField(pageWith('<input type="text" autocomplete="username">'))).toBe(false);
    expect(isPasswordField(pageWith('<input type="text" autocomplete="one-time-code">'))).toBe(false);
    document.body.innerHTML = '<textarea autocomplete="current-password"></textarea>';
    expect(isPasswordField(document.querySelector('textarea')!)).toBe(false);
  });
});

describe('the recorder records no character of a password field', () => {
  it('in the first snapshot of a field whose value attribute holds a password', async () => {
    pageWith(`<input type="password" value="${PASSWORD}">`);

    const text = await encodedText(await framesRecordedWhile(() => {}));

    expect(text).not.toContain(PASSWORD);
    expect(text).toContain(MASKED);
  });

  it('in the snapshot of a field added while recording', async () => {
    document.body.innerHTML = '<form></form>';

    const text = await encodedText(await framesRecordedWhile(() => {
      document.querySelector('form')!.innerHTML = `<input type="password" value="${PASSWORD}">`;
    }));

    expect(text).not.toContain(PASSWORD);
    expect(text).toContain(MASKED);
  });

  it('in the snapshot of a field added as a password field and shown as text before it was recorded', async () => {
    document.body.innerHTML = '<form></form>';

    const text = await encodedText(await framesRecordedWhile(async () => {
      document.querySelector('form')!.innerHTML = `<input type="password" value="${PASSWORD}">`;
      // The recorder's form-field tracker sees the field before the change detector does
      await Promise.resolve();
      document.querySelector('input')!.type = 'text';
    }));

    expect(text).not.toContain(PASSWORD);
    expect(text).toContain(MASKED);
  });

  it('in a field turned into a text field in the task that inserts it as a password field, then typed into', async () => {
    document.body.innerHTML = '<form></form>';

    const frames = await framesRecordedWhile(async () => {
      const form = document.querySelector('form')!;
      form.innerHTML = `<input type="password" value="${PASSWORD}">`;
      const field = form.querySelector('input')!;
      field.type = 'text';
      // The form-field tracker binds an added field once the task that added it has run
      await delay(50);
      typeInto(field, '!');
    });

    const text = await encodedText(frames);
    expect(text).not.toContain(PASSWORD);
    expect(text).toContain(MASKED);
    expect(insertedText(frames)).toBe('•');
  });

  it('as a person types into the field', async () => {
    const field = pageWith('<input type="password">');

    const frames = await framesRecordedWhile(() => typeInto(field, PASSWORD));

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(MASKED);
  });

  it('as a person types into a field that already holds part of a password, one mask character a key', async () => {
    const field = pageWith('<input type="password">');
    setValueAsTyping.call(field, 'hunter');

    const frames = await framesRecordedWhile(() => typeInto(field, '2'));

    expect(await encodedText(frames)).not.toContain('hunter');
    expect(insertedText(frames)).toBe('•');
  });

  it('as a script sets the field\'s value, as a password manager fills a sign-in form', async () => {
    const field = pageWith('<input type="password">');

    const frames = await framesRecordedWhile(() => { field.value = PASSWORD; });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(MASKED);
  });

  it('as a script sets the field\'s value attribute', async () => {
    const field = pageWith('<input type="password">');

    const frames = await framesRecordedWhile(() => field.setAttribute('value', PASSWORD));

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(valueAttributeChanges(frames)).toEqual([MASKED]);
  });

  it('as the page resets the form to a value attribute that holds a password', async () => {
    const field = pageWith(`<form><input type="password" value="${PASSWORD}"></form>`);

    const frames = await framesRecordedWhile(() => {
      setValueAsTyping.call(field, '');
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
      field.form!.reset();
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(MASKED);
  });

  it('after the page turns the field into a text field to show the password', async () => {
    const field = pageWith('<input type="password">');

    const frames = await framesRecordedWhile(() => {
      field.type = 'text';
      typeInto(field, PASSWORD);
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(MASKED);
  });

  it('in a text field made a password field and a text field again in the task that then types into it', async () => {
    const field = pageWith('<input type="text">');

    const frames = await framesRecordedWhile(() => {
      field.type = 'password';
      field.type = 'text';
      typeInto(field, PASSWORD);
      pressKeysIn(field, PASSWORD);
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(MASKED);
    expect(keysRecorded(frames)).toEqual(Array(7).fill(['•', false]));
  });

  it('as a script sets the value of a text field it made a password field and a text field again in the same task', async () => {
    const field = pageWith('<input type="text">');

    const frames = await framesRecordedWhile(() => {
      field.type = 'password';
      field.type = 'text';
      field.value = PASSWORD;
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(MASKED);
  });

  it('as the page resets the form of a text field it made a password field and a text field again in the same task', async () => {
    const field = pageWith('<form><input type="text"></form>');

    const frames = await framesRecordedWhile(() => {
      typeInto(field, 'x');
      field.type = 'password';
      field.setAttribute('value', PASSWORD);
      field.type = 'text';
      field.form!.reset();
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(`x${MASKED}`);
  });

  it('as a script sets the value of a text field whose autocomplete named a password earlier in the same task', async () => {
    const field = pageWith('<input type="text">');

    const frames = await framesRecordedWhile(() => {
      field.setAttribute('autocomplete', 'current-password');
      field.removeAttribute('autocomplete');
      field.value = PASSWORD;
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(MASKED);
  });

  it('in a text field whose autocomplete names a password', async () => {
    const field = pageWith('<input type="text" autocomplete="current-password">');

    const frames = await framesRecordedWhile(() => typeInto(field, PASSWORD));

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(MASKED);
  });

  it('in a number field whose autocomplete names a password, whose value changes whole', async () => {
    const field = pageWith('<input type="number" autocomplete="current-password">');

    const frames = await framesRecordedWhile(() => typeInto(field, '1234'));

    expect(await encodedText(frames)).not.toContain('1234');
    const valueChanges = frames.filter(
      (frame): frame is DomNodePropertyChanged => frame instanceof DomNodePropertyChanged && frame.propertyName === 'value'
    );
    expect(valueChanges.map(frame => frame.propertyValue)).toEqual(['•', '••', '•••', '••••']);
  });

  it('in the keys pressed in the field, which keep only that a key was pressed', async () => {
    const field = pageWith('<input type="password">');

    const frames = await framesRecordedWhile(() => pressKeysIn(field, 'Hunter2'));

    expect(await encodedText(frames)).not.toContain('Hunter2');
    const keys = frames.filter((frame): frame is KeyPressed => frame instanceof KeyPressed);
    expect(keys.map(key => [key.code, key.altKey, key.ctrlKey, key.metaKey, key.shiftKey])).toEqual(
      Array(7).fill(['•', false, false, false, false])
    );
  });

  it('in the keys pressed in a password field inside a shadow root', async () => {
    document.body.innerHTML = '<div></div>';
    const shadow = document.querySelector('div')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input type="password">';

    const frames = await framesRecordedWhile(() => pressKeysIn(shadow.querySelector('input')!, 'Hi'));

    expect(await encodedText(frames)).not.toContain('Hi');
    expect(keysRecorded(frames)).toEqual([['•', false], ['•', false]]);
  });

  it('in an empty password field inside a shadow root that the page shows as text, then typed into', async () => {
    document.body.innerHTML = '<div></div>';
    const shadow = document.querySelector('div')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input type="password">';
    const field = shadow.querySelector('input')!;

    const frames = await framesRecordedWhile(() => {
      field.type = 'text';
      typeInto(field, PASSWORD);
      pressKeysIn(field, PASSWORD);
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(keysRecorded(frames)).toEqual(Array(7).fill(['•', false]));
  });

  it('while the value attributes of other fields are recorded as they are, as the page adds a field and changes it', async () => {
    document.body.innerHTML = '<form></form>';

    const frames = await framesRecordedWhile(async () => {
      document.querySelector('form')!.innerHTML = '<input type="text" value="alice">';
      await delay(50);
      document.querySelector('input')!.setAttribute('value', 'bob');
    });

    expect(addedSubtrees(frames)).toContain('"value":"alice"');
    expect(valueAttributeChanges(frames)).toEqual(['bob']);
  });

  it('while the keys pressed in other fields are recorded as they are', async () => {
    const field = pageWith('<input type="text" autocomplete="username">');

    const frames = await framesRecordedWhile(() => pressKeysIn(field, 'Hi'));

    expect(keysRecorded(frames)).toEqual([['KeyH', true], ['KeyI', false]]);
  });
});

describe('the recorder records no character of a password field\'s value attribute, whatever id the field carries', () => {
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

describe('the recorder\'s watch of password fields', () => {
  it('ends when the recorder stops', async () => {
    const field = pageWith('<input type="text">');
    await framesRecordedWhile(() => {});

    field.type = 'password';
    field.type = 'text';
    // Only a watch sees that the field was a password field for a moment; one still observing
    // the page remembers it once told of the change, which this wait gives it time for
    await delay(0);

    expect(isPasswordField(field)).toBe(false);
  });

  it('keeps masking what the first start\'s trackers record after a recorder started twice stops', async () => {
    // A second start leaves the first start's trackers running, and they go on recording after
    // the stop, so this recorder records a document of its own, which no other test changes
    const page = document.implementation.createHTMLDocument();
    page.body.innerHTML = '<input type="text">';
    const field = page.querySelector('input')!;
    const frames: Frame[] = [];
    const recorder = recorderOf(page, frames);
    recorder.start();
    recorder.start();
    recorder.stop();

    field.type = 'password';
    field.type = 'text';
    field.value = PASSWORD;
    await delay(50);

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(insertedText(frames)).toBe(MASKED);
  });
});
