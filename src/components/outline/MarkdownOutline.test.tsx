import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, cleanup, act } = await import('@testing-library/react');
const React = await import('react');
const { MarkdownOutline } = await import('./MarkdownOutline');
const { treeToMarkdown } = await import('../../utils/tree');
import type { MindMapNode } from '../../types';

const node = (
  id: string,
  text: string,
  children: MindMapNode[] = [],
  collapsed = false
): MindMapNode => ({ id, text, children, collapsed });

const fixture = (): MindMapNode =>
  node('root', '28/09/2026', [
    node('trab', 'Trabalho', [
      node('t1', 'cansaço'),
      node('t2', 'chefe cobra', [node('t2a', 'prazos curtos')]),
    ]),
    node('fam', 'Família', [node('f1', 'mãe apoia')]),
  ]);

let container: HTMLElement | null = null;
let lastRoot: MindMapNode | null = null;
let updateCount = 0;
let reasons: string[] = [];

let selections: Array<{ nodeId: string | null; reason: string }> = [];

function setup(
  root: MindMapNode = fixture(),
  enableNodeMove = true,
  focusDwellSeconds = 0
) {
  lastRoot = root;
  updateCount = 0;
  reasons = [];
  selections = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  render(
    React.createElement(MarkdownOutline, {
      root,
      onUpdateRoot: (r: MindMapNode, reason: string) => {
        lastRoot = r;
        updateCount++;
        reasons.push(reason);
      },
      onSelectNode: (nodeId: string | null, reason: string) => {
        selections.push({ nodeId, reason });
      },
      onDraftChange: () => {},
      selectedNodeId: null,
      focusDwellSeconds,
      theme: 'papel' as const,
      enableNodeMove,
      outlineFontScale: 1,
    }),
    { container }
  );
  return container;
}

function textarea(): HTMLTextAreaElement {
  const el = container!.querySelector('textarea');
  if (!el) throw new Error('no textarea');
  return el as HTMLTextAreaElement;
}

/** Types text, replacing the whole buffer. */
function type(value: string) {
  const el = textarea();
  act(() => {
    fireEvent.change(el, { target: { value } });
  });
}

/** Places the caret at a character offset. */
function caretAt(offset: number, end: number = offset) {
  const el = textarea();
  el.setSelectionRange(offset, end);
  act(() => {
    fireEvent.select(el);
  });
}

function press(key: string, init: Record<string, unknown> = {}) {
  act(() => {
    fireEvent.keyDown(textarea(), { key, ...init });
  });
}

/** Puts the caret at the start of the buffer line containing `fragment`. */
function caretOnLine(fragment: string) {
  const el = textarea();
  const offset = el.value.indexOf(fragment);
  if (offset === -1) throw new Error(`no line "${fragment}" in:\n${el.value}`);
  caretAt(offset);
  return offset;
}

/** Waits past a dwell of `seconds`, in real time. */
async function waitPastDwell(seconds: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, seconds * 1000 + 400));
  });
}

describe('the markdown buffer', () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  test('shows the outline as markdown, session row as a heading', () => {
    setup();
    const value = textarea().value;
    expect(value.split('\n')[0]).toBe('# 28/09/2026');
    expect(value).toContain('- Trabalho');
    expect(value).toContain('  - cansaço');
  });

  test('one control, not one per topic', () => {
    setup();
    // The whole trade this mode makes: a single focusable field, which is what
    // buys native selection across levels.
    expect(container!.querySelectorAll('textarea')).toHaveLength(1);
    expect(container!.querySelectorAll('input')).toHaveLength(0);
  });

  test('Ctrl+Z is left to the browser', () => {
    // The bug: the window handler used to preventDefault this and apply a TREE
    // undo, which has no entry for the text that was typed. Deleting the whole
    // buffer and pressing Ctrl+Z did nothing at all, and the buffer is the only
    // copy of the session until it parses back into a tree.
    //
    // fireEvent returns false when the event was cancelled, so true here means
    // the browser still owns the key.
    setup();
    expect(
      fireEvent.keyDown(textarea(), { key: 'z', ctrlKey: true, cancelable: true })
    ).toBe(true);
  });

  test('Tab indents the current line', () => {
    setup();
    const el = textarea();
    const at = el.value.indexOf('- cansaço');
    caretAt(at + 1);
    press('Tab');
    expect(textarea().value).toContain('  - cansaço');
  });

  test('Shift+Tab outdents it again', () => {
    setup();
    const el = textarea();
    const at = el.value.indexOf('- cansaço');
    caretAt(at + 1);
    // "cansaço" starts one level in, so one Shift+Tab returns it to the top.
    press('Tab', { shiftKey: true });
    expect(textarea().value).toContain('\n- cansaço');
  });

  test('a deeper topic needs more Shift+Tabs to reach the top', () => {
    setup();
    const at = textarea().value.indexOf('- prazos curtos');
    caretAt(at + 1);
    press('Tab', { shiftKey: true });
    // One step: from "    - prazos" to "  - prazos", exactly one level.
    expect(textarea().value).toContain('  - prazos curtos');
    expect(textarea().value).not.toContain('    - prazos curtos');
  });

  test('Tab indents every line of a selection', () => {
    // The bulk case, and the reason this mode exists: a whole branch moves in
    // one gesture, with no per-row work.
    setup();
    const el = textarea();
    const from = el.value.indexOf('- cansaço');
    const to = el.value.indexOf('-_family_missing') === -1
      ? el.value.indexOf('  - mãe apoia')
      : 0;
    caretAt(from, to);
    press('Tab');
    // Both the first and last selected line gained a level.
    expect(textarea().value).toContain('  - cansaço');
    expect(textarea().value).toContain('    - mãe apoia');
  });

  test('Tab leaves the session heading alone', () => {
    // Indenting "# ..." would push the session row out of the heading slot
    // and turn it into a topic.
    setup();
    caretAt(1);
    press('Tab');
    expect(textarea().value.split('\n')[0]).toBe('# 28/09/2026');
  });

  test('Tab is captured, and Escape is the way out', () => {
    // The cost of this mode, stated plainly: Tab no longer moves focus. Escape
    // is the escape hatch, so the field is not a keyboard trap.
    setup();
    const el = textarea();
    const at = el.value.indexOf('- cansaço');
    caretAt(at + 1);
    const prevented = fireEvent.keyDown(el, { key: 'Tab' });
    expect(prevented).toBe(false); // not prevented by the event system default
    // Escape blurs.
    act(() => {
      el.focus();
      fireEvent.keyDown(el, { key: 'Escape' });
    });
    expect(document.activeElement).not.toBe(el);
  });

  test('typing is parsed back into the tree after a pause', async () => {
    setup();
    type('# 28/09/2026\n- Trabalho\n- Sono');
    await new Promise((r) => setTimeout(r, 600));
    expect(updateCount).toBeGreaterThan(0);
    expect((lastRoot as MindMapNode).children.map((c) => c.text)).toEqual([
      'Trabalho',
      'Sono',
    ]);
  });

  test('blur commits immediately rather than waiting out the debounce', async () => {
    // Switching session with a half-parsed tree would carry a stale outline
    // across, so leaving the field settles it at once.
    setup();
    const el = textarea();
    act(() => {
      fireEvent.focus(el);
      fireEvent.change(el, { target: { value: '# X\n- só isto' } });
    });
    expect(updateCount).toBe(0);
    act(() => {
      fireEvent.blur(el);
    });
    expect(updateCount).toBe(1);
    expect((lastRoot as MindMapNode).children.map((c) => c.text)).toEqual(['só isto']);
  });

  test('an edit that changes nothing does not push a history step', () => {
    setup();
    const el = textarea();
    act(() => {
      fireEvent.focus(el);
      // Same content, trailing newline: the tree is already what it says.
      fireEvent.change(el, { target: { value: treeToMarkdown(fixture()) } });
      fireEvent.blur(el);
    });
    expect(updateCount).toBe(0);
  });

  test('pasting markdown restructures the outline, with no special case', () => {
    // The payoff: a block pasted in from anywhere is a branch.
    setup();
    const el = textarea();
    const pasted = '# 28/09/2026\n- Trabalho\n  - cansaço\n- Sono\n  - insônia\n    - acorda às 4';
    act(() => {
      fireEvent.focus(el);
      fireEvent.change(el, { target: { value: pasted } });
      fireEvent.blur(el);
    });
    const root = lastRoot as MindMapNode;
    const sono = root.children.find((c) => c.text === 'Sono');
    expect(sono?.children[0].text).toBe('insônia');
    expect(sono?.children[0].children[0].text).toBe('acorda às 4');
  });

  test('switching sessions replaces the buffer', () => {
    setup();
    expect(textarea().value).toContain('Trabalho');
    // A different session, different root id: the buffer must not keep showing
    // the previous one.
    act(() => {
      cleanup();
    });
    container?.remove();
    const other = node('root2', '01/01/2026', [node('solo', 'Outro cliente')]);
    setup(other);
    expect(textarea().value).toBe('# 01/01/2026\n- Outro cliente');
  });
});

describe('dwell in the markdown buffer', () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  test('resting the caret on a topic lights its balloon up', async () => {
    // The bug: this mode simply had no dwell at all, so the setting did
    // nothing here and the balloons never followed the caret.
    setup(fixture(), true, 1);
    caretOnLine('- cansaço');

    // Navigation arms the dwell, it does not fire it.
    expect(selections).toEqual([]);

    await waitPastDwell(1);
    expect(selections).toEqual([{ nodeId: 't1', reason: 'focus3s' }]);
  });

  test('at 0 the dwell never arms', async () => {
    // 0 means "desligado", and it has to mean it here too rather than falling
    // back to a default the therapist never chose.
    setup(fixture(), true, 0);
    caretOnLine('- cansaço');
    await waitPastDwell(1);
    expect(selections).toEqual([]);
  });

  test('the session heading is not a topic, so nothing lights up', async () => {
    setup(fixture(), true, 1);
    caretOnLine('# 28/09/2026');
    await waitPastDwell(1);
    expect(selections).toEqual([]);
  });

  test('a click highlights at once instead of waiting', () => {
    // A pointer click is a deliberate act on one topic; making it wait three
    // seconds is what makes an app feel broken.
    setup(fixture(), true, 5);
    caretOnLine('- cansaço');
    act(() => {
      fireEvent.click(textarea());
    });
    // The caret move above armed a dwell; the click is what resolves it now.
    expect(selections).toEqual([{ nodeId: 't1', reason: 'click' }]);
  });

  test('moving the caret re-arms on the new topic', async () => {
    setup(fixture(), true, 1);
    caretOnLine('- cansaço');
    caretOnLine('- mãe apoia');
    await waitPastDwell(1);
    expect(selections).toEqual([{ nodeId: 'f1', reason: 'focus3s' }]);
  });
});

describe('moving a topic from the markdown buffer', () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  /** Puts the caret on a topic's line, which is what identifies it. */
  function caretOn(text: string) {
    const el = textarea();
    const at = el.value.indexOf(`- ${text}`);
    if (at === -1) throw new Error(`no line for "${text}"`);
    caretAt(at + 1);
    return at;
  }

  test('Ctrl+Shift+M lifts the topic under the caret', () => {
    setup();
    caretOn('cansaço');
    press('m', { ctrlKey: true, shiftKey: true });
    expect(document.body.textContent).toMatch(/Movendo/);
  });

  test('arrows aim and Enter commits a real move', () => {
    setup();
    caretOn('cansaço');
    press('m', { ctrlKey: true, shiftKey: true });
    // Aim at Família.
    for (let i = 0; i < 3; i++) press('ArrowDown');
    press('Enter');
    expect(updateCount).toBe(1);
    const fam = (lastRoot as MindMapNode).children.find((c) => c.text === 'Família');
    expect(fam?.children.map((c) => c.text)).toEqual(['mãe apoia', 'cansaço']);
  });

  test('the buffer shows the result of a move', () => {
    setup();
    caretOn('cansaço');
    press('m', { ctrlKey: true, shiftKey: true });
    for (let i = 0; i < 3; i++) press('ArrowDown');
    press('Enter');
    const value = textarea().value;
    const famLine = value.indexOf('- Família');
    const cansacoLine = value.indexOf('- cansaço');
    expect(cansacoLine).toBeGreaterThan(famLine);
  });

  test('Escape cancels a lift and the tree is untouched', () => {
    setup();
    caretOn('cansaço');
    press('m', { ctrlKey: true, shiftKey: true });
    press('ArrowDown');
    press('Escape');
    expect(updateCount).toBe(0);
    expect(document.body.textContent).not.toMatch(/Movendo/);
  });

  test('a bare M does not lift — the chord macOS would swallow', () => {
    setup();
    caretOn('cansaço');
    press('m', { metaKey: true });
    expect(document.body.textContent).not.toMatch(/Movendo/);
  });

  test('the move is off when the feature is off', () => {
    setup(fixture(), false);
    caretOn('cansaço');
    press('m', { ctrlKey: true, shiftKey: true });
    expect(updateCount).toBe(0);
    expect(document.body.textContent).not.toMatch(/Movendo/);
  });
});
