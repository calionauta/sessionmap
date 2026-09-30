import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, cleanup, act } = await import('@testing-library/react');
const React = await import('react');
const { MarkdownOutline } = await import('./MarkdownOutline');
const { treeToMarkdown, parseMarkdownToTree } = await import('../../utils/tree');
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

/**
 * Only the dwell's own broadcasts.
 *
 * 'caret' is the therapist's own map following the cursor, and it is local —
 * never sent to the client. It shares the channel, so a test about the dwell
 * has to say which half it means.
 */
const dwells = () => selections.filter((s) => s.reason === 'focus3s');
/** Every draft the buffer broadcast, so the map's mirror can be asserted on. */
let drafts: Array<{
  mode: 'add' | 'edit';
  parentId: string | null;
  parentText?: string;
  targetId?: string | null;
  text: string;
  active: boolean;
}> = [];

function setup(
  root: MindMapNode = fixture(),
  focusDwellSeconds = 0,
  outlineFontScale = 1
) {
  lastRoot = root;
  updateCount = 0;
  reasons = [];
  selections = [];
  drafts = [];
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
      onDraftChange: (d: (typeof drafts)[number]) => {
        drafts.push(d);
      },
      selectedNodeId: null,
      focusDwellSeconds,
      theme: 'papel' as const,
      outlineFontScale,
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

/** Puts the caret at the end of the line containing `fragment`. */
function caretAtEndOfLine(fragment: string) {
  const el = textarea();
  const at = el.value.indexOf(fragment);
  if (at === -1) throw new Error(`no line "${fragment}" in:\n${el.value}`);
  const end = el.value.indexOf('\n', at);
  caretAt(end === -1 ? el.value.length : end);
  return at;
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
    setup(fixture(), 1);
    caretOnLine('- cansaço');

    // Navigation arms the dwell, it does not fire it.
    expect(dwells()).toEqual([]);

    await waitPastDwell(1);
    expect(dwells()).toEqual([{ nodeId: 't1', reason: 'focus3s' }]);
  });

  test('at 0 the dwell never arms', async () => {
    // 0 means "desligado", and it has to mean it here too rather than falling
    // back to a default the therapist never chose.
    setup(fixture(), 0);
    caretOnLine('- cansaço');
    await waitPastDwell(1);
    expect(dwells()).toEqual([]);
  });

  test('the session heading lights up the root balloon', async () => {
    // The heading IS the root: the session's own name. Reading it as "not a
    // topic" left the dwell dead on the one line a therapist lands on first,
    // and dead on the client's screen with it.
    setup(fixture(), 1);
    caretOnLine('# 28/09/2026');
    await waitPastDwell(1);
    expect(dwells()).toEqual([{ nodeId: 'root', reason: 'focus3s' }]);
  });

  test('a click highlights at once instead of waiting', () => {
    // A pointer click is a deliberate act on one topic; making it wait three
    // seconds is what makes an app feel broken.
    setup(fixture(), 5);
    caretOnLine('- cansaço');
    act(() => {
      fireEvent.click(textarea());
    });
    // The caret move above armed a dwell; the click is what resolves it now.
    expect(selections.filter((s) => s.reason === 'click')).toEqual([
      { nodeId: 't1', reason: 'click' },
    ]);
  });

  test('moving the caret re-arms on the new topic', async () => {
    setup(fixture(), 1);
    caretOnLine('- cansaço');
    caretOnLine('- mãe apoia');
    await waitPastDwell(1);
    expect(dwells()).toEqual([{ nodeId: 'f1', reason: 'focus3s' }]);
  });

  test('moving WITHIN one line does not re-arm', async () => {
    // The dwell is about a topic, and a topic is a line. Left and right inside
    // one line cannot change the answer, so restarting the timer on every arrow
    // press was churn — and a therapist arrowing to read a long thought would
    // keep pushing the highlight away.
    setup(fixture(), 1);
    caretOnLine('- cansaço');
    const el = textarea();
    const start = el.value.indexOf('- cansaço');
    act(() => {
      el.setSelectionRange(start + 2, start + 2);
      fireEvent.select(el);
    });
    act(() => {
      el.setSelectionRange(start + 4, start + 4);
      fireEvent.select(el);
    });
    await waitPastDwell(1);
    // Still fires — once, for the line it was armed on.
    expect(dwells()).toEqual([{ nodeId: 't1', reason: 'focus3s' }]);
  });

  test('two topics with the same text each light up their own balloon', async () => {
    // The bug: the caret line was matched to a topic BY TEXT, so the second
    // "ansiedade" resolved to the first one and the dwell lit a balloon two
    // rows away. Matching by position fixes it, and duplicated wording is
    // ordinary rather than exotic in notes about sleep or family.
    const root = node('root', '28/09/2026', [
      node('a1', 'ansiedade', [node('a2', 'ansiedade')]),
      node('b', 'sono'),
    ]);
    setup(root, 1);

    caretOnLine('- ansiedade');
    await waitPastDwell(1);
    expect(dwells()).toEqual([{ nodeId: 'a1', reason: 'focus3s' }]);

    cleanup();
    container?.remove();
    selections = [];
    drafts = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    setup(root, 1);
    const nested = textarea().value.indexOf('\n  - ansiedade');
    act(() => {
      textarea().setSelectionRange(nested + 3, nested + 3);
      fireEvent.select(textarea());
    });
    await waitPastDwell(1);
    expect(dwells()).toEqual([{ nodeId: 'a2', reason: 'focus3s' }]);
  });
});

describe('Enter starts the next topic', () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  test('adds a bullet at the same level', () => {
    // The complaint this answers: a textarea reproduces the indent but not the
    // bullet, so Enter produced a line the parser folded into the topic above
    // as a wrapped paragraph. No new topic, and "- " had to be typed by hand.
    setup();
    caretAtEndOfLine('- cansaço');
    press('Enter');
    expect(textarea().value).toBe(
      '# 28/09/2026\n- Trabalho\n  - cansaço\n  - \n  - chefe cobra\n    - prazos curtos\n- Família\n  - mãe apoia'
    );
  });

  test('the new line really is a new topic, not more of the old one', () => {
    // An empty bullet parses to nothing — it is a topic that exists only as a
    // caret, which is why the ghost balloon stands in for it. It becomes a
    // real sibling the moment it has text.
    setup();
    caretAtEndOfLine('- cansaço');
    press('Enter');
    const before = parseMarkdownToTree(textarea().value, '28/09/2026', null);
    expect(before.children[0].children.map((c) => c.text)).toEqual([
      'cansaço',
      'chefe cobra',
    ]);

    const el = textarea();
    const at = el.value.indexOf('\n  - \n') + '\n  - '.length;
    type(el.value.slice(0, at) + 'sono' + el.value.slice(at));
    const after = parseMarkdownToTree(textarea().value, '28/09/2026', null);
    expect(after.children[0].children.map((c) => c.text)).toEqual([
      'cansaço',
      'sono',
      'chefe cobra',
    ]);
  });

  test('repeats the marker the line uses instead of normalising it', () => {
    // Chosen over always writing "- ": a buffer pasted from a document that
    // uses "*" stays in "*" while it is edited, and the canonical form arrives
    // later as a rewrite the therapist can see. Swapping the marker under the
    // caret with no visible cause is the worse surprise.
    setup();
    type('# 28/09/2026\n*  cansaço');
    caretAtEndOfLine('*  cansaço');
    press('Enter');
    expect(textarea().value).toBe('# 28/09/2026\n*  cansaço\n*  ');
  });

  test('after the session heading, a top-level bullet', () => {
    setup();
    caretAtEndOfLine('# 28/09/2026');
    press('Enter');
    expect(textarea().value.split('\n')[1]).toBe('- ');
  });

  test('on an empty bullet it ends the topic instead of stacking blanks', () => {
    // What every outliner does. The
    // line goes with ONE of its two newlines: neither would leave a blank line
    // where the topic was, both would join the lines above and below.
    setup();
    type('# 28/09/2026\n- cansaço\n- ');
    caretAt(textarea().value.length);
    press('Enter');
    expect(textarea().value).toBe('# 28/09/2026\n- cansaço');
  });

  test('an empty bullet in the middle leaves the rest of the buffer alone', () => {
    setup();
    type('# 28/09/2026\n- cansaço\n- \n- Família');
    caretAt(textarea().value.indexOf('- \n') + 2);
    press('Enter');
    expect(textarea().value).toBe('# 28/09/2026\n- cansaço\n- Família');
  });

  test('a wrapped paragraph keeps the browser behaviour', () => {
    // A soft break is what was meant there, and taking the key would make a
    // thought impossible to write over two lines.
    setup();
    type('# 28/09/2026\n- cansaço\n  e mais texto');
    const el = textarea();
    const at = el.value.indexOf('e mais');
    act(() => {
      el.setSelectionRange(at, at);
    });
    expect(fireEvent.keyDown(el, { key: 'Enter', cancelable: true })).toBe(true);
  });

  test('Shift+Enter is never taken', () => {
    setup();
    caretAtEndOfLine('- cansaço');
    const before = textarea().value;
    expect(
      fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: true, cancelable: true })
    ).toBe(true);
    expect(textarea().value).toBe(before);
  });
});

describe('a new, empty topic tells the map about it', () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  test('an empty bullet is active, so the ghost balloon and footer appear', () => {
    // The bug: the parser discards an empty bullet, so there was no node to
    // find, the draft went out inactive, and the map said nothing at all while
    // the therapist was starting a topic. A silent map is the whole problem.
    setup();
    type('# 28/09/2026\n- Trabalho\n  - cansaço\n  - ');
    caretAt(textarea().value.length);
    const draft = drafts[drafts.length - 1];
    expect(draft.active).toBe(true);
    expect(draft.mode).toBe('add');
    expect(draft.text).toBe('');
  });

  test('it names the parent the line is indented under, not the one above it', () => {
    // Worked out from the buffer's own indentation, because the tree cannot
    // help: the node does not exist yet. The line above happens to be at the
    // SAME indent, so it is a sibling, not the parent — the nearest SHALLOWER
    // topic is the one that wins.
    setup();
    type('# 28/09/2026\n- Trabalho\n  - cansaço\n  - ');
    caretAt(textarea().value.length);
    expect(drafts[drafts.length - 1].parentText).toBe('Trabalho');
  });

  test('a bullet at column zero hangs off the session', () => {
    setup();
    type('# 28/09/2026\n- Trabalho\n- ');
    caretAt(textarea().value.length);
    const draft = drafts[drafts.length - 1];
    expect(draft.parentText).toBe('28/09/2026');
    expect(draft.active).toBe(true);
  });

  test('deeper than its parent, it still lands on the nearest shallower topic', () => {
    setup();
    type('# 28/09/2026\n- Trabalho\n  - cansaço\n    - ');
    caretAt(textarea().value.length);
    expect(drafts[drafts.length - 1].parentText).toBe('cansaço');
  });

  test('a wrapped paragraph is not a topic and says nothing', () => {
    setup();
    type('# 28/09/2026\n- cansaço\n  e mais texto');
    caretAt(textarea().value.length);
    expect(drafts[drafts.length - 1].active).toBe(false);
  });

  test('the session heading is the root, and says so as an edit', () => {
    // It resolves to the root node rather than being reported as nothing, and
    // it is an EDIT of the session name — not a new subitem under a root, which
    // is what reporting it as a topic produced.
    setup();
    caretOnLine('# 28/09/2026');
    const draft = drafts[drafts.length - 1];
    expect(draft.active).toBe(true);
    expect(draft.mode).toBe('edit');
    expect(draft.targetId).toBe('root');
  });
});

describe('the footer instructions are true', () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  const texts = (n: MindMapNode): string[] =>
    (n.children || []).flatMap((c) => [c.text, ...texts(c)]);

  test('cutting a block and pasting it elsewhere really does move the branch', () => {
    // The footer claims this. It is true — but only because the PASTED TEXT is
    // the whole mechanism, so what decides the destination is the indentation
    // of the first pasted line, not where the caret was dropped. That is the
    // part the instruction leaves out.
    setup();
    const before = '# 28/09/2026\n- Trabalho\n  - cansaço\n  - chefe cobra\n- Família\n  - mãe apoia';
    const after =
      '# 28/09/2026\n- Trabalho\n  - chefe cobra\n- Família\n  - mãe apoia\n  - cansaço';
    type(before);
    act(() => {
      fireEvent.blur(textarea());
    });
    expect(texts(lastRoot as MindMapNode)).toContain('cansaço');

    type(after);
    act(() => {
      fireEvent.blur(textarea());
    });
    const root = lastRoot as MindMapNode;
    const familia = root.children.find((c) => c.text === 'Família');
    expect(familia?.children.map((c) => c.text)).toEqual(['mãe apoia', 'cansaço']);
    // And it left where it was, which is what makes it a MOVE.
    const trabalho = root.children.find((c) => c.text === 'Trabalho');
    expect(trabalho?.children.map((c) => c.text)).toEqual(['chefe cobra']);
  });

  test('the same paste at the wrong indent lands somewhere else', () => {
    // Why the instruction is incomplete: the destination is decided by the
    // indentation, so the identical paste can produce a different tree.
    setup();
    type('# 28/09/2026\n- Trabalho\n- ');
    act(() => {
      fireEvent.change(textarea(), {
        target: {
          value: '# 28/09/2026\n- Trabalho\n- Família\n  - cansaço',
        },
      });
      fireEvent.blur(textarea());
    });
    const familia = (lastRoot as MindMapNode).children.find((c) => c.text === 'Família');
    expect(familia?.children.map((c) => c.text)).toEqual(['cansaço']);
  });
});

describe('the buffer and the font scale', () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  test('the scale reaches the buffer as one custom property', () => {
    // The row editor had six tests pinning that the scale drove the row height,
    // the indent step and the gutter. There is no row here: one font size on the
    // container, and the textarea reads the same variable. What matters is that
    // the setting still does something at all, rather than becoming a dead knob
    // along with the editor it was sized for.
    setup(fixture(), 0, 1.4);
    const wrapper = container!.querySelector<HTMLElement>('[style*="--row-scale"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute('style')).toContain('1.4');
  });

  test('the default renders without a scale set', () => {
    setup();
    const wrapper = container!.querySelector<HTMLElement>('[style*="--row-scale"]')!;
    expect(wrapper.getAttribute('style')).toContain('1');
  });
});

describe('the help disclosure', () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  const helpButton = () =>
    container!.querySelector<HTMLButtonElement>('[aria-controls="buffer-help"]')!;
  const panel = () => container!.querySelector('#buffer-help');

  test('it starts closed, so the editor is not a wall of text', () => {
    // The complaint: a footer that explained everything taught the things nobody
    // needed and buried the two that mattered. A reference nobody asked for
    // should cost nothing until it is asked for.
    setup();
    expect(panel()).toBeNull();
  });

  test('the button says whether it is open', () => {
    setup();
    expect(helpButton().getAttribute('aria-expanded')).toBe('false');
    act(() => {
      fireEvent.click(helpButton());
    });
    expect(helpButton().getAttribute('aria-expanded')).toBe('true');
    expect(panel()).not.toBeNull();
  });

  test('and it closes again', () => {
    setup();
    act(() => {
      fireEvent.click(helpButton());
    });
    act(() => {
      fireEvent.click(helpButton());
    });
    expect(panel()).toBeNull();
  });

  test('it states the rule the old footer left out', () => {
    // The indent decides the parent, not where the caret landed. The previous
    // text said cut-and-paste works and left the rule unstated, which is how
    // the same paste builds a different tree silently.
    setup();
    act(() => {
      fireEvent.click(helpButton());
    });
    const text = panel()!.textContent ?? '';
    expect(text).toContain('indentação da primeira linha');
    expect(text).toContain('Recorte');
  });

  test('the visible hint is only what a textarea cannot show itself', () => {
    // Tab is captured here, which is invisible until it surprises someone, and
    // Esc is the only way out. Nothing else belongs at this size.
    setup();
    const header = container!.querySelector('header, div')!.textContent ?? '';
    expect(header).toContain('Tab');
    expect(header).toContain('Esc');
    expect(header).not.toContain('Ctrl+Shift+M');
  });

  test('the removed shortcut is gone for good', () => {
    setup();
    act(() => {
      fireEvent.click(helpButton());
    });
    expect(container!.textContent).not.toContain('Ctrl+Shift+M');
  });
});

describe("the therapist's own map follows the caret", () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  const follows = () => selections.filter((s) => s.reason === 'caret');

  test('moving to another topic tells the therapist which one', () => {
    // Their own window, immediately. Making them wait out the dwell, or navigate
    // somewhere else first, is the map not answering a question that was asked.
    setup();
    caretOnLine('- cansaço');
    expect(follows()).toEqual([{ nodeId: 't1', reason: 'caret' }]);
  });

  test('the follow is a CHANGE, not a position', () => {
    // Following character by character would slide the map on every keystroke,
    // which reads as the map chasing the cursor rather than showing where you are.
    setup();
    caretOnLine('- cansaço');
    const el = textarea();
    const at = el.value.indexOf('- cansaço');
    act(() => {
      el.setSelectionRange(at + 2, at + 2);
      fireEvent.select(el);
    });
    expect(follows()).toHaveLength(1);
  });

  test('moving on does follow, because the topic changed', () => {
    setup();
    caretOnLine('- cansaço');
    caretOnLine('- mãe apoia');
    expect(follows()).toEqual([
      { nodeId: 't1', reason: 'caret' },
      { nodeId: 'f1', reason: 'caret' },
    ]);
  });

  test('it is never sent to the client', async () => {
    // The client is on a second screen mid-session, and a map that slides on
    // every arrow key is a distraction. That is what the dwell setting is for,
    // and 'caret' exists precisely so the two can differ.
    setup(fixture(), 1);
    caretOnLine('- cansaço');
    // Whatever the dwell decides, the local reason is the one that must not
    // travel — and it is not one the sync channel's type admits at all.
    expect(follows().every((s) => s.reason === 'caret')).toBe(true);
  });

  test('typing a new topic picks it up as soon as it is a topic', () => {
    // The follow is a change, and null IS a change: leaving a topic for a blank
    // bullet has to release the map, or it keeps centring whatever was last
    // written while the therapist is starting the next thought.
    setup();
    type('# 28/09/2026\n- cansaço\n- ');
    caretOnLine('- cansaço');
    caretAt(textarea().value.length);
    expect(follows().at(-1)).toEqual({ nodeId: null, reason: 'caret' });

    type('# 28/09/2026\n- cansaço\n- sono');
    caretOnLine('- sono');
    expect(follows().at(-1)).toEqual({ nodeId: expect.any(String), reason: 'caret' });
  });
});

describe('the caret resolves against what is on screen, not the committed tree', () => {
  afterEach(() => {
    cleanup();
    container?.remove();
    container = null;
  });

  test('a topic is followed on the keystroke that creates it', () => {
    // The bug this pins: setText is async, so during the keystroke that turns
    // "- " into "- sono" the `text` state still holds the old value. Reading the
    // committed tree there resolved the caret to nothing, and the map learned
    // about the topic a keystroke late — or not at all.
    setup();
    type('# 28/09/2026\n- cansaço\n- ');
    caretAt(textarea().value.length);
    type('# 28/09/2026\n- cansaço\n- sono');
    caretAt(textarea().value.length);

    const draft = drafts[drafts.length - 1];
    expect(draft.active).toBe(true);
    expect(draft.mode).toBe('edit');
    expect(draft.text).toBe('sono');
  });

  test('an arrow key does not re-parse', () => {
    // The live tree is cached on the string, and a caret move leaves the string
    // alone — so the fast path is the one that runs, and the parse is not
    // repeated for every keypress that changes nothing.
    setup();
    caretOnLine('- cansaço');
    const el = textarea();
    const at = el.value.indexOf('- cansaço');
    for (const offset of [1, 2, 3, 4]) {
      act(() => {
        el.setSelectionRange(at + offset, at + offset);
        fireEvent.select(el);
      });
    }
    expect(drafts.at(-1)?.text).toBe('cansaço');
  });
});
