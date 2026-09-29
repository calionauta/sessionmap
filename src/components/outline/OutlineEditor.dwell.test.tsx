import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, cleanup, act } = await import('@testing-library/react');
const React = await import('react');
const { OutlineEditor } = await import('../outline/OutlineEditor');
import type { MindMapNode } from '../../types';

const node = (id: string, text: string, children: MindMapNode[] = []): MindMapNode => ({
  id,
  text,
  children,
  collapsed: false,
});

const fixture = (): MindMapNode =>
  node('root', '28/09/2026', [node('a', 'cansaço'), node('b', 'chefe cobra')]);

let currentContainer: HTMLElement | null = null;
/** Every (nodeId, reason) the outline broadcast, in order. */
let broadcasts: Array<{ nodeId: string | null; reason: string }> = [];

function setup(focusDwellSeconds: number) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  currentContainer = container;
  broadcasts = [];
  render(
    React.createElement(OutlineEditor, {
      root: fixture(),
      onUpdateRoot: () => {},
      onDraftChange: () => {},
      onSelectNode: (nodeId: string | null, reason: string) => {
        broadcasts.push({ nodeId, reason });
      },
      selectedNodeId: null,
      focusDwellSeconds,
      theme: 'papel' as const,
      enableNodeMove: false,
    }),
    { container }
  );
}

function rowFor(text: string): HTMLInputElement {
  const scope = currentContainer ?? document;
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="text"]'));
  const el = inputs.find((i) => i.value === text);
  if (!el) throw new Error(`no row "${text}"`);
  return el;
}

/** Waits long enough for a dwell of `seconds` to elapse, in real time. */
async function waitPastDwell(seconds: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, seconds * 1000 + 400));
  });
}

afterEach(() => {
  cleanup();
  currentContainer = null;
});

describe('dwell — the configured auto-focus', () => {
  test('parking on a row after ArrowDown eventually broadcasts a focus', async () => {
    // 1 second is the smallest value the settings slider can produce, so it is
    // the smallest dwell that can be wrong in a real session.
    setup(1);

    const start = rowFor('28/09/2026');
    act(() => {
      start.focus();
    });
    act(() => {
      fireEvent.keyDown(start, { key: 'ArrowDown' });
    });

    // The traversal itself must NOT highlight — that is what the setting is for.
    expect(broadcasts).toEqual([]);

    await waitPastDwell(1);

    expect(broadcasts).toContainEqual({ nodeId: 'a', reason: 'focus3s' });
  });

  test('at 0 the dwell never arms, so traversal highlights nothing', async () => {
    setup(0);
    const start = rowFor('28/09/2026');
    act(() => {
      start.focus();
    });
    act(() => {
      fireEvent.keyDown(start, { key: 'ArrowDown' });
    });
    await waitPastDwell(1);
    expect(broadcasts).toEqual([]);
  });

  test('moving again re-arms on the new row rather than firing the old one', async () => {
    setup(1);
    const start = rowFor('28/09/2026');
    act(() => {
      start.focus();
    });
    // Both arrows back to back, with no pause: the first row's dwell has had
    // no time to elapse, so a stale fire would be unambiguous.
    act(() => {
      fireEvent.keyDown(start, { key: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(rowFor('cansaço'), { key: 'ArrowDown' });
    });
    await waitPastDwell(1);

    expect(broadcasts).toEqual([{ nodeId: 'b', reason: 'focus3s' }]);
  });
});
