import { describe, expect, test } from 'bun:test';
import {
  MoveRefusal,
  branchIndexOf,
  flattenTree,
  findNodeById,
  moveNode,
  normalizeOutline,
  subtreeIds,
} from './tree';
import { MindMapNode } from '../types';

const node = (id: string, text: string, children: MindMapNode[] = [], collapsed = false): MindMapNode => ({
  id,
  text,
  children,
  collapsed,
});

/** root → trabalho[ t1, t2[ t2a ] ] , familia[ f1 ] */
function fixture(): MindMapNode {
  return node('root', '28/09/2026 14:08', [
    node('trab', 'Trabalho', [node('t1', 'cansaço'), node('t2', 'chefe cobra', [node('t2a', 'prazos curtos')])]),
    node('fam', 'Família', [node('f1', 'mãe apoia')]),
  ]);
}

function countOccurrences(root: MindMapNode, id: string): number {
  let n = 0;
  const walk = (x: MindMapNode) => {
    if (x.id === id) n++;
    (x.children || []).forEach(walk);
  };
  walk(root);
  return n;
}

function textsAt(root: MindMapNode, parentId: string): string[] {
  return (findNodeById(root, parentId)?.children ?? []).map((c) => c.text);
}

const refusalOf = (r: { success: boolean; refusal: MoveRefusal | null }) => r.refusal;

describe('moveNode — refusals', () => {
  test('refuses to move the session row', () => {
    const root = fixture();
    expect(refusalOf(moveNode(root, 'root', 'trab'))).toBe('root');
  });

  test('refuses to move a node into itself', () => {
    expect(refusalOf(moveNode(fixture(), 't1', 't1'))).toBe('self');
  });

  test('refuses to move a parent into its own descendant', () => {
    // The cycle case is a stack overflow in every recursive walk in the app,
    // not a wrong-looking row, so it must never reach the tree.
    expect(refusalOf(moveNode(fixture(), 't2', 't2a'))).toBe('cycle');
  });

  test('refuses a grandchild of the moved node', () => {
    expect(refusalOf(moveNode(fixture(), 'trab', 't2a'))).toBe('cycle');
  });

  test('refuses a blank parent rather than letting normalizeOutline undo it', () => {
    const root = node('root', 'sessão', [node('a', 'Trabalho', [node('blank', '   '), node('t1', 'cansaço')])]);
    const result = moveNode(root, 't1', 'blank');
    expect(refusalOf(result)).toBe('blank-parent');
    // And the returned root is the original, so a caller that ignores the
    // refusal cannot have half-applied anything.
    expect(result.root).toBe(root);
  });

  test('the root is exempt from the blank-parent rule', () => {
    // t1 is NOT already last, so this is a real move rather than a no-op.
    const root = node('root', '  ', [node('t1', 'cansaço'), node('t2', 'chefe')]);
    const result = moveNode(root, 't1', 'root');
    expect(result.success).toBe(true);
    expect(textsAt(result.root, 'root')).toEqual(['chefe', 'cansaço']);
  });

  test('refuses the same no-op at the root, not just below it', () => {
    const root = node('root', 'sessão', [node('t1', 'cansaço')]);
    expect(refusalOf(moveNode(root, 't1', 'root'))).toBe('no-change');
  });

  test('refuses a move that changes nothing', () => {
    // t2a is already the last child of t2. Committing this would leave an undo
    // step that undoes nothing, because handleUpdateRoot records history for
    // every reason that is not typing.
    expect(refusalOf(moveNode(fixture(), 't2a', 't2'))).toBe('no-change');
  });
});

describe('moveNode — the move itself', () => {
  test('lands the node as the LAST CHILD of the target', () => {
    const { root, success } = moveNode(fixture(), 't1', 'fam');
    expect(success).toBe(true);
    expect(textsAt(root, 'fam')).toEqual(['mãe apoia', 'cansaço']);
    expect(textsAt(root, 'trab')).toEqual(['chefe cobra']);
  });

  test('carries the whole subtree, so descendant ids survive', () => {
    const before = fixture();
    const { root } = moveNode(before, 't2', 'fam');

    expect(textsAt(root, 'fam')).toEqual(['mãe apoia', 'chefe cobra']);
    // The highlight the client may already have on t2a must keep resolving.
    // Identity is deliberately NOT asserted: moveNode rebuilds the path to the
    // destination (that is how the upward case avoids a duplicate), so object
    // identity does not survive the move. Ids are the contract, and the outline
    // keys its rows by id — see the note in moveNode's docstring.
    expect(findNodeById(root, 't2a')?.text).toBe('prazos curtos');
    expect(findNodeById(root, 't2')?.text).toBe('chefe cobra');
  });

  test('never duplicates the subtree when the new parent is an ancestor', () => {
    // t1 is already inside t2; making it a child of t2 must MOVE it, not copy it.
    const { root, success } = moveNode(fixture(), 't1', 't2');
    expect(success).toBe(true);
    expect(textsAt(root, 't2')).toEqual(['prazos curtos', 'cansaço']);
    expect(countOccurrences(root, 't1')).toBe(1);
    // 7 rows: nothing added, nothing lost — the only change is where t1 sits.
    expect(flattenTree(root)).toHaveLength(flattenTree(fixture()).length);
  });

  /**
   * The upward move, which is the case every earlier test missed.
   *
   * t1 is a GRANDCHILD of the root, so removing it means reaching past the
   * direct children. The first implementation filtered each node's own children
   * and re-attached, which left the original in place and produced a tree with
   * two `t1` nodes — React logged duplicate keys and the outline drew the
   * subtree twice. No unit test caught it because they all moved a node
   * sideways or downward; it only appeared once a test drove the real
   * component. Every row count and every uniqueness assertion below exists to
   * keep that from coming back.
   */
  test('moving a node UP to the root does not duplicate it', () => {
    const { root, success } = moveNode(fixture(), 't1', 'root');
    expect(success).toBe(true);
    expect(textsAt(root, 'root')).toEqual(['Trabalho', 'Família', 'cansaço']);
    expect(countOccurrences(root, 't1')).toBe(1);
    expect(textsAt(root, 'trab')).toEqual(['chefe cobra']);
  });

  test('every id in the tree is unique after any single move', () => {
    // The invariant that duplicate keys violated. Checked across EVERY
    // source/target pair, legal or not: moveNode is asked to refuse the rest,
    // and a refusal that is not a refusal is a duplicate id. Enumerating the
    // pairs here rather than borrowing a UI's candidate list is deliberate —
    // this test used to skip the illegal pairs by asking the lift which
    // targets it would offer, so the refusals were never exercised at all.
    const root = fixture();
    const ids = flattenTree(root).map((i) => i.id);
    for (const from of ids) {
      for (const to of ids) {
        const result = moveNode(root, from, to);
        if (!result.success) continue;
        const after = flattenTree(result.root).map((i) => i.id);
        expect(after).toHaveLength(ids.length);
        expect(new Set(after).size).toBe(after.length);
      }
    }
  });

  test('every descendant still resolves after an upward move', () => {
    // The highlight the client may hold on a descendant must keep working, so
    // the subtree has to travel intact — not just the node.
    const { root } = moveNode(fixture(), 't2', 'root');
    expect(countOccurrences(root, 't2')).toBe(1);
    expect(countOccurrences(root, 't2a')).toBe(1);
    expect(textsAt(root, 't2')).toEqual(['prazos curtos']);
    // t2 rose to a top-level branch and t2a came with it one level down.
    expect(flattenTree(root).map((i) => [i.id, i.level])).toEqual([
      ['root', 0],
      ['trab', 1],
      ['t1', 2],
      ['fam', 1],
      ['f1', 2],
      ['t2', 1],
      ['t2a', 2],
    ]);
  });

  test('is atomic: the subtree is in the tree exactly once, at one depth', () => {
    const { root } = moveNode(fixture(), 't2', 'fam');
    expect(countOccurrences(root, 't2')).toBe(1);
    expect(countOccurrences(root, 't2a')).toBe(1);
    const levels = flattenTree(root).map((i) => [i.id, i.level]);
    expect(levels).toEqual([
      ['root', 0],
      ['trab', 1],
      ['t1', 2],
      ['fam', 1],
      ['f1', 2],
      ['t2', 2],
      ['t2a', 3],
    ]);
  });

  test('force-expands a collapsed new parent', () => {
    const root = node('root', 's', [node('fam', 'Família', [node('f1', 'mãe')], true), node('t1', 'cansaço')]);
    const { root: moved } = moveNode(root, 't1', 'fam');
    // Otherwise the node is present in the outline and invisible on the
    // client's screen, which is the worst failure this feature has.
    expect(findNodeById(moved, 'fam')?.collapsed).toBe(false);
    expect(textsAt(moved, 'fam')).toEqual(['mãe', 'cansaço']);
  });

  test('leaves a collapsed movee alone — the user collapsed it deliberately', () => {
    const root = node('root', 's', [node('t2', 'chefe', [node('t2a', 'prazos')], true), node('fam', 'Família')]);
    const { root: moved } = moveNode(root, 't2', 'fam');
    expect(findNodeById(moved, 't2')?.collapsed).toBe(true);
  });

  test('does not produce a tree normalizeOutline would rewrite', () => {
    // A move must not create the blank-wrapper state that runs on every update
    // and would silently dissolve the move a frame later.
    const { root } = moveNode(fixture(), 't2', 'fam');
    expect(normalizeOutline(root)).toBe(root);
  });

  test('leaves the input tree untouched', () => {
    const before = fixture();
    moveNode(before, 't2', 'fam');
    expect(textsAt(before, 'fam')).toEqual(['mãe apoia']);
    expect(textsAt(before, 'trab')).toEqual(['cansaço', 'chefe cobra']);
  });
});


describe('subtreeIds / branchIndexOf', () => {
  test('subtreeIds includes the node itself', () => {
    expect([...subtreeIds(findNodeById(fixture(), 't2')!)].sort()).toEqual(['t2', 't2a']);
  });

  test('branchIndexOf finds the top-level branch, and -1 for the root', () => {
    const root = fixture();
    // t2a sits under t2, which is under trab — the branch is trab, index 0.
    expect(branchIndexOf(root, 't2a')).toBe(0);
    expect(branchIndexOf(root, 'f1')).toBe(1);
    expect(branchIndexOf(root, 'root')).toBe(-1);
  });

  test('branchIndexOf detects the side flip the outline cannot show', () => {
    // The map alternates branches left/right by index parity, so a move from
    // one branch to another is a side change on the shared screen.
    const root = fixture();
    const { root: moved } = moveNode(root, 'f1', 'trab');
    const before = branchIndexOf(root, 'f1');
    const after = branchIndexOf(moved, 'f1');
    expect(before % 2).not.toBe(after % 2);

    // And a move that stays inside the same branch reports no flip.
    const { root: same } = moveNode(root, 't2a', 't1');
    expect(branchIndexOf(same, 't2a')).toBe(branchIndexOf(root, 't2a'));
  });
});
