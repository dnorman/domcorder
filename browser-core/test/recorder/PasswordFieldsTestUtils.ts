import 'global-jsdom/register';
import {
  DomAttributeChanged,
  DomNodeAdded,
  DomNodePropertyTextChanged,
  Frame,
  KeyPressed,
  Writer,
} from '@domcorder/proto-ts';
import { PageRecorder } from '../../src/recorder/PageRecorder';
import { delay } from './DomSyncTestUtils';

/**
 * What the tests of password fields share: a real recorder of a page, a person's typing and key
 * presses, and readers of what the recording holds.
 */

export const PASSWORD = 'hunter2';
/** What a recording holds for PASSWORD: one mask character for each of its characters. */
export const MASKED = '•••••••';

// The value setter the browser itself uses as a person types, taken before a recorder patches
// the prototype's setter to see a script's changes.
export const setValueAsTyping = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

/** Types `text` into `field` one character at a time, as a person does. */
export function typeInto(field: HTMLInputElement, text: string) {
  for (const character of text) {
    setValueAsTyping.call(field, field.value + character);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
}

/** Presses the key of each character of `text` in `field`, holding shift for capitals. */
export function pressKeysIn(field: HTMLInputElement, text: string) {
  for (const character of text) {
    const code = /[0-9]/.test(character) ? `Digit${character}` : `Key${character.toUpperCase()}`;
    const shiftKey = character !== character.toLowerCase();
    field.dispatchEvent(
      new window.KeyboardEvent('keydown', { code, key: character, shiftKey, bubbles: true, composed: true })
    );
  }
}

/** The page's body, made of `html`, and its first input. */
export function pageWith(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  return document.querySelector('input')!;
}

/** A real recorder of `page`, which keeps every frame it emits in `frames`. */
export function recorderOf(page: Document, frames: Frame[]): PageRecorder {
  // jsdom has no adopted style sheets, which the recorder's style sheet watcher reads
  if (!page.adoptedStyleSheets) {
    Object.defineProperty(page, 'adoptedStyleSheets', { value: [], writable: true, configurable: true });
  }
  const recorder = new PageRecorder(page);
  recorder.addFrameHandler(async frame => { frames.push(frame); });
  return recorder;
}

/** Every frame a real recorder emits while it records the page and `act` runs. */
export async function framesRecordedWhile(act: () => void | Promise<void>): Promise<Frame[]> {
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
export async function encodedText(frames: Frame[]): Promise<string> {
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
export function insertedText(frames: Frame[]): string {
  return frames
    .filter((frame): frame is DomNodePropertyTextChanged => frame instanceof DomNodePropertyTextChanged)
    .flatMap(frame => frame.operations)
    .map(operation => (operation.op === 'insert' ? operation.text : ''))
    .join('');
}

/** The values the recorder recorded of `value` attributes as they changed, in order. */
export function valueAttributeChanges(frames: Frame[]): string[] {
  return frames
    .filter((frame): frame is DomAttributeChanged => frame instanceof DomAttributeChanged && frame.attributeName === 'value')
    .map(frame => frame.attributeValue);
}

/** What the recorder recorded of the subtrees added to the page, as text. */
export function addedSubtrees(frames: Frame[]): string {
  return JSON.stringify(frames.filter(frame => frame instanceof DomNodeAdded));
}

/** The keys the recorder recorded, each as its code and whether shift was held. */
export function keysRecorded(frames: Frame[]): [string, boolean][] {
  return frames
    .filter((frame): frame is KeyPressed => frame instanceof KeyPressed)
    .map(key => [key.code, key.shiftKey]);
}
