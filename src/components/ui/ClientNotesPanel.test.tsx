import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, cleanup, act } = await import('@testing-library/react');
const React = await import('react');
const { ClientNotesPanel } = await import('../ui/ClientNotesPanel');

let container: HTMLElement | null = null;

function setup() {
  container = document.createElement('div');
  document.body.appendChild(container);
  const changes: boolean[] = [];
  render(
    React.createElement(ClientNotesPanel, {
      clientId: 'c1',
      clientName: 'Maria',
      expanded: false,
      onExpandedChange: (v: boolean) => changes.push(v),
    }),
    { container }
  );
  return changes;
}

const title = () => container!.querySelector<HTMLButtonElement>('button')!;
const textarea = () => container!.querySelector<HTMLTextAreaElement>('textarea');
const panel = () => container!.firstElementChild as HTMLElement;

afterEach(() => {
  cleanup();
  container?.remove();
  container = null;
});

describe('the client notes panel', () => {
  test('collapsed shows only the title strip', () => {
    setup();
    expect(textarea()).toBeNull();
  });

  test('opening takes HALF the height, not a five-line strip', () => {
    // The bug: 'panel' was shrink-0 around a rows={5} textarea with no basis,
    // so "open" meant the same five lines on a laptop and on a 4K monitor. Half
    // is the point of the middle state, and the basis is what delivers it —
    // shrink-0 alone only says "do not let the outline squeeze me".
    setup();
    act(() => {
      fireEvent.click(title());
    });
    expect(panel().className).toContain('basis-1/2');
    expect(textarea()!.className).toContain('flex-1');
  });

  test('its size comes from its own state, not from the prop', () => {
    // The bug this caught: the className branched on the `expanded` PROP while
    // the mode lived in internal state. Rendered with a parent that does not
    // feed the prop back — or feeds it back a tick late — the panel showed the
    // COLLAPSED sizing while the parent had already hidden the outline, so
    // there was a strip of textarea under an empty pane. The prop now means
    // only "hide the outline", and this pins that the layout ignores it.
    setup();
    act(() => {
      fireEvent.click(title());
    });
    const expand = container!.querySelector<HTMLButtonElement>(
      'button[aria-label*="Expandir anotações"]'
    )!;
    act(() => {
      fireEvent.click(expand);
    });
    // expanded={false} throughout — and the panel is still full height.
    expect(panel().className).toContain('flex-1');
    expect(panel().className).not.toContain('basis-1/2');
  });

  test('opening tells the parent it is no longer hiding the outline', () => {
    const changes = setup();
    act(() => {
      fireEvent.click(title());
    });
    // Only 'expanded' hides the outline; the half-height panel keeps it usable.
    expect(changes).toEqual([false]);
  });

  test('closing hides the textarea again', () => {
    setup();
    act(() => {
      fireEvent.click(title());
    });
    expect(textarea()).not.toBeNull();
    act(() => {
      fireEvent.click(title());
    });
    expect(textarea()).toBeNull();
  });

  test('the textarea is never a second way to size the same box', () => {
    // A manual drag on a flex-fill box fights the layout. Both open states fill
    // what they are given, so the browser's own corner handle has to be off.
    setup();
    act(() => {
      fireEvent.click(title());
    });
    expect(textarea()!.className).toContain('resize-none');
  });
});
