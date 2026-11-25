import 'global-jsdom/register';
import { KeyPressed } from '@domcorder/proto-ts';
import {
  PASSWORD,
  encodedText,
  framesRecordedWhile,
  keysRecorded,
  pageWith,
  pressKeysIn,
  typeInto,
} from './PasswordFieldsTestUtils';

describe('the recorder records only that a key was pressed in a password field', () => {
  it('in the keys pressed in the field, which keep no code and no modifier', async () => {
    const field = pageWith('<input type="password">');

    const frames = await framesRecordedWhile(() => {
      pressKeysIn(field, 'Hunter2');
      pressKeysIn(field, 'a', { altKey: true });
      pressKeysIn(field, 'c', { ctrlKey: true });
      pressKeysIn(field, 'v', { metaKey: true });
    });

    expect(await encodedText(frames)).not.toContain('Hunter2');
    const keys = frames.filter((frame): frame is KeyPressed => frame instanceof KeyPressed);
    expect(keys.map(key => [key.code, key.altKey, key.ctrlKey, key.metaKey, key.shiftKey])).toEqual(
      Array(10).fill(['•', false, false, false, false])
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

  it('while the keys pressed in other fields are recorded as they are', async () => {
    const field = pageWith('<input type="text" autocomplete="username">');

    const frames = await framesRecordedWhile(() => pressKeysIn(field, 'Hi'));

    expect(keysRecorded(frames)).toEqual([['KeyH', true], ['KeyI', false]]);
  });
});
