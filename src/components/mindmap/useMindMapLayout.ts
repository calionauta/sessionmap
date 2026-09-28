import { useMemo } from 'react';
import { MindMapNode } from '../../types';

export interface LayoutNode {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  side: 'center' | 'left' | 'right';
  depth: number;
  color: string;
  collapsed: boolean;
  hasChildren: boolean;
  childCount: number;
  parentId: string | null;
  node: MindMapNode;
}

export interface LayoutLink {
  id: string;
  source: { x: number; y: number; width: number; height: number; side: string };
  target: { x: number; y: number; width: number; height: number; side: string };
  path: string;
  color: string;
  isGhost?: boolean;
  isHighlighted?: boolean;
}

export interface GhostLayoutNode {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  side: 'left' | 'right';
  color: string;
  parentId: string;
}

// High-contrast, accessible editorial palette for therapeutic sessions (WCAG AA compliant)
export const BRANCH_PALETTE = [
  '#1D4ED8', // Deep Cobalt
  '#047857', // Deep Emerald
  '#B45309', // Warm Tobacco Amber
  '#6D28D9', // Deep Royal Violet
  '#BE185D', // Rich Crimson Rose
  '#0F766E', // Deep Teal
  '#C2410C', // Deep Terracotta
  '#334155', // Slate Steel
];

function approximateTextDimensions(text: string, isRoot: boolean = false, fontScale: number = 1.0) {
  const safeText = text || 'Novo ponto';
  const baseFontSize = (isRoot ? 17 : 14.5) * fontScale;
  const charWidth = baseFontSize * 0.58;
  
  // Max width constraint ~240px
  const maxContentWidth = 240 * fontScale;
  const paddingX = (isRoot ? 24 : 18) * fontScale * 2;
  const paddingY = (isRoot ? 16 : 10) * fontScale * 2;
  
  const estimatedLineWidth = safeText.length * charWidth;
  let finalWidth = Math.min(maxContentWidth, estimatedLineWidth + paddingX);
  finalWidth = Math.max(isRoot ? 110 : 80, finalWidth);

  // If text wraps to 2 lines
  const lines = estimatedLineWidth > (maxContentWidth - paddingX) ? 2 : 1;
  const lineHeight = baseFontSize * 1.35;
  const finalHeight = paddingY + lines * lineHeight;

  return { width: Math.round(finalWidth), height: Math.round(finalHeight), lines };
}

interface SubtreeLayout {
  node: MindMapNode;
  width: number;
  height: number;
  totalSubtreeHeight: number;
  children: SubtreeLayout[];
  side: 'left' | 'right';
  depth: number;
  color: string;
}

export function useMindMapLayout(
  root: MindMapNode,
  draft: {
    mode: 'add' | 'edit';
    parentId: string | null;
    targetId?: string | null;
    text: string;
    active: boolean;
  } | null,
  highlightedPath: string[] | null,
  fontScale: number = 1.0
) {
  return useMemo(() => {
    const nodes: LayoutNode[] = [];
    const links: LayoutLink[] = [];
    let ghostNode: GhostLayoutNode | null = null;
    let ghostLink: LayoutLink | null = null;

    if (!root) {
      return { nodes, links, ghostNode, ghostLink, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
    }

    // 1. Root dimensions
    const rootDims = approximateTextDimensions(root.text, true, fontScale);
    const rootLayoutNode: LayoutNode = {
      id: root.id,
      text: root.text,
      x: 0,
      y: 0,
      width: rootDims.width,
      height: rootDims.height,
      side: 'center',
      depth: 0,
      color: '#475569',
      collapsed: Boolean(root.collapsed),
      hasChildren: (root.children || []).length > 0,
      childCount: (root.children || []).length,
      parentId: null,
      node: root,
    };
    nodes.push(rootLayoutNode);

    if (root.collapsed || !root.children || root.children.length === 0) {
      // Check if draft points to root
      if (draft && draft.active && draft.mode === 'add' && draft.parentId === root.id) {
        const ghostDims = approximateTextDimensions(draft.text || 'novo ponto…', false, fontScale);
        ghostNode = {
          id: 'ghost_node',
          text: draft.text,
          x: rootDims.width / 2 + 80,
          y: 0,
          width: ghostDims.width,
          height: ghostDims.height,
          side: 'right',
          color: BRANCH_PALETTE[0],
          parentId: root.id,
        };
        const sx = rootDims.width / 2;
        const sy = 0;
        const tx = ghostNode.x - ghostNode.width / 2;
        const ty = 0;
        const cx1 = sx + (tx - sx) * 0.5;
        const cx2 = sx + (tx - sx) * 0.5;
        ghostLink = {
          id: 'ghost_link',
          source: { x: sx, y: sy, width: rootDims.width, height: rootDims.height, side: 'center' },
          target: { x: tx, y: ty, width: ghostNode.width, height: ghostNode.height, side: 'right' },
          path: `M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`,
          color: BRANCH_PALETTE[0],
          isGhost: true,
        };
      }
      return {
        nodes,
        links,
        ghostNode,
        ghostLink,
        bounds: {
          minX: -rootDims.width / 2 - 40,
          maxX: rootDims.width / 2 + (ghostNode ? ghostNode.width + 120 : 40),
          minY: -rootDims.height / 2 - 40,
          maxY: rootDims.height / 2 + 40,
        },
      };
    }

    // 2. Split top-level branches into Right and Left side
    const topChildren = root.children;
    const rightSubtrees: MindMapNode[] = [];
    const leftSubtrees: MindMapNode[] = [];

    topChildren.forEach((child, index) => {
      if (index % 2 === 0) {
        rightSubtrees.push(child);
      } else {
        leftSubtrees.push(child);
      }
    });

    const HORIZONTAL_LEVEL_GAP = 70 * fontScale;
    const VERTICAL_NODE_GAP = 18 * fontScale;

    // Helper: measure subtree vertical heights recursively
    function measureSubtree(
      node: MindMapNode,
      side: 'left' | 'right',
      depth: number,
      branchColor: string
    ): SubtreeLayout {
      const dims = approximateTextDimensions(node.text, false, fontScale);
      const isCollapsed = Boolean(node.collapsed);
      const validChildren = !isCollapsed && node.children ? node.children : [];

      const childrenLayouts = validChildren.map((c) =>
        measureSubtree(c, side, depth + 1, branchColor)
      );

      const childrenTotalHeight = childrenLayouts.reduce(
        (sum, c) => sum + c.totalSubtreeHeight,
        0
      ) + Math.max(0, childrenLayouts.length - 1) * VERTICAL_NODE_GAP;

      const totalSubtreeHeight = Math.max(dims.height, childrenTotalHeight);

      return {
        node,
        width: dims.width,
        height: dims.height,
        totalSubtreeHeight,
        children: childrenLayouts,
        side,
        depth,
        color: branchColor,
      };
    }

    // Measure right subtrees
    const measuredRight: SubtreeLayout[] = rightSubtrees.map((c, i) => {
      const color = c.color || BRANCH_PALETTE[(i * 2) % BRANCH_PALETTE.length];
      return measureSubtree(c, 'right', 1, color);
    });

    // Measure left subtrees
    const measuredLeft: SubtreeLayout[] = leftSubtrees.map((c, i) => {
      const color = c.color || BRANCH_PALETTE[(i * 2 + 1) % BRANCH_PALETTE.length];
      return measureSubtree(c, 'left', 1, color);
    });

    // Total height of right and left stacks
    const totalRightHeight =
      measuredRight.reduce((sum, c) => sum + c.totalSubtreeHeight, 0) +
      Math.max(0, measuredRight.length - 1) * VERTICAL_NODE_GAP;

    const totalLeftHeight =
      measuredLeft.reduce((sum, c) => sum + c.totalSubtreeHeight, 0) +
      Math.max(0, measuredLeft.length - 1) * VERTICAL_NODE_GAP;

    // Helper to position a subtree
    function placeSubtree(
      layout: SubtreeLayout,
      currentX: number,
      startY: number,
      parentLayoutNode: LayoutNode
    ) {
      const isRight = layout.side === 'right';
      const nodeX = isRight ? currentX + layout.width / 2 : currentX - layout.width / 2;
      const nodeY = startY + layout.totalSubtreeHeight / 2;

      const layoutNode: LayoutNode = {
        id: layout.node.id,
        text: layout.node.text,
        x: nodeX,
        y: nodeY,
        width: layout.width,
        height: layout.height,
        side: layout.side,
        depth: layout.depth,
        color: layout.color,
        collapsed: Boolean(layout.node.collapsed),
        hasChildren: (layout.node.children || []).length > 0,
        childCount: (layout.node.children || []).length,
        parentId: parentLayoutNode.id,
        node: layout.node,
      };
      nodes.push(layoutNode);

      // Create link from parent to this node
      // Source point (on outer edge of parent)
      const sx =
        parentLayoutNode.side === 'center'
          ? (isRight ? parentLayoutNode.width / 2 : -parentLayoutNode.width / 2)
          : (isRight ? parentLayoutNode.x + parentLayoutNode.width / 2 : parentLayoutNode.x - parentLayoutNode.width / 2);
      const sy = parentLayoutNode.y;

      // Target point (on inner edge of child)
      const tx = isRight ? nodeX - layout.width / 2 : nodeX + layout.width / 2;
      const ty = nodeY;

      // Cubic Bezier curve control points
      const dx = tx - sx;
      const cx1 = sx + dx * 0.45;
      const cx2 = sx + dx * 0.55;
      const path = `M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`;

      const isPathHighlighted =
        Boolean(highlightedPath && highlightedPath.includes(layout.node.id) && highlightedPath.includes(parentLayoutNode.id));

      links.push({
        id: `link_${parentLayoutNode.id}_${layout.node.id}`,
        source: {
          x: sx,
          y: sy,
          width: parentLayoutNode.width,
          height: parentLayoutNode.height,
          side: parentLayoutNode.side,
        },
        target: {
          x: tx,
          y: ty,
          width: layout.width,
          height: layout.height,
          side: layout.side,
        },
        path,
        color: layout.color,
        isHighlighted: isPathHighlighted,
      });

      // Place children
      if (!layout.node.collapsed && layout.children.length > 0) {
        let childCurrentY = startY;
        const nextX = isRight
          ? nodeX + layout.width / 2 + HORIZONTAL_LEVEL_GAP
          : nodeX - layout.width / 2 - HORIZONTAL_LEVEL_GAP;

        for (const childLayout of layout.children) {
          placeSubtree(childLayout, nextX, childCurrentY, layoutNode);
          childCurrentY += childLayout.totalSubtreeHeight + VERTICAL_NODE_GAP;
        }
      }
    }

    // Place Right side trees
    let rightYCursor = -totalRightHeight / 2;
    const rightInitialX = rootLayoutNode.width / 2 + HORIZONTAL_LEVEL_GAP;
    for (const tree of measuredRight) {
      placeSubtree(tree, rightInitialX, rightYCursor, rootLayoutNode);
      rightYCursor += tree.totalSubtreeHeight + VERTICAL_NODE_GAP;
    }

    // Place Left side trees
    let leftYCursor = -totalLeftHeight / 2;
    const leftInitialX = -rootLayoutNode.width / 2 - HORIZONTAL_LEVEL_GAP;
    for (const tree of measuredLeft) {
      placeSubtree(tree, leftInitialX, leftYCursor, rootLayoutNode);
      leftYCursor += tree.totalSubtreeHeight + VERTICAL_NODE_GAP;
    }

    // Check if there is an active draft ghost balloon to show!
    if (draft && draft.active && draft.mode === 'add' && draft.parentId) {
      const parentLayout = nodes.find((n) => n.id === draft.parentId);
      if (parentLayout) {
        const isRight = parentLayout.side === 'left' ? false : true;
        const ghostDims = approximateTextDimensions(draft.text || 'novo balão…', false, fontScale);
        
        // Find existing children of this parent in layout to position ghost right after them
        const siblingNodes = nodes.filter((n) => n.parentId === parentLayout.id);
        let ghostY = parentLayout.y;
        if (siblingNodes.length > 0) {
          const lastSibling = siblingNodes[siblingNodes.length - 1];
          ghostY = lastSibling.y + lastSibling.height / 2 + ghostDims.height / 2 + VERTICAL_NODE_GAP;
        }

        const ghostX = isRight
          ? (parentLayout.side === 'center' ? rootLayoutNode.width / 2 : parentLayout.x + parentLayout.width / 2) + HORIZONTAL_LEVEL_GAP + ghostDims.width / 2
          : parentLayout.x - parentLayout.width / 2 - HORIZONTAL_LEVEL_GAP - ghostDims.width / 2;

        ghostNode = {
          id: 'ghost_node',
          text: draft.text,
          x: ghostX,
          y: ghostY,
          width: ghostDims.width,
          height: ghostDims.height,
          side: isRight ? 'right' : 'left',
          color: parentLayout.color || BRANCH_PALETTE[0],
          parentId: parentLayout.id,
        };

        const sx = isRight
          ? (parentLayout.side === 'center' ? parentLayout.width / 2 : parentLayout.x + parentLayout.width / 2)
          : (parentLayout.side === 'center' ? -parentLayout.width / 2 : parentLayout.x - parentLayout.width / 2);
        const sy = parentLayout.y;

        const tx = isRight ? ghostX - ghostDims.width / 2 : ghostX + ghostDims.width / 2;
        const ty = ghostY;

        const dx = tx - sx;
        const cx1 = sx + dx * 0.45;
        const cx2 = sx + dx * 0.55;
        const path = `M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`;

        ghostLink = {
          id: 'ghost_link',
          source: {
            x: sx,
            y: sy,
            width: parentLayout.width,
            height: parentLayout.height,
            side: parentLayout.side,
          },
          target: {
            x: tx,
            y: ty,
            width: ghostDims.width,
            height: ghostDims.height,
            side: ghostNode.side,
          },
          path,
          color: parentLayout.color || BRANCH_PALETTE[0],
          isGhost: true,
        };
      }
    }

    // Compute bounding box
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;

    const allItems = [...nodes];
    if (ghostNode) {
      allItems.push({
        id: ghostNode.id,
        text: ghostNode.text,
        x: ghostNode.x,
        y: ghostNode.y,
        width: ghostNode.width,
        height: ghostNode.height,
        side: ghostNode.side,
        depth: 2,
        color: ghostNode.color,
        collapsed: false,
        hasChildren: false,
        childCount: 0,
        parentId: ghostNode.parentId,
        node: null as any,
      });
    }

    allItems.forEach((n) => {
      const left = n.x - n.width / 2;
      const right = n.x + n.width / 2;
      const top = n.y - n.height / 2;
      const bottom = n.y + n.height / 2;

      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    });

    const bounds = {
      minX: minX - 80,
      maxX: maxX + 80,
      minY: minY - 80,
      maxY: maxY + 80,
    };

    return { nodes, links, ghostNode, ghostLink, bounds };
  }, [root, draft, highlightedPath, fontScale]);
}
