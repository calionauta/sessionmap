import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, cleanup } = await import('@testing-library/react');
const React = await import('react');
const { MarkdownOutline } = await import('./MarkdownOutline');
import type { MindMapNode } from '../../types';

afterEach(() => cleanup());

/**
 * The synchronous flush the parent calls before switching sessions.
 *
 * Without it, keystrokes newer than the 400ms parse debounce live only in
 * the textarea DOM, and the session-change buffer reload drops them. The
 * pin: flush commits through commitBuffer (the one sanctioned path — the
 * source-level test in MarkdownOutline.test.tsx counts its callers), returns
 * the committed root, and a second flush with no new input commits nothing.
 */

const root: MindMapNode = {
  id: 'n_root',
  text: '28/09/2026',
  children: [{ id: 'n_1', text: 'trabalho', children: [] }],
};

function renderOutline(onUpdateRoot: (r: MindMapNode) => void) {
  const flushRef: { current: ((() => MindMapNode | null) | null) } = { current: null };
  const utils = render(
    React.createElement(MarkdownOutline, {
      root,
      onUpdateRoot: (r: MindMapNode) => onUpdateRoot(r),
      onDraftChange: () => {},
      onSelectNode: () => {},
      selectedNodeId: null,
      theme: 'papel' as const,
      outlineFontScale: 1,
      flushRef: flushRef as React.MutableRefObject<(() => MindMapNode | null) | null>,
    })
  );
  const textarea = utils.container.querySelector('textarea') as HTMLTextAreaElement;
  return { ...utils, textarea, flushRef };
}

describe('outline flushRef', () => {
  test('commits keystrokes newer than the debounce and returns the root', () => {
    const committed: MindMapNode[] = [];
    const { textarea, flushRef } = renderOutline((r) => committed.push(r));

    fireEvent.change(textarea, {
      target: { value: '# 28/09/2026\n- trabalho\n- novo tópico' },
    });
    // No waiting: the debounce has NOT fired, so nothing committed yet.
    expect(committed).toHaveLength(0);

    const flushed = flushRef.current?.();
    expect(committed).toHaveLength(1);
    expect(flushed).toBe(commitmentsRoot(committed));
    const texts = committed[0].children.map((c) => c.text);
    expect(texts).toContain('novo tópico');
  });

  test('a second flush with no new input commits nothing', () => {
    const committed: MindMapNode[] = [];
    const first = renderOutline((r) => committed.push(r));

    fireEvent.change(first.textarea, {
      target: { value: '# 28/09/2026\n- trabalho\n- outro' },
    });
    const flushed = first.flushRef.current?.();
    expect(flushed).not.toBeNull();
    expect(committed).toHaveLength(1);
    // The parent now holds the committed tree, so the prop updates — the
    // same update handleUpdateRoot performs in production. Against the new
    // prop the buffer is unchanged, and the commit point is a no-op rather
    // than a duplicate history entry.
    first.rerender(
      React.createElement(MarkdownOutline, {
        root: committed[0],
        onUpdateRoot: (r: MindMapNode) => committed.push(r),
        onDraftChange: () => {},
        onSelectNode: () => {},
        selectedNodeId: null,
        theme: 'papel' as const,
        outlineFontScale: 1,
        flushRef: first.flushRef as React.MutableRefObject<(() => MindMapNode | null) | null>,
      })
    );
    expect(first.flushRef.current?.()).toBeNull();
    expect(committed).toHaveLength(1);
  });
});

function commitmentsRoot(committed: MindMapNode[]): MindMapNode | null {
  return committed.length > 0 ? committed[committed.length - 1] : null;
}
