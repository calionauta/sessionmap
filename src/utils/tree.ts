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
 * Why a move was refused.
 *
 * The reason lives with the operation because the operation is what refuses;
 * the sentence shown to the host for each one is UI policy and lives in
 * ./lift. Splitting them is not pedantry — the type is the operation's return
 * contract, and a test asserting on refusals should not have to import a
 * keyboard chord to read it.
 */
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
 * ONE destination and ONE position: the target becomes the LAST CHILD. Where
 * it sits among its new siblings is a separate question, answered by the
 * buffer's own indentation — write the text where you want it. A move that
 * could also land "before" or "after" would have three plausible outcomes per
 * gesture, and one of them is always a mistake.
 *
 * The whole tree is rebuilt in ONE pass, so the caller commits once. Two calls
 * (detach, then attach) would put two entries in the history stack and let the
 * client window receive an intermediate state where the subtree is gone.
 *
 * The new parent is force-expanded. A move into a collapsed parent would
 * otherwise leave the node present in the outline and invisible on the shared
 * screen, which is the worst failure available here.
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
   * Shift+Tab outdents for exactly that, so this path runs constantly — the
   * target is a
   * GRANDCHILD of the destination, and filtering each node's direct children
   * leaves the original in place. Re-attaching then gives the tree two nodes
   * with the same id: React reports duplicate keys, drops one, and the map
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
