import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, cleanup } = await import('@testing-library/react');
const React = await import('react');
const { useMindMapLayout } = await import('./useMindMapLayout');
import type { MindMapNode } from '../../types';

afterEach(() => cleanup());

const node = (id: string, text: string, children: MindMapNode[] = []): MindMapNode => ({
  id,
  text,
  children,
  collapsed: false,
});

function layoutOf(root: MindMapNode, draft: Parameters<typeof useMindMapLayout>[1]) {
  const box: { out: ReturnType<typeof useMindMapLayout> | null } = { out: null };
  const Probe = () => {
    box.out = useMindMapLayout(root, draft, null, 1.0);
    return null;
  };
  render(React.createElement(Probe));
  if (!box.out) throw new Error('no layout');
  return box.out;
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) =>
  Math.abs(a.x - b.x) * 2 < a.width + b.width &&
  Math.abs(a.y - b.y) * 2 < a.height + b.height;

describe('the ghost balloon on an empty top-level bullet', () => {
  // Reported from the demo footage: pressing Enter for a new "- " line shows
  // "novo ponto…" ON TOP of the existing balloons, and it only snaps into
  // place once text is typed (and the real node takes over).
  const root = node('root', 'Sessão', [
    node('c1', 'Primeiro'),
    node('c2', 'Segundo'),
    node('c3', 'Terceiro'),
  ]);
  const emptyDraft = {
    mode: 'add' as const,
    parentId: 'root',
    targetId: null,
    text: '',
    active: true,
  };

  test('it renders after the last same-side sibling, overlapping nothing', () => {
    const { nodes, ghostNode } = layoutOf(root, emptyDraft);
    expect(ghostNode).not.toBeNull();
    const ghost = ghostNode!;
    // The root fans children left AND right: c1/c3 right, c2 left.
    // The ghost goes right, so its anchor is c3 — never the left-stack c2.
    const rightSiblings = nodes.filter((n) => n.parentId === 'root' && n.side === 'right');
    expect(rightSiblings.length).toBeGreaterThan(0);
    const lowest = rightSiblings.reduce((a, b) => (a.y > b.y ? a : b));
    expect(ghost.y - ghost.height / 2).toBeGreaterThanOrEqual(
      lowest.y + lowest.height / 2
    );
    for (const n of nodes) {
      expect(overlaps(ghost, n)).toBe(false);
    }
  });
});
