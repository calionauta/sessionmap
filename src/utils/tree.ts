import { FlatOutlineItem, MindMapNode } from '../types';
import { parseMarkdown, treeToMarkdown } from './markdown';

let idCounter = Date.now();
export function generateNodeId(): string {
  return `n_${(++idCounter).toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Markdown parsing lives in ./markdown, which delegates to marked.
 *
 * Re-exported here because every caller already imports the tree helpers from
 * this module, and the parser is a tree operation like any other. The previous
 * hand-rolled implementation was replaced wholesale: it read only "-",
 * indentation and a "#" on the first line, and degraded everything else into
 * literal text — a "##" became "- ## sub", and a stray heading could rename
 * the session and take a line with it.
 */
export function parseMarkdownToTree(
  text: string,
  defaultTitle: string = 'Sessão',
  previousRoot?: MindMapNode | null
): MindMapNode {
  return parseMarkdown(text, { defaultTitle, previousRoot, generateId: generateNodeId });
}

export { treeToMarkdown };

export function cloneNode(node: MindMapNode): MindMapNode {
  return {
    id: node.id,
    text: node.text,
    collapsed: Boolean(node.collapsed),
    color: node.color ?? null,
    children: (node.children || []).map(cloneNode),
  };
}

export function findNodeById(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

export function findParentAndIndex(
  root: MindMapNode,
  targetId: string,
  parent: MindMapNode | null = null,
  index: number = -1
): { parent: MindMapNode | null; index: number } | null {
  if (root.id === targetId) {
    return { parent, index };
  }
  for (let i = 0; i < (root.children || []).length; i++) {
    const res = findParentAndIndex(root.children[i], targetId, root, i);
    if (res) return res;
  }
  return null;
}

export function findPathToNode(root: MindMapNode, targetId: string): string[] | null {
  if (root.id === targetId) return [root.id];
  for (const child of root.children || []) {
    const sub = findPathToNode(child, targetId);
    if (sub) return [root.id, ...sub];
  }
  return null;
}

export function formatSessionTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  const hr = pad(date.getHours());
  const min = pad(date.getMinutes());
  const sec = pad(date.getSeconds());
  return `${d}/${m}/${y} ${hr}:${min}:${sec}`;
}

export function addChild(
  root: MindMapNode,
  parentId: string,
  initialText: string = ''
): { root: MindMapNode; newNode: MindMapNode } {
  const newNode: MindMapNode = {
    id: generateNodeId(),
    text: initialText,
    children: [],
  };

  function appendChild(node: MindMapNode): MindMapNode {
    if (node.id === parentId) {
      return {
        ...node,
        collapsed: false,
        children: [...(node.children || []), newNode],
      };
    }
    return {
      ...node,
      children: (node.children || []).map(appendChild),
    };
  }

  return { root: appendChild(root), newNode };
}

/**
 * Accent- and case-insensitive plain-text form, for searching.
 *
 * Portuguese is written with diacritics that speakers routinely omit when
 * typing fast, and this app's users are typing mid-session while a client
 * waits. Stripping combining marks means "saude" finds "saúde" and "familia"
 * finds "família", which a plain toLowerCase() would miss.
 */
export function searchNormalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** True when `haystack` contains `needle`, ignoring case and accents. */
export function matchesQuery(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return searchNormalize(haystack).includes(needle);
}

export function countTotalNodes(node: MindMapNode): number {
  let count = 1;
  for (const child of node.children || []) {
    count += countTotalNodes(child);
  }
  return count;
}

/**
 * Flattens the tree into a list for outline editing.
 * If includeCollapsedChildren is false, children of collapsed nodes are hidden.
 */
export function flattenTree(
  node: MindMapNode,
  level: number = 0,
  parentId: string | null = null,
  indexInParent: number = 0,
  includeCollapsedChildren: boolean = true
): FlatOutlineItem[] {
  const item: FlatOutlineItem = {
    id: node.id,
    text: node.text,
    level,
    parentId,
    collapsed: Boolean(node.collapsed),
    hasChildren: (node.children || []).length > 0,
    childCount: (node.children || []).length,
    indexInParent,
    node,
  };

  const list: FlatOutlineItem[] = [item];

  if (includeCollapsedChildren || !node.collapsed) {
    (node.children || []).forEach((child, idx) => {
      list.push(...flattenTree(child, level + 1, node.id, idx, includeCollapsedChildren));
    });
  }

  return list;
}

/**
 * Updates text of a node immutably.
 */
export function updateNodeText(root: MindMapNode, id: string, newText: string): MindMapNode {
  if (root.id === id) {
    return { ...root, text: newText };
  }
  return {
    ...root,
    children: (root.children || []).map((child) => updateNodeText(child, id, newText)),
  };
}

/**
 * Toggle collapsed state of a node.
 */
export function toggleNodeCollapse(root: MindMapNode, id: string): MindMapNode {
  if (root.id === id) {
    return { ...root, collapsed: !root.collapsed };
  }
  return {
    ...root,
    children: (root.children || []).map((child) => toggleNodeCollapse(child, id)),
  };
}

/**
 * Add a sibling immediately after the given node ID.
 * Returns the new tree and the newly created node.
 */
export function addSibling(
  root: MindMapNode,
  targetId: string,
  initialText: string = ''
): { root: MindMapNode; newNode: MindMapNode } {
  // If target is root, add as child of root
  if (root.id === targetId) {
    const newNode: MindMapNode = {
      id: generateNodeId(),
      text: initialText,
      children: [],
    };
    return {
      root: {
        ...root,
        children: [...(root.children || []), newNode],
      },
      newNode,
    };
  }

  const newNode: MindMapNode = {
    id: generateNodeId(),
    text: initialText,
    children: [],
  };

  function insertAfter(node: MindMapNode): MindMapNode {
    const idx = (node.children || []).findIndex((c) => c.id === targetId);
    if (idx !== -1) {
      const nextChildren = [...node.children];
      nextChildren.splice(idx + 1, 0, newNode);
      return { ...node, children: nextChildren };
    }
    return {
      ...node,
      children: (node.children || []).map(insertAfter),
    };
  }

  return { root: insertAfter(root), newNode };
}

/**
 * Indent a node (Tab): it becomes the last child of its previous sibling.
 */
export function indentNode(
  root: MindMapNode,
  targetId: string
): { root: MindMapNode; success: boolean } {
  if (root.id === targetId) return { root, success: false };

  const pInfo = findParentAndIndex(root, targetId);
  if (!pInfo || !pInfo.parent) return { root, success: false };

  const { parent, index } = pInfo;
  if (index <= 0) return { root, success: false }; // No previous sibling to become child of

  const targetNode = parent.children[index];
  const prevSibling = parent.children[index - 1];

  // We need to remove target from parent, and append to prevSibling.children
  function update(node: MindMapNode): MindMapNode {
    if (node.id === parent.id) {
      const newChildren = node.children.filter((c) => c.id !== targetId);
      return {
        ...node,
        children: newChildren.map((child) => {
          if (child.id === prevSibling.id) {
            return {
              ...child,
              collapsed: false,
              children: [...(child.children || []), targetNode],
            };
          }
          return child;
        }),
      };
    }
    return {
      ...node,
      children: (node.children || []).map(update),
    };
  }

  return { root: update(root), success: true };
}

/**
 * Unindent a node (Shift+Tab): it becomes a sibling of its parent (inserted after parent).
 */
export function unindentNode(
  root: MindMapNode,
  targetId: string
): { root: MindMapNode; success: boolean } {
  if (root.id === targetId) return { root, success: false };

  const pInfo = findParentAndIndex(root, targetId);
  if (!pInfo || !pInfo.parent) return { root, success: false };

  const { parent } = pInfo;
  // If parent is root, we cannot unindent beyond root
  if (parent.id === root.id) return { root, success: false };

  const grandParentInfo = findParentAndIndex(root, parent.id);
  if (!grandParentInfo || !grandParentInfo.parent) return { root, success: false };

  const grandParent = grandParentInfo.parent;
  const targetNode = parent.children.find((c) => c.id === targetId);
  if (!targetNode) return { root, success: false };
  const definedTarget: MindMapNode = targetNode;
  const gpId = grandParent.id;
  const pId = parent.id;

  function update(node: MindMapNode): MindMapNode {
    if (node.id === gpId) {
      const newGrandChildren: MindMapNode[] = [];
      node.children.forEach((c) => {
        if (c.id === pId) {
          // Remove targetNode from parent
          const cleanedParent = {
            ...c,
            children: c.children.filter((child) => child.id !== targetId),
          };
          newGrandChildren.push(cleanedParent);
          // Insert targetNode right after parent
          newGrandChildren.push(definedTarget);
        } else {
          newGrandChildren.push(c);
        }
      });
      return { ...node, children: newGrandChildren };
    }
    return {
      ...node,
      children: (node.children || []).map(update),
    };
  }

  return { root: update(root), success: true };
}

/**
 * Every id in a node's subtree, the node itself included.
 *
 * Used to keep a move from targeting the moved node or anything below it: a
 * node moved into its own descendant is a cycle, and every traversal in the app
 * (flattenTree, findPathToNode, the layout walk) is recursive, so a cycle is a
 * stack overflow rather than a wrong-looking row.
 */
export function subtreeIds(node: MindMapNode, acc: Set<string> = new Set()): Set<string> {
  acc.add(node.id);
  for (const child of node.children || []) {
    subtreeIds(child, acc);
  }
  return acc;
}

/**
 * Index of the top-level branch a node hangs from, or -1 for the root itself.
 *
 * The map alternates top-level branches left/right by index parity
 * (useMindMapLayout), and a node inherits its colour from the branch it sits
 * under. Both are decided at paint time from this index, so a move that
 * changes it is the one move whose effect the outline cannot show — the row
 * lands in exactly the same place in the list while the balloon changes side
 * and colour on the client's screen.
 */
export function branchIndexOf(root: MindMapNode, nodeId: string): number {
  for (let i = 0; i < (root.children || []).length; i++) {
    const branch = root.children[i];
    if (branch.id === nodeId) return i;
    if (subtreeIds(branch).has(nodeId)) return i;
  }
  return -1;
}

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

/**
 * Where the lift cursor should sit when a row is lifted.
 *
 * The row ABOVE the lifted one, not the top of the outline. The mis-filed
 * topic that motivates a move is nearly always a sibling or a cousin, so
 * starting the cursor in the visual neighbourhood of where the row already
 * sits means Enter — which lands on the current candidate — does the obvious
 * thing instead of teleporting the subtree to the top of the session.
 */
export function initialLiftTarget(root: MindMapNode, sourceId: string): string | null {
  const candidates = moveCandidates(root, sourceId);
  if (candidates.length === 0) return null;

  const order = flattenTree(root, 0, null, 0, true).map((i) => i.id);
  const myIndex = order.indexOf(sourceId);
  const before = candidates.filter((id) => order.indexOf(id) < myIndex);
  return before.length > 0 ? before[before.length - 1] : candidates[0];
}

/**
 * Moves the lift cursor by `delta`, clamped to the ends.
 *
 * The candidate list is a list, not a set of flags on the rows, so the cursor
 * is a position in a list: it cannot stop anywhere the move would refuse, and
 * the skip over an invalid row is visible as the highlight jumping rather than
 * as a keystroke that appeared to do nothing.
 */
export function stepLiftTarget(
  candidates: string[],
  current: string | null,
  delta: number
): string | null {
  if (candidates.length === 0) return null;
  const from = Math.max(0, candidates.indexOf(current ?? ''));
  return candidates[Math.min(candidates.length - 1, Math.max(0, from + delta))];
}

export type MoveRefusal =
  | 'root'
  | 'self'
  | 'cycle'
  | 'blank-parent'
  | 'no-change';

/**
 * Moves a node to become the LAST CHILD of another node, carrying its whole
 * subtree along.
 *
 * The subtree is the definition, not an option. A node has no position of its
 * own — it has a path — so "move the parent and leave the children" is a
 * different operation (a split, which raises the question of which children
 * stay). Folding that choice into a move is what turns a structural edit into a
 * guess. Ids are preserved throughout, which is what the outline keys its rows
 * by, so a highlight the client already has on a descendant keeps resolving
 * after the move. Object identity does NOT survive: the path to the
 * destination is rebuilt, and the outline's rows are keyed by id rather than by
 * reference precisely so that does not cost a remount.
 *
 * ONE destination and ONE position. Reordering after the move is Alt+Arrow
 * (moveSibling), which is unambiguous on its own. A move that could also land
 * "before" or "after" some row would have three plausible outcomes per gesture,
 * and one of them is always a mistake.
 *
 * The whole tree is rebuilt in ONE pass, so the caller commits once. Two calls
 * (detach, then attach) would put two entries in the history stack and let the
 * client window receive an intermediate state where the subtree is gone.
 *
 * The new parent is force-expanded, as indentNode already does: a move into a
 * collapsed parent would otherwise leave the node present in the outline and
 * invisible on the shared screen, which is the worst failure available here.
 */
export function moveNode(
  root: MindMapNode,
  targetId: string,
  newParentId: string
): { root: MindMapNode; success: boolean; refusal: MoveRefusal | null } {
  const refuse = (refusal: MoveRefusal) => ({ root, success: false, refusal });

  if (targetId === root.id) return refuse('root');
  if (newParentId === targetId) return refuse('self');

  const target = findNodeById(root, targetId);
  if (!target) return refuse('cycle');

  // A blank parent is not a place a node can go. normalizeOutline runs on
  // every update and dissolves a blank node that has children, so a move onto
  // a blank row would be silently undone a frame later — the row would appear
  // to bounce back with no explanation. Refusing it here is the same rule
  // rejectEmptyParent already applies to creating a child.
  if (newParentId !== root.id && (findNodeById(root, newParentId)?.text.trim() ?? '') === '') {
    return refuse('blank-parent');
  }

  // A node moved into its own subtree is a cycle.
  if (subtreeIds(target).has(newParentId)) return refuse('cycle');

  // Looked up by id, not via findParentAndIndex: the root IS a legal target
  // (it means "last child of the session row", i.e. a top-level branch), and
  // findParentAndIndex returns {parent: null} for the root, which reads as a
  // failure and refused the move with a wrong reason.
  const newParent = findNodeById(root, newParentId);
  if (!newParent) return refuse('cycle');

  // Already the last child of that parent: nothing to do, and the caller must
  // not commit — handleUpdateRoot records history for anything that is not
  // typing, so a no-op here would leave an undo step that undoes nothing.
  const siblings = newParent.children || [];
  const alreadyLastChild =
    findParentAndIndex(root, targetId)?.parent?.id === newParentId &&
    siblings[siblings.length - 1]?.id === targetId;
  if (alreadyLastChild) return refuse('no-change');

  /**
   * Rebuilds the whole tree with the target removed from EVERYWHERE it sits.
   *
   * A plain per-node `filter` is not enough. When the new parent is an ancestor
   * of the target — moving a node up to the root is the common case, and
   * Shift+Tab already covers it, so this path runs constantly — the target is a
   * GRANDCHILD of the destination, and filtering each node's direct children
   * leaves the original in place. Re-attaching then gives the tree two nodes
   * with the same id: React reports duplicate keys, drops one, and the outline
   * renders the subtree twice.
   *
   * So the removal is done over the entire tree first, and the target is
   * re-attached afterwards. The subtree is passed in detached because the
   * captured `target` still contains whatever was below it before the move.
   */
  const detachEverywhere = (node: MindMapNode): MindMapNode => ({
    ...node,
    children: (node.children || [])
      .filter((c) => c.id !== targetId)
      .map(detachEverywhere),
  });

  const detachedTarget = detachEverywhere(target);

  const reattach = (node: MindMapNode): MindMapNode => {
    if (node.id === newParentId) {
      return { ...node, collapsed: false, children: [...(node.children || []), detachedTarget] };
    }
    return { ...node, children: (node.children || []).map(reattach) };
  };

  return { root: reattach(detachEverywhere(root)), success: true, refusal: null };
}

/**
 * Human-readable reason a move was refused, for the live region.
 *
 * A refused action that says nothing reads as a dropped key, which is the
 * failure rejectEmptyParent already documents for the create-child path.
 */
export const MOVE_REFUSAL_TEXT: Record<MoveRefusal, string> = {
  root: 'A linha da sessão não pode ser movida.',
  self: 'Um tópico não pode ficar dentro de si mesmo.',
  cycle: 'Um tópico não pode ficar dentro do que já está abaixo dele.',
  'blank-parent': 'Escreva a anotação antes de mover um tópico para dentro dela.',
  'no-change': 'Esse tópico já é o último filho deste.',
};

/**
 * Move node up or down among its siblings (Alt+Up / Alt+Down).
 */
export function moveSibling(
  root: MindMapNode,
  targetId: string,
  direction: 'up' | 'down'
): { root: MindMapNode; success: boolean } {
  if (root.id === targetId) return { root, success: false };

  const pInfo = findParentAndIndex(root, targetId);
  if (!pInfo || !pInfo.parent) return { root, success: false };

  const { parent, index } = pInfo;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;

  if (targetIndex < 0 || targetIndex >= parent.children.length) {
    return { root, success: false };
  }

  function update(node: MindMapNode): MindMapNode {
    if (node.id === parent.id) {
      const newChildren = [...node.children];
      const temp = newChildren[index];
      newChildren[index] = newChildren[targetIndex];
      newChildren[targetIndex] = temp;
      return { ...node, children: newChildren };
    }
    return {
      ...node,
      children: (node.children || []).map(update),
    };
  }

  return { root: update(root), success: true };
}

/**
 * Enforces the outline invariant: a node with no text has no children.
 *
 * Blank rows used to be prevented by guarding the two key handlers that can
 * create a child (Ctrl+Enter and "+ Filho"). That was not enough — the shape
 * kept appearing:
 *
 *     - Ponto Inicial
 *       -
 *         -
 *           - outro
 *
 * Because the guards were per-key-path, any other route into the same state
 * (Tab re-indenting a blank row under another blank row, an import, a paste,
 * a restored map) reproduced it. Worse, the stack of blanks could not be
 * cleaned up afterwards either, because the cancel handler deliberately keeps
 * a blank node that HAS children — which is what made the mess permanent.
 *
 * So the invariant is enforced structurally instead of per key press: when a
 * blank node is found carrying children, they are lifted into its place. The
 * children keep their content and their relative order; only the empty
 * wrapper between them disappears. This is safe to run on EVERY tree update,
 * because it never removes a node that has text.
 *
 * The root is exempt: it holds the session date, and its first child is a
 * legitimate blank starting point.
 *
 * Returns the same object when nothing needed fixing, so callers can cheaply
 * skip a no-op update.
 */
export function normalizeOutline(root: MindMapNode): MindMapNode {
  const walk = (node: MindMapNode, isRoot: boolean): MindMapNode[] => {
    const out: MindMapNode[] = [];
    for (const rawChild of node.children || []) {
      for (const child of walk(rawChild, false)) {
        if (!isRoot && child.text.trim() === '' && (child.children || []).length > 0) {
          // A blank wrapper: splice its children in its place, one level up.
          out.push(...(child.children || []));
        } else {
          out.push(child);
        }
      }
    }
    if (out.length === (node.children || []).length && out.every((c, i) => c === (node.children || [])[i])) {
      return [node];
    }
    return [{ ...node, children: out }];
  };

  const [normalized] = walk(root, true);
  return normalized ?? root;
}

/**
 * Delete a node from the tree.
 * Root cannot be deleted (will just be cleared of children if requested).
 */
export function deleteNode(
  root: MindMapNode,
  targetId: string
): { root: MindMapNode; nextFocusId: string | null } {
  if (root.id === targetId) {
    // Cannot delete root, return same
    return { root, nextFocusId: root.id };
  }

  const pInfo = findParentAndIndex(root, targetId);
  if (!pInfo || !pInfo.parent) return { root, nextFocusId: null };

  const { parent, index } = pInfo;
  let nextFocusId: string = parent.id;
  if (index > 0) {
    nextFocusId = parent.children[index - 1].id;
  } else if (parent.children.length > 1) {
    nextFocusId = parent.children[1].id;
  }

  function remove(node: MindMapNode): MindMapNode {
    return {
      ...node,
      children: (node.children || [])
        .filter((child) => child.id !== targetId)
        .map(remove),
    };
  }

  return { root: remove(root), nextFocusId };
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
 *
 * Lives here rather than in either editor because both outline modes offer the
 * same move gesture: a shortcut that behaves differently depending on which
 * editor is open is worse than not having one.
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
