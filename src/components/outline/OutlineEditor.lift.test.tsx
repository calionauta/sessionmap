import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, cleanup, screen, act } = await import(
  '@testing-library/react'
);
const React = await import('react');
const { OutlineEditor } = await import('../outline/OutlineEditor');
const { isLiftChord } = await import('../../utils/tree');
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

/**
 * The container the CURRENT render lives in.
 *
 * Scoped deliberately: render() without a container appends to document.body,
 * and any earlier outline that was not unmounted leaves its rows and buttons
 * in the document. A document-wide querySelector then finds the PREVIOUS
 * test's element, whose handler is bound to an unmounted instance and updates
 * nothing — which reads exactly like a broken feature. Scoping every lookup to
 * the latest container makes that impossible.
 */
let currentContainer: HTMLElement | null = null;

/** Maps a visible row label to its input element, in the current render. */
function rowFor(text: string): HTMLInputElement {
  const scope = currentContainer ?? document;
  const inputs = Array.from(
    scope.querySelectorAll<HTMLInputElement>('input[type="text"]')
  );
  const el = inputs.find((i) => i.value === text);
  if (!el) {
    throw new Error(
      `no row "${text}". rows: ${inputs.map((i) => JSON.stringify(i.value)).join(', ')}`
    );
  }
  return el;
}

/** The dashed drop-target row, if the current render has one. */
function liftTargetRow(): Element | null {
  return (currentContainer ?? document).querySelector('.border-dashed');
}

/** The order rows are painted in, top to bottom. */
function rowOrder(): string[] {
  const scope = currentContainer ?? document;
  return Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="text"]')).map(
    (i) => i.value
  );
}

let lastRoot: MindMapNode | null = null;
let updateCount = 0;

function setup(enableNodeMove = true) {
  const root = fixture();
  lastRoot = root;
  updateCount = 0;
  // A fresh container per render, tracked so every lookup below is scoped to
  // the live outline. See the note on currentContainer.
  const container = document.createElement('div');
  document.body.appendChild(container);
  currentContainer = container;
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
    }),
    { container }
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
  // cleanup() unmounts the React tree. The container is ours, so it is removed
  // too: leaving it behind would keep the previous outline's rows in the
  // document for any lookup that missed the scoping above.
  afterEach(() => {
    cleanup();
    currentContainer?.remove();
    currentContainer = null;
  });

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

  test('Ctrl+Shift+M lifts, the row visually relocates, Enter commits one change', () => {
    setup();
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });

    press(row, 'm', { ctrlKey: true, shiftKey: true });

    // The cursor starts on the row above — which for "cansaço" is "Trabalho",
    // its own parent, which is excluded, so the first legal target is the
    // session row. Walking down is what a therapist would do to reach
    // "Família": the rows in between that cannot accept the drop are skipped
    // rather than refused.
    press(row, 'ArrowDown'); // t2
    press(row, 'ArrowDown'); // t2a
    press(row, 'ArrowDown'); // fam
    expect(liftTargetRow()?.querySelector('input'))
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
    press(row, 'm', { ctrlKey: true, shiftKey: true });
    // First legal target is the session row: "Trabalho" above it is its own
    // parent, so the cursor does not stop there at all.
    expect(liftTargetRow()?.querySelector('input'))
      ?.toHaveProperty('value', '28/09/2026');
  });

  test('the caret survives the whole lift and lands back on the moved row', () => {
    setup();
    const row = focusRow('cansaço');

    press(row, 'm', { ctrlKey: true, shiftKey: true });
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
    press(row, 'm', { ctrlKey: true, shiftKey: true });
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
    press(row, 'm', { ctrlKey: true, shiftKey: true });

    // Walking the whole list must never land on t2 itself or its child t2a.
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const dashed = liftTargetRow();
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
    press(row, 'm', { ctrlKey: true, shiftKey: true });

    const dashed = liftTargetRow();
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
    press(row, 'm', { ctrlKey: true, shiftKey: true });

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
    press(row, 'm', { ctrlKey: true, shiftKey: true });
    press(row, 'ArrowDown');
    press(row, 'ArrowUp');

    expect(selects).toBe(0);
    expect(updateCount).toBe(0);
  });

  test('losing focus strands nothing — the lift is dropped', () => {
    setup();
    const row = focusRow('cansaço');
    press(row, 'm', { ctrlKey: true, shiftKey: true });
    expect(liftTargetRow()).toBeTruthy();

    // Tabbing to a control outside the pane: the row can no longer be driven,
    // so the arrows would do nothing and there would be no visible way out.
    const other = document.createElement('button');
    document.body.appendChild(other);
    act(() => {
      other.focus();
      fireEvent.focusOut(row, { relatedTarget: other });
    });

    expect(liftTargetRow()).toBeFalsy();
    expect(updateCount).toBe(0);
  });

  test('alt-tab drops the lift, which is the case a held modifier cannot survive', () => {
    setup();
    const row = focusRow('cansaço');
    press(row, 'm', { ctrlKey: true, shiftKey: true });
    expect(liftTargetRow()).toBeTruthy();

    // Focus left the document entirely: relatedTarget is null, and the keyup
    // that would end a hold never arrives.
    act(() => {
      fireEvent.blur(window);
    });

    expect(liftTargetRow()).toBeFalsy();
    expect(updateCount).toBe(0);
  });

  test('the session row cannot be lifted, and says why', () => {
    setup();
    const root = rowFor('28/09/2026');
    act(() => {
      fireEvent.focus(root);
    });
    press(root, 'm', { ctrlKey: true, shiftKey: true });
    expect(updateCount).toBe(0);
    expect(document.body.textContent).toContain('não pode ser movida');
  });

  /**
   * macOS claims single-modifier chords for the window manager, and the
   * interception happens before the page ever receives the keydown — so a
   * binding like Option+M cannot be rescued with preventDefault, it just
   * minimizes the window. Shift is therefore required, and both the Ctrl and
   * the Cmd form are accepted so neither platform is left out.
   */
  test('the lift chord requires Shift, in the Ctrl, Cmd and Alt forms', () => {
    const chord = (o: Record<string, unknown>) =>
      isLiftChord({
        key: 'm',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...o,
      });

    expect(chord({ ctrlKey: true, shiftKey: true })).toBe(true);
    expect(chord({ metaKey: true, shiftKey: true })).toBe(true);
    expect(chord({ altKey: true, shiftKey: true })).toBe(true);

    // The chords macOS owns outright, and the bare letter.
    expect(chord({ metaKey: true })).toBe(false);
    expect(chord({ altKey: true })).toBe(false);
    expect(chord({ ctrlKey: true })).toBe(false);
    expect(chord({})).toBe(false);
  });

  test('a bare Option+M does not lift — the chord macOS swallows', () => {
    setup();
    const row = focusRow('cansaço');
    press(row, 'm', { altKey: true });
    expect(updateCount).toBe(0);
    expect(liftTargetRow()).toBeFalsy();
  });

  test('Cmd+Shift+M lifts too, so Mac is not left out', () => {
    setup();
    const row = focusRow('cansaço');
    press(row, 'm', { metaKey: true, shiftKey: true });
    expect(liftTargetRow()).toBeTruthy();
  });

  test('the Mover button lifts without any chord at all', () => {
    setup();
    const button = currentContainer!.querySelector<HTMLButtonElement>(
      'button[aria-label^="Mover cansaço"]'
    );
    expect(button).toBeTruthy();
    act(() => {
      fireEvent.click(button!);
    });
    expect(liftTargetRow()).toBeTruthy();
    expect(updateCount).toBe(0);
  });

  test('a lift started from the Mover button is not cancelled by the focus it moves', () => {
    // The button's onMouseDown preventDefault is meant to keep the caret in
    // the input, but the lift must not depend on that to work: if a browser
    // moves focus anyway, the focusout guard used to cancel the lift the
    // instant the button started it, which made the button do nothing at all —
    // the exact failure the button exists to avoid. The guard now only fires
    // when focus leaves the PANE, and the button is inside it.
    setup();
    const button = currentContainer!.querySelector<HTMLButtonElement>(
      'button[aria-label^="Mover cansaço"]'
    )!;
    act(() => {
      button.focus();
      fireEvent.focusOut(button, { relatedTarget: button });
      fireEvent.click(button);
    });
    expect(liftTargetRow()).toBeTruthy();
  });

  test('the Mover button is absent while the feature is off', () => {
    setup(false);
    expect(currentContainer!.querySelector('button[aria-label^="Mover"]')).toBeFalsy();
  });

  test('with the feature off, the chord does nothing at all', () => {
    setup(false);
    const row = rowFor('cansaço');
    act(() => {
      fireEvent.focus(row);
    });
    press(row, 'm', { ctrlKey: true, shiftKey: true });
    expect(updateCount).toBe(0);
    expect(liftTargetRow()).toBeFalsy();
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
    press(row, 'm', { ctrlKey: true, shiftKey: true });
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
    press(row, 'm', { ctrlKey: true, shiftKey: true });
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
    press(row, 'm', { ctrlKey: true, shiftKey: true });
    press(row, 'Enter');
    expect(updateCount).toBe(1);
    expect(document.body.textContent).toContain('movido');
    expect(document.body.textContent).not.toMatch(/muda de lado/);
  });
});
