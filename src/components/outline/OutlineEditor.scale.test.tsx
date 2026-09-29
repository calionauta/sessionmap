import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, cleanup, act } = await import('@testing-library/react');
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

function setup(outlineFontScale = 1) {
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
      outlineFontScale,
    }),
    { container }
  );
  return container;
}

/** The row for a given text. */
function rowFor(text: string): HTMLElement {
  const scope = currentContainer!;
  const input = Array.from(
    scope.querySelectorAll<HTMLInputElement>('input[type="text"]')
  ).find((i) => i.value === text);
  if (!input) throw new Error(`no row "${text}"`);
  // The row container is the input's ancestor that carries the padding.
  return input.closest('.group') as HTMLElement;
}

describe('outline font scale', () => {
  afterEach(() => {
    cleanup();
    currentContainer?.remove();
    currentContainer = null;
  });

  test('the scale reaches the row as a single custom property', () => {
    setup(1.3);
    const pane = currentContainer!.firstElementChild as HTMLElement;
    // One knob, read by font size, row height, indent step and the gutter.
    expect(pane.style.getPropertyValue('--row-scale').trim()).toBe('1.3');
  });

  test('the annotation font size is driven by the scale, not a fixed class', () => {
    setup(1);
    const small = rowFor('cansaço').querySelector('input') as HTMLInputElement;
    const smallScale = (
      currentContainer!.firstElementChild as HTMLElement
    ).style.getPropertyValue('--row-scale');

    cleanup();
    currentContainer?.remove();
    setup(1.5);
    const large = rowFor('cansaço').querySelector('input') as HTMLInputElement;
    const largeScale = (
      currentContainer!.firstElementChild as HTMLElement
    ).style.getPropertyValue('--row-scale');

    // The expression is the SAME calc() in both cases — that is the point. One
    // knob, resolved by the browser, so no dimension can be left behind at the
    // old size. Only the value of --row-scale differs.
    expect(small.style.fontSize).toBe(large.style.fontSize);
    expect(small.style.fontSize).toContain('--row-scale');
    expect(smallScale.trim()).toBe('1');
    expect(largeScale.trim()).toBe('1.5');
  });

  test('the row grows taller, so a bigger line still has its own band', () => {
    setup(1.5);
    const row = rowFor('cansaço');
    // The 46px band exists to give each row's controls their own space; a 20px
    // line inside a 46px box no longer has one. So the padding reads the scale
    // rather than staying at the size built for 14px text.
    expect(row.style.paddingTop).toContain('--row-scale');
    expect(row.style.paddingBottom).toContain('--row-scale');
  });

  test('the indent step scales, so depth keeps its proportion to the text', () => {
    setup(1.5);
    const deep = rowFor('prazos curtos');
    const padLeft = deep.style.getPropertyValue('--pad-left');
    // Without the scale in the expression, a larger font would make each level
    // visually smaller relative to the text and flatten the hierarchy.
    expect(padLeft).toContain('--row-scale');
  });

  test('the right gutter grows so the controls do not sit on the text', () => {
    setup(1.5);
    const input = rowFor('cansaço').querySelector('input') as HTMLInputElement;
    expect(input.style.paddingRight).toContain('--row-scale');
  });

  test('the default renders without a scale set', () => {
    setup();
    const input = rowFor('cansaço').querySelector('input') as HTMLInputElement;
    // Still driven by the property, which defaults to 1.
    expect(input.style.fontSize).toContain('--row-scale');
  });
});
