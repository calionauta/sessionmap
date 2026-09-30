import { describe, expect, test } from 'bun:test';
import { registerDom } from '../test/domEnv';

registerDom();

const { isTextEntryTarget } = await import('./keyboard');

describe('isTextEntryTarget', () => {
  test('a textarea belongs to the browser', () => {
    // The whole point: the markdown outline is a textarea, and its text is the
    // only copy of the session until it is parsed back into a tree.
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true);
  });

  test('an input belongs to the browser too, and it used not to', () => {
    // The row editor was a list of text inputs whose Ctrl+Z was deliberately
    // the tree's, which is why <input> was excluded. That editor is gone, and
    // every input left is a field in a dialog — a client's name, a map's title,
    // a search box — where undoing a mind map is never what was meant.
    expect(isTextEntryTarget(document.createElement('input'))).toBe(true);
  });

  test('a contenteditable region belongs to the browser', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    expect(isTextEntryTarget(el)).toBe(true);
  });

  test('anything that is not a field does not', () => {
    // The body, the canvas and every button must still reach the tree undo:
    // that is the shortcut's whole reason for existing once the editor is a
    // textarea and the caret is usually somewhere else.
    expect(isTextEntryTarget(document.createElement('div'))).toBe(false);
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false);
    expect(isTextEntryTarget(document)).toBe(false);
  });

  test('nothing at all is not a target', () => {
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
