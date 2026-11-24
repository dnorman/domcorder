import 'global-jsdom/register';
import { Keyframe } from '@domcorder/proto-ts';
import { delay } from './DomSyncTestUtils';
import {
  MASKED,
  PASSWORD,
  addedSubtrees,
  encodedText,
  framesRecordedWhile,
  pageWith,
  valueAttributeChanges,
} from './PasswordFieldsTestUtils';

describe('the recorder records no character of a password field\'s value attribute', () => {
  it('in the first snapshot of a field whose value attribute holds a password', async () => {
    pageWith(`<input type="password" value="${PASSWORD}">`);

    const text = await encodedText(await framesRecordedWhile(() => {}));

    expect(text).not.toContain(PASSWORD);
    expect(text).toContain(MASKED);
  });

  it('while a keyframe records the value attributes of other fields as they are', async () => {
    pageWith(`<input type="password" value="${PASSWORD}"><input type="text" value="alice">`);

    const frames = await framesRecordedWhile(() => {});

    const keyframes = JSON.stringify(frames.filter(frame => frame instanceof Keyframe));
    expect(keyframes).toContain('"value":"alice"');
    expect(keyframes).toContain(`"value":"${MASKED}"`);
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

  it('as a script sets the field\'s value attribute', async () => {
    const field = pageWith('<input type="password">');

    const frames = await framesRecordedWhile(() => field.setAttribute('value', PASSWORD));

    expect(await encodedText(frames)).not.toContain(PASSWORD);
    expect(valueAttributeChanges(frames)).toEqual([MASKED]);
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
});
