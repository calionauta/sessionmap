import { describe, expect, test } from 'bun:test';
import {
  moveCandidates,
  initialLiftTarget,
  stepLiftTarget,
  isLiftChord,
  MOVE_REFUSAL_TEXT,
} from './lift';
import { MoveRefusal, branchIndexOf, moveNode, flattenTree } from './tree';
import { MindMapNode } from '../types';

const node = (id: string, text: string, children: MindMapNode[] = [], collapsed = false): MindMapNode => ({
  id,
  text,
  children,
  collapsed,
});

/** The reason a move gave, or null when it was allowed. */
const refusalOf = (r: { success: boolean; refusal: MoveRefusal | null }) => r.refusal;

/** root -> trabalho[ t1, t2[ t2a ] ] , familia[ f1 ] */
const fixture = (): MindMapNode =>
  node('root', '28/09/2026 14:08', [
    node('trab', 'Trabalho', [node('t1', 'cansaço'), node('t2', 'chefe cobra', [node('t2a', 'prazos curtos')])]),
    node('fam', 'Família', [node('f1', 'mãe apoia')]),
  ]);

describe('moveNode — a candidate is always accepted', () => {
  test('every candidate the cursor can reach is a move the operation allows', () => {
    // The list and the operation must not disagree: a cursor that can stop on
    // a row the move then refuses is the "tecla que não fez nada" bug again.
    const root = fixture();
    for (const from of flattenTree(root).map((i) => i.id)) {
      for (const to of moveCandidates(root, from)) {
        expect(moveNode(root, from, to).success).toBe(true);
      }
    }
  });
});

describe('MOVE_REFUSAL_TEXT', () => {
  test('every refusal reason has a sentence to show', () => {
    // A refusal with no message is the bug rejectEmptyParent documents: the
    // keystroke looks dropped rather than refused.
    for (const reason of ['root', 'self', 'cycle', 'blank-parent', 'no-change'] as const) {
      expect(MOVE_REFUSAL_TEXT[reason].length).toBeGreaterThan(0);
    }
  });
});

describe('isLiftChord', () => {
  const chord = (o: Record<string, unknown>) =>
    isLiftChord({
      key: 'm',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...o,
    } as never);

  test('accepts the two-modifier forms', () => {
    expect(chord({ ctrlKey: true, shiftKey: true })).toBe(true);
    expect(chord({ metaKey: true, shiftKey: true })).toBe(true);
    expect(chord({ altKey: true, shiftKey: true })).toBe(true);
  });

  test('rejects the chords macOS claims, and the bare letter', () => {
    expect(chord({ metaKey: true })).toBe(false);
    expect(chord({ altKey: true })).toBe(false);
    expect(chord({})).toBe(false);
  });

  test('rejects three modifiers at once', () => {
    expect(chord({ ctrlKey: true, metaKey: true, shiftKey: true })).toBe(false);
  });
});

describe('moveCandidates — the rows the lift cursor can land on', () => {
  test('excludes the node, its descendants and its current parent', () => {
    // t2's own subtree is t2a; its current parent is trab.
    expect(moveCandidates(fixture(), 't2')).toEqual(['root', 't1', 'fam', 'f1']);
  });

  test('excludes blank rows but keeps the root', () => {
    const root = node('root', 'sessão', [
      node('blank', ''),
      node('fam', 'Família', [node('f1', 'mãe apoia', [node('f2', 'irmão')])]),
    ]);
    // f1 is f2's current parent, so the root and fam are what is left.
    expect(moveCandidates(root, 'f2')).toEqual(['root', 'fam']);
  });

  test('excludes the current parent even when it is the root', () => {
    // fam is already a top-level branch, so the one place it could go is
    // exactly where it is.
    expect(moveCandidates(fixture(), 'fam')).toEqual(['trab', 't1', 't2', 't2a']);
  });

  test('is empty for the root itself', () => {
    expect(moveCandidates(fixture(), 'root')).toEqual([]);
  });

  test('every candidate is actually accepted by moveNode', () => {
    // The list and the operation must not disagree: a cursor that can stop on a
    // row the move then refuses is the "tecla que não fez nada" bug again.
    const root = fixture();
    for (const id of moveCandidates(root, 't2')) {
      expect(refusalOf(moveNode(root, 't2', id))).toBeNull();
    }
  });
});

describe('initialLiftTarget — where the cursor lands when a row is lifted', () => {
  test('aims at the nearest candidate above, so Enter does the obvious thing', () => {
    // t2a is the last row; the nearest candidate above it is t1 — a local move
    // rather than a jump to the top of the session.
    expect(initialLiftTarget(fixture(), 't2a')).toBe('t1');
    // t2a really is the row directly above f1, even though t2 is its parent.
    expect(initialLiftTarget(fixture(), 'f1')).toBe('t2a');
  });

  test('a single top-level branch has nowhere to go', () => {
    // Its only parent is the root, and the root is that parent, so there is no
    // candidate at all. startLift reports this rather than entering a lift that
    // could only be cancelled.
    const root = node('root', 's', [node('only', 'Único')]);
    expect(moveCandidates(root, 'only')).toEqual([]);
    expect(initialLiftTarget(root, 'only')).toBeNull();
  });

  test('a single nested branch can still move up to the root', () => {
    // b's only parent is a, and a is excluded as the current parent, so the
    // root is what remains — which is exactly the "over-indented, make it its
    // own branch" case Shift+Tab also covers.
    const root = node('root', 's', [node('a', 'A', [node('b', 'B')])]);
    expect(initialLiftTarget(root, 'b')).toBe('root');
    const twoLevels = node('root', 's', [node('a', 'A', [node('b', 'B', [node('c', 'C')])])]);
    // b is c's current parent, so the nearest candidate above it is a.
    expect(initialLiftTarget(twoLevels, 'c')).toBe('a');
  });

  test('is null when there is nowhere to go', () => {
    const root = node('root', 's', [node('only', 'Único')]);
    expect(initialLiftTarget(root, 'root')).toBeNull();
  });

  test('every initial target is a real candidate the move accepts', () => {
    const root = fixture();
    for (const id of flattenTree(root).map((i) => i.id)) {
      const target = initialLiftTarget(root, id);
      if (target === null) continue;
      expect(moveCandidates(root, id)).toContain(target);
      expect(refusalOf(moveNode(root, id, target))).toBeNull();
    }
  });
});

describe('stepLiftTarget — arrow stepping', () => {
  const list = ['a', 'b', 'c', 'd'];

  test('steps forward and back', () => {
    expect(stepLiftTarget(list, 'a', 1)).toBe('b');
    expect(stepLiftTarget(list, 'c', -1)).toBe('b');
  });

  test('clamps at both ends instead of wrapping', () => {
    // Wrapping would make ArrowUp at the top teleport the destination to the
    // bottom of the session, which is the opposite of what the key says.
    expect(stepLiftTarget(list, 'a', -1)).toBe('a');
    expect(stepLiftTarget(list, 'd', 1)).toBe('d');
    expect(stepLiftTarget(list, 'a', -99)).toBe('a');
    expect(stepLiftTarget(list, 'd', 99)).toBe('d');
  });

  test('paging moves several rows and still clamps', () => {
    expect(stepLiftTarget(list, 'a', 4)).toBe('d');
    expect(stepLiftTarget(list, 'd', -4)).toBe('a');
  });

  test('a stale or null current position starts at the top', () => {
    expect(stepLiftTarget(list, null, 1)).toBe('b');
    expect(stepLiftTarget(list, 'gone', 1)).toBe('b');
  });

  test('an empty list has nowhere to point', () => {
    expect(stepLiftTarget([], 'a', 1)).toBeNull();
  });
});
