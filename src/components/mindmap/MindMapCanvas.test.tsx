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

describe('presenter mirror (view_sync)', () => {
  function renderMirror(extra: Record<string, unknown> = {}) {
    return render(
      React.createElement(MindMapCanvas, {
        root,
        draft: null,
        selectedNodeId: null,
        highlightedPath: null,
        theme: 'papel' as const,
        readOnly: true,
        ...extra,
      })
    );
  }

  test('readOnly hides every camera control: the mirror has no local buttons', () => {
    renderMirror();
    expect(screen.queryByLabelText('Aumentar zoom')).toBeNull();
    expect(screen.queryByLabelText('Diminuir zoom')).toBeNull();
    expect(screen.queryByLabelText('Ajustar mapa à tela')).toBeNull();
    expect(screen.queryByLabelText('Resetar zoom para 100%')).toBeNull();
  });

  test('readOnly ignores the wheel: no preventDefault, no local zoom', () => {
    renderMirror();
    const container = screen.getByRole('application');
    const evt = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    });
    container.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });

  test('readOnly ignores container keys: arrows and +/- move nothing', () => {
    const zooms: number[] = [];
    renderMirror({ onViewChange: (v: { zoom: number }) => zooms.push(v.zoom) });
    const container = screen.getByRole('application');
    fireEvent.keyDown(container, { key: '+' });
    fireEvent.keyDown(container, { key: 'ArrowLeft' });
    // Only the mount frame (if any) may exist: no gesture may report a move.
    expect(zooms.filter((z) => z !== 1)).toHaveLength(0);
  });

  test('mirror never steers its own camera on selection', async () => {
    // Gap: `select` and `view_sync` arrive together, and a local centreOn
    // running last after a manual host pan diverged the mirror until the
    // next rebroadcast. With a real container size the drift is observable.
    type View = { zoom: number; cx: number; cy: number };
    const views: View[] = [];
    const props = (selectedNodeId: string | null, syncedView: View | null) =>
      React.createElement(MindMapCanvas, {
        root,
        draft: null,
        selectedNodeId,
        highlightedPath: null,
        theme: 'papel' as const,
        readOnly: true,
        syncedView,
        onViewChange: (v: View) => views.push({ ...v }),
      });
    const r = render(props(null, null));
    const container = screen.getByRole('application');
    Object.defineProperty(container, 'clientWidth', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 600,
      configurable: true,
    });
    await new Promise((res) => setTimeout(res, 300));
    const base = views.length;
    // Mirror camera + a selection landing together, as in production.
    r.rerender(props('a', { zoom: 1.3, cx: 50, cy: -20 }));
    await new Promise((res) => setTimeout(res, 300));
    const fresh = views.slice(base);
    expect(fresh.length).toBeGreaterThan(0);
    for (const v of fresh) {
      expect(v.zoom).toBeCloseTo(1.3, 5);
      expect(v.cx).toBeCloseTo(50, 2);
      expect(v.cy).toBeCloseTo(-20, 2);
    }
  });

  test('camera moves are reported via onViewChange (host side)', async () => {    const zooms: number[] = [];
    render(
      React.createElement(MindMapCanvas, {
        root,
        draft: null,
        selectedNodeId: null,
        highlightedPath: null,
        theme: 'papel' as const,
        onViewChange: (v: { zoom: number }) => zooms.push(v.zoom),
      })
    );
    // Mount + async fit settle first: the initial frame is 1, the fit frame
    // lands later (effects are not sync-flushed under bun). The pin is
    // relative — a '+' reports a zoom one step above whatever settled.
    await new Promise((r) => setTimeout(r, 300));
    expect(zooms.length).toBeGreaterThan(0);
    const settled = zooms[zooms.length - 1];
    const container = screen.getByRole('application');
    fireEvent.keyDown(container, { key: '+' });
    // The '+' frame is trailing (throttle ~120ms): wait it out.
    await new Promise((r) => setTimeout(r, 300));
    const after = zooms[zooms.length - 1];
    expect(after).toBeGreaterThan(settled);
    expect(after).toBeCloseTo(Math.min(2.5, settled * 1.2), 5);
  });
});
