import 'global-jsdom/register';
import { Frame, Keyframe } from '@domcorder/proto-ts';
import { isOrWasPasswordField } from '../../src/recorder/PasswordFields';
import { delay } from './DomSyncTestUtils';
import {
  MASKED,
  PASSWORD,
  encodedText,
  framesRecordedWhile,
  insertedText,
  keysRecorded,
  pageWith,
  pressKeysIn,
  recorderOf,
  typeInto,
  valueAttributeChanges,
} from './PasswordFieldsTestUtils';

describe('which fields are password fields', () => {
  it('counts an input whose type is password', () => {
    expect(isOrWasPasswordField(pageWith('<input type="password">'))).toBe(true);
    expect(isOrWasPasswordField(pageWith('<input type="PASSWORD">'))).toBe(true);
  });

  it('counts an input whose autocomplete names a password', () => {
    expect(isOrWasPasswordField(pageWith('<input type="text" autocomplete="current-password">'))).toBe(true);
    expect(isOrWasPasswordField(pageWith('<input autocomplete="section-signup new-password">'))).toBe(true);
  });

  it('counts an input that was a password field when the recorder looked at it before', () => {
    const field = pageWith('<input type="password">');
    isOrWasPasswordField(field);

    field.type = 'text';

    expect(isOrWasPasswordField(field)).toBe(true);
  });

  it('counts a field the page showed as text before the recorder started, when its autocomplete names a password', async () => {
    // The recorder never sees this field be of type password, so only its autocomplete tells
    const field = pageWith('<input type="password" autocomplete="current-password">');
    typeInto(field, PASSWORD);
    // As React's controlled input does, the page mirrors the field's value into its value attribute
    field.setAttribute('value', field.value);
    field.type = 'text';

    const frames = await framesRecordedWhile(() => {
      typeInto(field, '!');
      field.setAttribute('value', field.value);
      pressKeysIn(field, 'Hi');
    });

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(JSON.stringify(frames.filter(frame => frame instanceof Keyframe))).toContain(`"value":"${MASKED}"`);
    expect(insertedText(frames)).toBe('•');
    expect(valueAttributeChanges(frames)).toEqual([`${MASKED}•`]);
    expect(keysRecorded(frames)).toEqual([['•', false], ['•', false]]);
  });

  it('does not count other fields', () => {
    expect(isOrWasPasswordField(pageWith('<input type="text" autocomplete="username">'))).toBe(false);
    expect(isOrWasPasswordField(pageWith('<input type="text" autocomplete="one-time-code">'))).toBe(false);
    document.body.innerHTML = '<textarea autocomplete="current-password"></textarea>';
    expect(isOrWasPasswordField(document.querySelector('textarea')!)).toBe(false);
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

    expect(isOrWasPasswordField(field)).toBe(false);
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
