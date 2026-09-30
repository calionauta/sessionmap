/**
 * Re-parenting policy — the "lift".
 *
 * Moving a topic to another branch is one tree operation (moveNode, which lives
 * in ./tree with the rest of the tree) surrounded by decisions that are NOT
 * about the tree: which rows may legally receive it, where the cursor should
 * start, how the cursor steps and clamps, what to say when a move is refused,
 * and which chord starts it.
 *
 * Those decisions used to sit in tree.ts, and the symptom was that the file
 * which exists to prove the tree correct was spending half its tests on cursor
 * arithmetic. It is also how a keyboard chord ended up inside a tree module:
 * importing the tree dragged in UI policy that the admin panel and the export
 * modal never asked for.
 *
 * Both outline editors — the row list and the markdown buffer — import the lift
 * from here, which is the point: the same gesture has to behave the same way
 * whichever editor is open.
 */
import { MindMapNode } from '../types';
import { MoveRefusal, findNodeById, findPathToNode, flattenTree, subtreeIds } from './tree';

/**
 * The rows that could become a node's parent, in visual order.
 *
 * Deliberately excludes the node's own subtree (cycle), its current parent
 * (reordering inside a parent is Alt+Up/ArrowDown, and mixing the two gives one
 * action two meanings) and blank rows (see moveNode on why those are refused).
 *
 * The set is what the lift cursor walks, so it is a plain list of ids rather
 * than a flag on each row: the cursor is a position in a list, and the rows
 * that are not in the list are not places the cursor can be.
 */
export function moveCandidates(root: MindMapNode, sourceId: string): string[] {
  const source = findNodeById(root, sourceId);
  if (!source || source.id === root.id) return [];

  const path = findPathToNode(root, sourceId) ?? [];
  const currentParentId = path.length > 1 ? path[path.length - 2] : null;
  const banned = subtreeIds(source);

  return flattenTree(root, 0, null, 0, true)
    .filter(
      (item) =>
        !banned.has(item.id) &&
        item.id !== currentParentId &&
        (item.id === root.id || item.text.trim() !== '')
    )
    .map((item) => item.id);
}

export type { MoveRefusal };

/**
 * Human-readable reason a move was refused, for the live region.
 *
 * A refused action that says nothing reads as a dropped key, which is the
 * failure rejectEmptyParent already documents for the create-child path.
 *
 * The reason enum stays in ./tree, with the operation that raises it; only the
 * sentence shown to the therapist is policy.
 */
export const MOVE_REFUSAL_TEXT: Record<MoveRefusal, string> = {
  root: 'A linha da sessão não pode ser movida.',
  self: 'Um tópico não pode ficar dentro de si mesmo.',
  cycle: 'Um tópico não pode ficar dentro do que já está abaixo dele.',
  'blank-parent': 'Escreva a anotação antes de mover um tópico para dentro dela.',
  'no-change': 'Esse tópico já é o último filho deste.',
}

/**
 * The chord that lifts a topic for re-parenting.
 *
 * Shift is not optional here, and that is a macOS constraint rather than a
 * style choice. Cmd+M minimizes the window and Option+M is a system chord;
 * both are claimed by the window manager, which intercepts them BEFORE the
 * page receives the keydown. No amount of preventDefault reaches that layer,
 * so a single-modifier M did nothing in a browser on macOS while the window
 * quietly minimized. A two-modifier chord is outside what macOS reserves, and
 * all three common forms are accepted so neither Cmd nor Ctrl users are left
 * out.
 */
export function isLiftChord(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (!e.shiftKey) return false;
  // Exactly one modifier, so a three-finger mash is not a lift.
  const mods = [e.ctrlKey, e.metaKey, e.altKey].filter(Boolean).length;
  return mods === 1;
}
