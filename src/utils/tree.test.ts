import { describe, expect, test } from 'bun:test';
import {
  MoveRefusal,
  branchIndexOf,
  flattenTree,
  findNodeById,
  moveCandidates,
  moveNode,
  initialLiftTarget,
  stepLiftTarget,
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
    // The invariant that duplicate keys violated. Checked across every legal
    // source/target pair in the fixture, not just the ones that seem likely.
    const root = fixture();
    const ids = flattenTree(root).map((i) => i.id);
    for (const from of ids) {
      for (const to of moveCandidates(root, from)) {
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

  test('force-expands a collapsed new parent, as indentNode does', () => {
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
