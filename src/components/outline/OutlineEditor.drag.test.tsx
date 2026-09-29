import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, cleanup, act } = await import('@testing-library/react');
const React = await import('react');
const { OutlineEditor } = await import('../outline/OutlineEditor');
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

let currentContainer: HTMLElement | null = null;
let lastRoot: MindMapNode | null = null;
let updateCount = 0;

function setup() {
  lastRoot = fixture();
  updateCount = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  currentContainer = container;
  render(
    React.createElement(OutlineEditor, {
      root: lastRoot,
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
      outlineFontScale: 1,
    }),
    { container }
  );
  return container;
}

function moveHandleFor(text: string): HTMLElement {
  const btn = currentContainer!.querySelector<HTMLElement>(
    `button[aria-label^="Mover ${text}"]`
  );
  if (!btn) throw new Error(`no Mover handle for "${text}"`);
  return btn;
}

function rowFor(text: string): HTMLElement {
  const input = Array.from(
    currentContainer!.querySelectorAll<HTMLInputElement>('input[type="text"]')
  ).find((i) => i.value === text);
  if (!input) throw new Error(`no row "${text}"`);
  return input.closest('.group') as HTMLElement;
}

/** Puts the caret on a row, the way a therapist would before using a key. */
function focusRow(text: string): HTMLInputElement {
  const el = rowFor(text).querySelector('input') as HTMLInputElement;
  act(() => {
    el.focus();
  });
  return el;
}

/** Presses a key on a row's input. */
function press(el: HTMLInputElement, key: string, init: Record<string, unknown> = {}) {
  act(() => {
    fireEvent.keyDown(el, { key, ...init });
  });
}

/**
 * happy-dom reports 0x0 for every rect, so the drag has no geometry to work
 * with. Patched on the ELEMENT PROTOTYPE, not on the instances: a pointerdown
 * re-renders the outline, React replaces the row nodes, and any rect assigned to
 * an instance is lost on the very first move — which is exactly the frame where
 * the drag needs it. A prototype patch survives re-renders, and its identity
 * comes from the row's position among its siblings rather than from the
 * instance, so new nodes get correct geometry too.
 *
 * Scoped to the CURRENT container rather than the whole body: a previous test's
 * container is still in the document until afterEach, and indexing across both
 * would give every row a position two outlines out of date.
 */
/** The prototype the geometry patch is installed on. */
let rowsProto: object | null = null;

function rowsProtoProbe(): HTMLElement {
  return currentContainer!.querySelector<HTMLElement>('.group')!;
}

function giveRowsGeometry(): HTMLElement[] {
  const rows = Array.from(currentContainer!.querySelectorAll<HTMLElement>('.group'));
  const ROW_H = 50;
  const proto = Object.getPrototypeOf(rows[0]) as object;
  rowsProto = proto;
  (proto as any).getBoundingClientRect = function (this: Element) {
    const all = Array.from(
      currentContainer!.querySelectorAll<HTMLElement>('.group')
    );
    const i = all.indexOf(this as HTMLElement);
    // Keyed by CURRENT DOM position, recomputed on every call. A lift reorders
    // the rows as the destination changes, so a geometry captured once is
    // stale by the next pointermove — and the hit-test then names a row that
    // has since moved.
    const top = Math.max(0, i) * ROW_H;
    return {
      top,
      bottom: top + ROW_H,
      left: 0,
      right: 300,
      height: ROW_H,
      width: 300,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return rows;
}

/** Pointer down on a handle, a real move to a row, then release. */
function drag(text: string, ontoRow: string) {
  giveRowsGeometry();
  const handle = moveHandleFor(text);
  // Resolve the destination AFTER the prototype patch, and read its geometry
  // then. Reading it earlier gives the pre-patch 0x0, so the pointer moves to
  // y=10 and lands on the first row instead of the intended one.
  const targetRow = rowFor(ontoRow);
  const to = targetRow.getBoundingClientRect();
  const from = { top: 20 };

  act(() => {
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: from.top });
  });
  act(() => {
    fireEvent.pointerMove(window, { clientX: 10, clientY: from.top + 15 });
  });
  /* The pointer is placed at the TOP EDGE of the target row, not its middle.
   * The preview reorders rows as the destination changes, so aiming at the
   * centre of a row is ambiguous the moment the preview moves it: the row the
   * pointer is over is not the row the hit-test names. An edge is stable under
   * a reorder, and it is also what a person aiming at a list does. */
  act(() => {
    fireEvent.pointerMove(window, { clientX: 10, clientY: to.top + 2 });
  });
  act(() => {
    fireEvent.pointerUp(window, {});
  });
}

describe('dragging a topic to another branch', () => {
  afterEach(() => {
    // A drag that ends without a pointerup — an Escape, or a test that stops
    // mid-gesture — leaves WINDOW-level listeners behind, and the next test's
    // pointerup is delivered to them, committing a move nobody asked for. That
    // is a real leak: the listeners live on window, not on the component, so
    // unmounting does not remove them. Worth fixing in the app too, and the
    // teardown here has to be as thorough as the drag's own cleanup.
    window.dispatchEvent(new Event('pointerup'));
    cleanup();
    currentContainer?.remove();
    currentContainer = null;
  });

  test('the handle exists and advertises a drag, not a click', () => {
    setup();
    const handle = moveHandleFor('cansaço');
    expect(handle.getAttribute('aria-label')).toMatch(/arraste/i);
    expect(handle.className).toContain('cursor-grab');
  });

  test('pointer-down shows the row as picked up, before any movement', () => {
    setup();
    giveRowsGeometry();
    const handle = moveHandleFor('cansaço');
    act(() => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 20 });
    });
    // The immediate feedback the affordance lacked: the row dims and the cursor
    // becomes a grabbing hand, at pointer-down, not after a move. The dashed
    // destination is deliberately NOT here yet — a press with no movement is a
    // click, and a click must never silently relocate a topic.
    const lifted = rowFor('cansaço');
    expect(lifted.style.opacity).toBe('0.45');
    expect(handle.className).toContain('cursor-grabbing');
    expect(currentContainer!.querySelector('.border-dashed')).toBeFalsy();
  });

  test('a press and release with no movement is a click, not a silent move', () => {
    setup();
    giveRowsGeometry();
    const handle = moveHandleFor('cansaço');
    act(() => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 20 });
    });
    act(() => {
      fireEvent.pointerUp(window, {});
    });
    // The whole point of delaying the aim: a click on the handle cannot move a
    // topic to whichever row happened to be nearest it.
    expect(updateCount).toBe(0);
  });

  test('dragging marks the destination live, without moving the list', () => {
    setup();
    giveRowsGeometry();
    const handle = moveHandleFor('cansaço');
    const famTop = rowFor('Família').getBoundingClientRect().top;

    act(() => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 20 });
    });
    expect(updateCount).toBe(0); // nothing committed yet

    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 35 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: famTop + 2 });
    });

    // The destination is named, live, before the release. The LIST is not
    // reordered: moving the row under a pointer feeds the hit-test its own
    // output, and the drop lands on whichever row took its place.
    const dashed = currentContainer!.querySelector('.border-dashed input') as HTMLInputElement;
    expect(dashed?.value).toBe('Família');
    const order = Array.from(
      currentContainer!.querySelectorAll<HTMLInputElement>('input[type="text"]')
    ).map((i) => i.value);
    // Still in its original place until the drop.
    expect(order.indexOf('cansaço')).toBeLessThan(order.indexOf('Família'));
    expect(updateCount).toBe(0);
  });

  test('the keyboard lift still previews the subtree at its new depth', () => {
    // Unlike a drag, the keyboard lift reorders: there is no pointer to track,
    // so showing the destination is pure information and cannot feed back.
    setup();
    const row = focusRow('cansaço');
    press(row, 'm', { ctrlKey: true, shiftKey: true });
    press(row, 'ArrowDown');
    press(row, 'ArrowDown');
    press(row, 'ArrowDown'); // onto "Família"
    const order = Array.from(
      currentContainer!.querySelectorAll<HTMLInputElement>('input[type="text"]')
    ).map((i) => i.value);
    expect(order.indexOf('cansaço')).toBeGreaterThan(order.indexOf('mãe apoia'));
  });

  test('releasing commits one change to the right parent', () => {
    setup();
    drag('cansaço', 'Família');

    // ONE commit for one drag. Two would put two entries in the history stack
    // and let the client window see an intermediate state — and the second one
    // was real: the click the browser fires after pointerup re-entered the
    // handler and started a fresh lift on the row it had just moved.
    expect(updateCount).toBe(1);
    const fam = (lastRoot as MindMapNode).children?.[1];
    expect(fam?.children?.map((c) => c.text)).toEqual(['mãe apoia', 'cansaço']);
  });

  test('releasing far below the list drops it on the last valid row', () => {
    setup();
    giveRowsGeometry();
    const handle = moveHandleFor('cansaço');
    act(() => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 20 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
    });
    // Dragged far past the last row. Every row is still hit-tested by distance,
    // so the nearest valid one wins — a release below the outline means "put it
    // at the end", not "throw it away", and the confirmation then names the
    // destination so the outcome is never a surprise.
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 100000 });
    });
    act(() => {
      fireEvent.pointerUp(window, {});
    });
    expect(updateCount).toBe(1);
  });

  test('Escape mid-drag cancels and leaves the tree alone', () => {
    setup();
    giveRowsGeometry();
    const handle = moveHandleFor('cansaço');
    act(() => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 20 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    act(() => {
      fireEvent.pointerUp(window, {});
    });
    expect(updateCount).toBe(0);
    expect(currentContainer!.querySelector('.border-dashed')).toBeFalsy();
  });

  test('a non-primary button does not start a drag', () => {
    setup();
    giveRowsGeometry();
    const handle = moveHandleFor('cansaço');
    act(() => {
      fireEvent.pointerDown(handle, { button: 2, clientX: 10, clientY: 20 });
    });
    // A right-click opens a context menu; starting a move behind it would leave
    // a half-finished gesture under the menu.
    expect(currentContainer!.querySelector('.border-dashed')).toBeFalsy();
  });

  test('dragging skips the rows that cannot take the drop', () => {
    setup();
    const rows = giveRowsGeometry();
    const handle = moveHandleFor('chefe cobra');
    // Point at "prazos curtos", which is inside the dragged node's own subtree.
    const forbidden = rows.find((r) =>
      r.contains(rowFor('prazos curtos').querySelector('input')!)
    )!;

    act(() => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 20 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
    });
    act(() => {
      fireEvent.pointerMove(window, {
        clientX: 10,
        clientY: forbidden.getBoundingClientRect().top + 10,
      });
    });

    // The destination outline must never land on the dragged row or its child.
    const dashed = currentContainer!.querySelector('.border-dashed input') as HTMLInputElement;
    expect(dashed).toBeTruthy();
    expect(['chefe cobra', 'prazos curtos']).not.toContain(dashed.value);
  });

  test('the banner says "solte" once the pointer is carrying it', () => {
    setup();
    giveRowsGeometry();
    const handle = moveHandleFor('cansaço');
    act(() => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 20 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
    });
    // The instruction changes with the gesture: "solte" while the pointer holds
    // it, and the arrow keys once it is back to being a keyboard lift.
    expect(document.body.textContent).toMatch(/Solte/i);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
  });
});

describe('the full-screen toggle lives on the sidebar', () => {
  afterEach(() => {
    cleanup();
    currentContainer?.remove();
    currentContainer = null;
  });

  function setupWithToggle(maximizeOutline: boolean, onToggle: () => void) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    currentContainer = container;
    render(
      React.createElement(OutlineEditor, {
        root: fixture(),
        onUpdateRoot: () => {},
        onDraftChange: () => {},
        onSelectNode: () => {},
        selectedNodeId: null,
        focusDwellSeconds: 0,
        theme: 'papel' as const,
        enableNodeMove: false,
        outlineFontScale: 1,
        maximizeOutline,
        onToggleMaximize: onToggle,
      }),
      { container }
    );
  }

  test('the button is in the sidebar header, not behind settings', () => {
    let toggled = false;
    setupWithToggle(false, () => {
      toggled = true;
    });
    const btn = currentContainer!.querySelector<HTMLButtonElement>(
      'button[aria-label*="tela inteira"]'
    );
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      btn!.click();
    });
    expect(toggled).toBe(true);
  });

  test('it reports the expanded state and offers to shrink it', () => {
    setupWithToggle(true, () => {});
    const btn = currentContainer!.querySelector<HTMLButtonElement>(
      'button[aria-pressed]'
    );
    expect(btn!.getAttribute('aria-pressed')).toBe('true');
    expect(btn!.getAttribute('aria-label')).toMatch(/Mostrar a prévia/i);
  });

  test('no button at all when the host does not offer the layout change', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    currentContainer = container;
    render(
      React.createElement(OutlineEditor, {
        root: fixture(),
        onUpdateRoot: () => {},
        onDraftChange: () => {},
        onSelectNode: () => {},
        selectedNodeId: null,
        focusDwellSeconds: 0,
        theme: 'papel' as const,
        enableNodeMove: false,
        outlineFontScale: 1,
      }),
      { container }
    );
    expect(container.querySelector('button[aria-pressed]')).toBeFalsy();
  });
});
