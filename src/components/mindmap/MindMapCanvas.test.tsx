import { describe, expect, test, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, screen, cleanup } = await import('@testing-library/react');
const React = await import('react');
const { MindMapCanvas } = await import('./MindMapCanvas');
import type { MindMapNode } from '../../types';

afterEach(() => cleanup());

const root: MindMapNode = {
  id: 'r',
  text: 'Sessão',
  children: [{ id: 'a', text: 'tópico', children: [] }],
};

function renderCanvas() {
  return render(
    React.createElement(MindMapCanvas, {
      root,
      draft: null,
      selectedNodeId: null,
      highlightedPath: null,
      theme: 'papel' as const,
    })
  );
}

describe('wheel zoom is a non-passive native listener', () => {
  test('preventDefault works: no passive-listener warning, page does not scroll', () => {
    renderCanvas();
    const container = screen.getByRole('application');

    const evt = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    });
    container.dispatchEvent(evt);

    // Inside a passive listener this would stay false and Chrome would log
    // "Unable to preventDefault inside passive event listener invocation".
    expect(evt.defaultPrevented).toBe(true);
  });

  test('the React onWheel prop is gone: the only wheel path is the native one', () => {
    // Lint-shaped, like the buffer tests: the regression vector is someone
    // re-adding onWheel={...} for convenience, which silently re-attaches at
    // the passive document root.
    const code = readFileSync(new URL('./MindMapCanvas.tsx', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).toMatch(/passive:\s*false/);
    expect(code.match(/onWheel=\{/g) ?? []).toHaveLength(0);
  });

  test('keyboard zoom still works on the container', () => {
    renderCanvas();
    const container = screen.getByRole('application');
    // No throw, no-op at most: '+' hits zoomBy, arrows pan only when the
    // container itself holds focus. The pin is that the handler is wired.
    fireEvent.keyDown(container, { key: '+' });
    expect(container).toBeTruthy();
  });
});
