import { FlatOutlineItem, MindMapNode } from '../types';

let idCounter = Date.now();
export function generateNodeId(): string {
  return `n_${(++idCounter).toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
}

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
 * Parse Markdown outline into a MindMapNode tree.
 * Supports:
 * # Title
 * - Item
 *   - Subitem
 * or indented lines.
 */
export function parseMarkdownToTree(text: string, defaultTitle: string = 'Novo Mapa'): MindMapNode {
  const lines = text.split('\n');
  let rootTitle = defaultTitle;
  const rawItems: { text: string; indent: number }[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check if line is title #
    if (trimmed.startsWith('#') && rawItems.length === 0) {
      rootTitle = trimmed.replace(/^#+\s*/, '').trim() || defaultTitle;
      continue;
    }

    // Calculate indent
    const leadingSpaces = rawLine.search(/\S/);
    const content = trimmed.replace(/^[-*+]\s*/, '').trim();
    if (!content) continue;

    // Normalize indent level (assume 2 or 4 spaces or 1 tab per level)
    const indent = Math.max(0, Math.floor(leadingSpaces / 2));
    rawItems.push({ text: content, indent });
  }

  const root: MindMapNode = {
    id: generateNodeId(),
    text: rootTitle,
    children: [],
  };

  if (rawItems.length === 0) return root;

  // Stack of parent nodes at each indent level
  const stack: { node: MindMapNode; indent: number }[] = [{ node: root, indent: -1 }];

  for (const item of rawItems) {
    const newNode: MindMapNode = {
      id: generateNodeId(),
      text: item.text,
      children: [],
    };

    // Pop stack until we find a parent with strictly smaller indent
    while (stack.length > 1 && stack[stack.length - 1].indent >= item.indent) {
      stack.pop();
    }

    const currentParent = stack[stack.length - 1].node;
    currentParent.children.push(newNode);
    stack.push({ node: newNode, indent: item.indent });
  }

  return root;
}
