import { describe, expect, test } from 'bun:test';
import { registerDom } from '../test/domEnv';

registerDom();

const { isBrowserUndoTarget } = await import('./keyboard');

describe('isBrowserUndoTarget', () => {
  test('a textarea belongs to the browser', () => {
    // The whole point: the markdown outline is a textarea, and its text is the
    // only copy of the session until it is parsed back into a tree.
    expect(isBrowserUndoTarget(document.createElement('textarea'))).toBe(true);
  });

  test('a contenteditable region belongs to the browser', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    expect(isBrowserUndoTarget(el)).toBe(true);
  });

  test('an outline row does NOT — tree undo there is the requested behaviour', () => {
    // Stated as its own test because it is the line that could be crossed by a
    // later "simplification". Taking tree undo away from the row editor would
    // trade a feature for the bug this was written to fix.
    expect(isBrowserUndoTarget(document.createElement('input'))).toBe(false);
    expect(isBrowserUndoTarget(document.createElement('div'))).toBe(false);
  });

  test('nothing at all is not a target', () => {
    expect(isBrowserUndoTarget(null)).toBe(false);
    expect(isBrowserUndoTarget(document)).toBe(false);
  });
});
