/**
 * Password fields, whose characters the recorder does not record. Wherever the recorder would
 * record a password field's value, it records MASK_CHARACTER once for each of the value's
 * characters instead, and it records a key pressed in a password field as MASK_CHARACTER with
 * no modifiers, so that the value does not leave the page. The value's length, and when and how
 * many keys were pressed, are recorded. A second start of a recorder leaves the first start's
 * watch of `type` and `autocomplete` running, with that start's trackers.
 *
 * Not masked:
 * - A key pressed in a password field inside a closed shadow root. The recorder sees the root's
 *   host as the key's target and cannot look inside the root, so the key is recorded with its
 *   code and modifiers.
 * - Keys pressed in a field inside a same-origin frame or an open shadow root after the page has
 *   made it a text field, if the recorder had not seen it be a password field. The watch of
 *   `type` and `autocomplete` observes the page's own document only, so in those places the
 *   recorder sees a field only when a key is pressed in it, or, inside an open shadow root, in
 *   the first snapshot. A field there that the page shows as text before any key is pressed in it
 *   (a "show password" control used first), or makes a password field and a text field again in
 *   one task, has its keys recorded with their code and modifiers. A field whose autocomplete
 *   names a password is masked there too.
 * - A document inside the page. An iframe's `srcdoc`, a `data:` document and a frame's fetched
 *   source are recorded as served, so a password that a server writes into that markup as a
 *   `value` attribute is recorded.
 */

/** The character a recording holds for each character of a password field's value. */
export const MASK_CHARACTER = "•";

/** The attributes by which an input is a password field. */
const PASSWORD_FIELD_ATTRIBUTES = ["type", "autocomplete"];

/** The autocomplete tokens by which a page says that a field holds a password. */
const PASSWORD_AUTOCOMPLETE_TOKENS = new Set(["current-password", "new-password"]);

/**
 * The inputs the recorder has seen be password fields, so that a field the page turns into a
 * text field (as a "show password" control does) stays masked. Weak, so that it keeps no field
 * alive.
 */
const fieldsThatWerePasswordFields = new WeakSet<Element>();

/** The observers of the watches that `watchPasswordFields` has begun and not yet ended. */
const passwordFieldWatches = new Set<MutationObserver>();

/**
 * Watches the inputs under `root` for changes of `type` and `autocomplete`, so that an input that
 * was a password field only briefly, even within the task that inserted it, is remembered as one.
 * Returns what ends the watch.
 */
export function watchPasswordFields(root: Node): () => void {
  const watch = new MutationObserver(records => records.forEach(rememberPasswordFieldBeforeChange));
  watch.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: PASSWORD_FIELD_ATTRIBUTES,
    attributeOldValue: true,
  });
  passwordFieldWatches.add(watch);
  return () => {
    passwordFieldWatches.delete(watch);
    watch.disconnect();
  };
}

/**
 * Whether the recorder masks `element`'s value: an input that is a password field, or that the
 * recorder has seen be one. An input is a password field while its type is `password` or its
 * autocomplete names a password (a page can draw a password field from a text input masked
 * with CSS). Each input found to be one is remembered.
 */
export function isPasswordField(element: Element): boolean {
  if (element.localName !== "input") return false;
  // A watch is told of a change only once the script that made it has run, and that script may
  // set the field's value or press a key in it first, so the changes not yet told are read here
  for (const watch of passwordFieldWatches) {
    watch.takeRecords().forEach(rememberPasswordFieldBeforeChange);
  }
  if (PASSWORD_FIELD_ATTRIBUTES.some(name => makesAPasswordField(name, element.getAttribute(name)))) {
    fieldsThatWerePasswordFields.add(element);
    return true;
  }
  return fieldsThatWerePasswordFields.has(element);
}

/**
 * Remembers the input whose `type` or `autocomplete` the mutation `record` changed, if the value
 * the attribute held before the change made it a password field.
 */
function rememberPasswordFieldBeforeChange(record: MutationRecord): void {
  const element = record.target as Element;
  if (element.localName === "input" && makesAPasswordField(record.attributeName!, record.oldValue)) {
    fieldsThatWerePasswordFields.add(element);
  }
}

/** Whether an input's attribute `name`, holding `value`, makes the input a password field. */
function makesAPasswordField(name: string, value: string | null): boolean {
  if (value === null) return false;
  switch (name) {
    case "type":
      return value.toLowerCase() === "password";
    case "autocomplete":
      return value.toLowerCase().split(/\s+/).some(token => PASSWORD_AUTOCOMPLETE_TOKENS.has(token));
    default:
      return false;
  }
}

/** `value` as a recording holds it for a password field: one MASK_CHARACTER for each character. */
export function maskedValue(value: string): string {
  return MASK_CHARACTER.repeat(Array.from(value).length);
}

/**
 * An attribute as the recorder records it: a password field's `value` masked. `element` is the
 * element of the live page that has the attribute, never a copy of it, since only the element
 * itself, and what the watch remembers of it, can tell whether it has been a password field. It
 * is asked for every attribute, so that a field is remembered as one when the recorder first sees
 * it, whether or not it has a `value` attribute. When the recorder does not know the element, as
 * for a copy linked to none, it masks `value` too: a password recorded once cannot be taken back,
 * and a masked text field costs a recording little.
 */
export function recordedAttributeValue(element: Element | undefined, name: string, value: string): string {
  const passwordField = element === undefined || isPasswordField(element);
  return name === "value" && passwordField ? maskedValue(value) : value;
}

/** A property of a form field as the recorder records it: a password field's `value` masked. */
export function recordedPropertyValue(element: Element, property: string): any {
  const value = (element as any)[property];
  return property === "value" && isPasswordField(element) ? maskedValue(value) : value;
}

/**
 * Whether `event` was dispatched to a password field, looking through open shadow roots to the
 * field itself. A key pressed there tells which character the person typed.
 */
export function isDispatchedToPasswordField(event: Event): boolean {
  const target = event.composedPath()[0] ?? event.target;
  return (target as Node | null)?.nodeType === Node.ELEMENT_NODE && isPasswordField(target as Element);
}
