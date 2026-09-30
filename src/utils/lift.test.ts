import { describe, expect, test } from 'bun:test';
import { moveCandidates, isLiftChord, MOVE_REFUSAL_TEXT } from './lift';
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
