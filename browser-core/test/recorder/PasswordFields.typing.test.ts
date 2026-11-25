import 'global-jsdom/register';
import { DomNodePropertyChanged } from '@domcorder/proto-ts';
import { maskedValue } from '../../src/recorder/PasswordFields';
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
  setValueAsTyping,
  typeInto,
} from './PasswordFieldsTestUtils';

describe('the recorder records no character typed or set into a password field', () => {
  it('but one mask character for each character, however it is encoded', () => {
    expect(maskedValue('pässwörd😀')).toBe('•••••••••');
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
});
