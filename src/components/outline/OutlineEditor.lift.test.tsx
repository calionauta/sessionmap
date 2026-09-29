import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, cleanup, screen, act } = await import(
  '@testing-library/react'
);
const React = await import('react');
const { OutlineEditor } = await import('../outline/OutlineEditor');
import type { MindMapNode } from '../../types';

const node = (
  id: string,
  text: string,
  children: MindMapNode[] = [],
  collapsed = false
): MindMapNode => ({ id, text, children, collapsed });

/** root → trabalho[ t1, t2[ t2a ] ] , familia[ f1 ] */
const fixture = (): MindMapNode =>
  node('root', '28/09/2026', [
    node('trab', 'Trabalho', [
      node('t1', 'cansaço'),
      node('t2', 'chefe cobra', [node('t2a', 'prazos curtos')]),
    ]),
    node('fam', 'Família', [node('f1', 'mãe apoia')]),
  ]);

/** Maps a visible row label to its input element. */
function rowFor(text: string): HTMLInputElement {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="text"]')
  );
  const el = inputs.find((i) => i.value === text);
  if (!el) {
    throw new Error(
      `no row "${text}". rows: ${inputs.map((i) => JSON.stringify(i.value)).join(', ')}`
    );
  }
  return el;
}

/** The order rows are painted in, top to bottom. */
function rowOrder(): string[] {
  return Array.from(document.querySelectorAll('input[type="text"]')).map(
    (i) => (i as HTMLInputElement).value
  );
}

let lastRoot: MindMapNode | null = null;
let updateCount = 0;

function setup(enableNodeMove = true) {
  const root = fixture();
  lastRoot = root;
  updateCount = 0;
  render(
    React.createElement(OutlineEditor, {
      root,
      onUpdateRoot: (r: MindMapNode) => {
        lastRoot = r;
        updateCount++;
      },
      onDraftChange: () => {},
      onSelectNode: () => {},
      selectedNodeId: null,
      focusDwellSeconds: 0,
      theme: 'papel' as const,
      enableNodeMove,
    })
  );
}

/** Presses a key on a row's input. */
function press(el: HTMLInputElement, key: string, init: Record<string, unknown> = {}) {
  act(() => {
    fireEvent.keyDown(el, { key, ...init });
  });
}

/**
 * Puts the caret on a row.
 *
 * `.focus()` rather than fireEvent.focus: happy-dom does not move
 * document.activeElement for a synthetic focus event, so every assertion about
 * where the caret is would silently read undefined. Calling the real method is
 * what the browser does, which is the thing under test.
 */
function focusRow(text: string): HTMLInputElement {
  const el = rowFor(text);
  act(() => {
    el.focus();
  });
  return el;
}

describe('the lift, end to end through the real component', () => {
  afterEach(() => cleanup());

  test('renders every row, deep ones included', () => {
    setup();
    expect(rowOrder()).toEqual([
      '28/09/2026',
      'Trabalho',
      'cansaço',
      'chefe cobra',
      'prazos curtos',
      'Família',
      'mãe apoia',
    ]);
  });

  test('Alt+M lifts, the row visually relocates, Enter commits one change', () => {
    setup();
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });

    press(row, 'm', { altKey: true });

    // The cursor starts on the row above — which for "cansaço" is "Trabalho",
    // its own parent, which is excluded, so the first legal target is the
    // session row. Walking down is what a therapist would do to reach
    // "Família": the rows in between that cannot accept the drop are skipped
    // rather than refused.
    press(row, 'ArrowDown'); // t2
    press(row, 'ArrowDown'); // t2a
    press(row, 'ArrowDown'); // fam
    expect(document.querySelector('.border-dashed')?.querySelector('input'))
      ?.toHaveProperty('value', 'Família');

    // The preview is a second root: the subtree is drawn at its new depth, so
    // "cansaço" now sits below "mãe apoia".
    const during = rowOrder();
    expect(during.indexOf('cansaço')).toBeGreaterThan(during.indexOf('mãe apoia'));

    press(row, 'Enter');

    // ONE commit. Two would put two entries in the history stack and let the
    // client window see an intermediate state with the subtree gone.
    expect(updateCount).toBe(1);
    const famChildren = (lastRoot as MindMapNode).children?.[1]?.children ?? [];
    expect(famChildren.map((c) => c.text)).toEqual(['mãe apoia', 'cansaço']);
    // And it is gone from its old parent.
    const trabChildren = (lastRoot as MindMapNode).children?.[0]?.children ?? [];
    expect(trabChildren.map((c) => c.text)).toEqual(['chefe cobra']);
  });

  test('the cursor skips rows that cannot legally take the drop', () => {
    setup();
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });
    // First legal target is the session row: "Trabalho" above it is its own
    // parent, so the cursor does not stop there at all.
    expect(document.querySelector('.border-dashed')?.querySelector('input'))
      ?.toHaveProperty('value', '28/09/2026');
  });

  test('the caret survives the whole lift and lands back on the moved row', () => {
    setup();
    const row = focusRow('cansaço');

    press(row, 'm', { altKey: true });
    // Still the same element after the preview re-render, still focused.
    const active = document.activeElement as HTMLInputElement | null;
    expect(active?.value).toBe('cansaço');

    press(rowFor('cansaço'), 'ArrowDown');
    press(rowFor('cansaço'), 'ArrowUp');
    press(rowFor('cansaço'), 'Enter');

    // After the commit the caret is back on the moved row, with the text it
    // already had — the row kept its id, so this is the same input.
    expect((document.activeElement as HTMLInputElement | null)?.value).toBe('cansaço');
  });

  test('Esc cancels and leaves the tree completely untouched', () => {
    setup();
    const before = JSON.stringify(fixture());
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });
    press(row, 'ArrowDown');
    press(row, 'Escape');

    expect(updateCount).toBe(0);
    expect(JSON.stringify(lastRoot)).toBe(before);
    // Back to the original order.
    expect(rowOrder().indexOf('cansaço')).toBeLessThan(rowOrder().indexOf('Família'));
  });

  test('arrows aim only at legal destinations, skipping the subtree', () => {
    setup();
    const row = rowFor('chefe cobra');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });

    // Walking the whole list must never land on t2 itself or its child t2a.
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const dashed = document.querySelector('.border-dashed');
      if (dashed) {
        const input = dashed.querySelector('input[type="text"]');
        if (input) seen.add((input as HTMLInputElement).value);
      }
      press(rowFor('chefe cobra'), 'ArrowDown');
    }
    expect(seen.has('chefe cobra')).toBe(false);
    expect(seen.has('prazos curtos')).toBe(false);
    expect(seen.has('Trabalho')).toBe(false); // its own parent
  });

  test('the target is a third state, not the caret row and not the client selection', () => {
    setup();
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });

    const dashed = document.querySelector('.border-dashed');
    expect(dashed).toBeTruthy();
    // The caret is still on the lifted row, which is NOT the dashed one.
    expect(dashed?.contains(rowFor('cansaço'))).toBe(false);
  });

  test('typing during a lift cannot edit the row in the air', () => {
    setup();
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });

    // readOnly closes the paths that do not go through the key handler.
    expect(rowFor('cansaço').readOnly).toBe(true);
    act(() => {
      fireEvent.change(rowFor('cansaço'), { target: { value: 'digitado' } });
    });
    expect(rowFor('cansaço').value).toBe('cansaço');
  });

  test('nothing is broadcast while the preview is up', () => {
    setup();
    let selects = 0;
    const root = fixture();
    render(
      React.createElement(OutlineEditor, {
        root,
        onUpdateRoot: () => {},
        onDraftChange: () => {},
        // The client window's highlight must not chase a destination that Esc
        // may still cancel.
        onSelectNode: () => {
          selects++;
        },
        selectedNodeId: null,
        focusDwellSeconds: 0,
        theme: 'papel' as const,
        enableNodeMove: true,
      })
    );
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });
    press(row, 'ArrowDown');
    press(row, 'ArrowUp');

    expect(selects).toBe(0);
    expect(updateCount).toBe(0);
  });

  test('losing focus strands nothing — the lift is dropped', () => {
    setup();
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });
    expect(document.querySelector('.border-dashed')).toBeTruthy();

    // Tabbing out is the case a held modifier could not survive: the keyup
    // never arrives, and the arrows stop being deliverable.
    const other = document.createElement('button');
    document.body.appendChild(other);
    act(() => {
      other.focus();
      fireEvent.focusOut(row, { relatedTarget: other });
    });

    expect(document.querySelector('.border-dashed')).toBeFalsy();
    expect(updateCount).toBe(0);
  });

  test('the session row cannot be lifted, and says why', () => {
    setup();
    const root = rowFor('28/09/2026');
    act(() => {
      fireEvent.focus(root);
    });
    press(root, 'm', { altKey: true });
    expect(updateCount).toBe(0);
    expect(document.body.textContent).toContain('não pode ser movida');
  });

  test('with the feature off, Alt+M does nothing at all', () => {
    setup(false);
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });
    expect(updateCount).toBe(0);
    expect(document.querySelector('.border-dashed')).toBeFalsy();
  });

  test('a move into a collapsed parent opens it, so the node cannot vanish', () => {
    const root = node('root', 'sessão', [
      node('fam', 'Família', [node('f1', 'mãe apoia')], true),
      node('t1', 'cansaço'),
    ]);
    lastRoot = root;
    updateCount = 0;
    render(
      React.createElement(OutlineEditor, {
        root,
        onUpdateRoot: (r: MindMapNode) => {
          lastRoot = r;
          updateCount++;
        },
        onDraftChange: () => {},
        onSelectNode: () => {},
        selectedNodeId: null,
        focusDwellSeconds: 0,
        theme: 'papel' as const,
        enableNodeMove: true,
      })
    );
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });
    press(row, 'ArrowUp'); // onto "Família"
    press(row, 'Enter');

    expect(updateCount).toBe(1);
    const fam = (lastRoot as MindMapNode).children?.[0];
    expect(fam?.collapsed).toBe(false);
    expect(fam?.children?.map((c) => c.text)).toEqual(['mãe apoia', 'cansaço']);
  });

  test('a move that changes the side on the map says so', () => {
    setup();
    const row = rowFor('mãe apoia');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });
    // Walk up to Trabalho: index 0 vs the current branch at 1, so the balloon
    // changes side on the client's screen.
    press(row, 'ArrowUp');
    press(row, 'ArrowUp');
    press(row, 'ArrowUp');
    press(row, 'Enter');

    expect(updateCount).toBe(1);
    expect(document.body.textContent).toMatch(/muda de lado/);
  });

  test('a plain move confirms without crying wolf about the map', () => {
    setup();
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { altKey: true });
    press(row, 'Enter');
    expect(updateCount).toBe(1);
    expect(document.body.textContent).toContain('movido');
    expect(document.body.textContent).not.toMatch(/muda de lado/);
  });
});
