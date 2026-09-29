import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Maximize2, Minus, Plus, RotateCcw, Target } from 'lucide-react';
import { MindMapNode } from '../../types';
import { useMindMapLayout } from './useMindMapLayout';
import { BalloonNode } from './BalloonNode';
import { findPathToNode } from '../../utils/tree';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 1.2;
const PAN_STEP = 60;

interface MindMapCanvasProps {
  root: MindMapNode;
  draft: {
    mode: 'add' | 'edit';
    parentId: string | null;
    targetId?: string | null;
    parentText?: string;
    text: string;
    active: boolean;
  } | null;
  selectedNodeId: string | null;
  highlightedPath: string[] | null;
  theme: 'papel' | 'noite';
  fontScale?: number;
  liveTextMode?: 'live' | 'confirm_only';
  readOnly?: boolean;
  clientName?: string;
  sessionDate?: string;
  focusZoomMode?: boolean;
  onToggleFocusZoomMode?: () => void;
  onNodeClick?: (nodeId: string) => void;
  onToggleCollapse?: (nodeId: string) => void;
  /**
   * Reports whether the node currently being edited is inside the visible
   * canvas. The floating "what am I editing" mirror uses it to stay out of the
   * way: the canvas already shows the target by highlighting and (with focus
   * zoom) centring it, so the mirror only earns its space when the target is
   * off-screen. See TherapistView for the collision this removes.
   */
  onEditTargetVisibleChange?: (visible: boolean) => void;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

export const MindMapCanvas: React.FC<MindMapCanvasProps> = ({
  root,
  draft,
  selectedNodeId,
  highlightedPath,
  theme,
  fontScale = 1.0,
  liveTextMode = 'live',
  readOnly = false,
  clientName,
  sessionDate,
  focusZoomMode = false,
  onToggleFocusZoomMode,
  onNodeClick,
  onToggleCollapse,
  onEditTargetVisibleChange,
  svgRef: externalSvgRef,
}) => {
  const localSvgRef = useRef<SVGSVGElement | null>(null);
  const svgRef = externalSvgRef || localSvgRef;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Record<string, SVGGElement | null>>({});

  const [transform, setTransform] = useState<{ x: number; y: number; k: number }>({
    x: 0,
    y: 0,
    k: 1,
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  const { nodes, links, ghostNode, ghostLink, bounds } = useMindMapLayout(
    root,
    draft,
    highlightedPath,
    fontScale
  );

  // Roving tabindex: the single node that is reachable with Tab.
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  // Visual (top-to-bottom) order of the visible nodes — Up/Down follows
  // what the user sees, not the depth-first order the layout emits.
  const navOrder = useMemo(
    () => [...nodes].sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.id),
    [nodes]
  );

  // Sibling position of every node, for aria-posinset / aria-setsize.
  const siblingInfo = useMemo(() => {
    const map = new Map<string, { pos: number; size: number }>();
    const groups = new Map<string | null, string[]>();
    nodes.forEach((n) => {
      const list = groups.get(n.parentId);
      if (list) list.push(n.id);
      else groups.set(n.parentId, [n.id]);
    });
    groups.forEach((ids) => {
      ids.forEach((id, i) => map.set(id, { pos: i + 1, size: ids.length }));
    });
    return map;
  }, [nodes]);

  // The roving target must always exist: if it was collapsed away, fall back
  // to the selection or the root so the map never has zero tabbable nodes.
  useEffect(() => {
    if (nodes.length === 0) return;
    if (activeNodeId && nodes.some((n) => n.id === activeNodeId)) return;
    const keepSelection = selectedNodeId && nodes.some((n) => n.id === selectedNodeId);
    setActiveNodeId(keepSelection ? selectedNodeId : nodes[0].id);
  }, [nodes, activeNodeId, selectedNodeId]);

  const focusNode = useCallback((nodeId: string) => {
    setActiveNodeId(nodeId);
    // Roving tabindex + imperative move: the DOM node already exists, the
    // scroll-into-view is the browser's job once it takes focus.
    nodeRefs.current[nodeId]?.focus();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setTransform((prev) => ({
      ...prev,
      k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * factor)),
    }));
  }, []);

  const resetZoom = useCallback(() => {
    setTransform({
      x: (containerRef.current?.clientWidth || 800) / 2,
      y: (containerRef.current?.clientHeight || 600) / 2,
      k: 1,
    });
  }, []);

  // Center & Fit entire map
  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const bWidth = Math.max(200, bounds.maxX - bounds.minX);
    const bHeight = Math.max(200, bounds.maxY - bounds.minY);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    const padding = 100;
    const scaleX = (width - padding * 2) / bWidth;
    const scaleY = (height - padding * 2) / bHeight;
    const nextK = Math.min(1.4, Math.max(0.4, Math.min(scaleX, scaleY)));

    setTransform({
      x: width / 2 - centerX * nextK,
      y: height / 2 - centerY * nextK,
      k: nextK,
    });
  }, [bounds]);

  // Initial fit when switching maps
  useEffect(() => {
    fitToScreen();
  }, [root.id]);

  // The canvas is a percentage of a resizable split, so it is resized by
  // dragging a divider, maximising it, or a layout collapse — never by a
  // window resize event, and nothing in the app fires one. Without this the
  // map kept its old transform and sat half off-screen after the pane changed.
  // A change under 24px is ignored (a scrollbar, a 1px nudge) so the map does
  // not re-fit on every keystroke-driven relayout; a real change re-frames the
  // map, which is the right trade — a half-visible map is worse than losing a
  // manual pan.
  const fitRef = useRef(fitToScreen);
  useEffect(() => {
    fitRef.current = fitToScreen;
  });
  const lastFitSizeRef = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      const last = lastFitSizeRef.current;
      if (last && Math.abs(w - last.w) < 24 && Math.abs(h - last.h) < 24) return;
      lastFitSizeRef.current = { w, h };
      fitRef.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Focus Zoom Mode: Zoom in on node + parents + children!
  useEffect(() => {
    if (!selectedNodeId || !containerRef.current) return;
    const selectedLayout = nodes.find((n) => n.id === selectedNodeId);
    if (!selectedLayout) return;

    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;

    if (focusZoomMode) {
      // Find family cluster: selected node + its direct children + ancestors to root
      const ancestorIds = findPathToNode(root, selectedNodeId) || [];
      const childLayouts = nodes.filter((n) => n.parentId === selectedNodeId);
      const ancestorLayouts = nodes.filter((n) => ancestorIds.includes(n.id));

      const cluster = [selectedLayout, ...childLayouts, ...ancestorLayouts];

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      cluster.forEach((n) => {
        const left = n.x - n.width / 2;
        const right = n.x + n.width / 2;
        const top = n.y - n.height / 2;
        const bottom = n.y + n.height / 2;
        if (left < minX) minX = left;
        if (right > maxX) maxX = right;
        if (top < minY) minY = top;
        if (bottom > maxY) maxY = bottom;
      });

      const clusterW = Math.max(300, maxX - minX);
      const clusterH = Math.max(220, maxY - minY);

      const padding = 140;
      const scaleX = (containerW - padding * 2) / clusterW;
      const scaleY = (containerH - padding * 2) / clusterH;
      // Generous zoom-in for family focus
      const targetK = Math.min(1.65, Math.max(0.75, Math.min(scaleX, scaleY)));

      // Centre the SELECTED NODE, not the cluster's bounding box.
      //
      // Centring the box was the bug: a node with many children reaching
      // right and few ancestors reaching left is the common shape, and the
      // box centre then sits well to the right of the node the therapist is
      // actually on. "Focus" that puts the subject off-centre is not focus.
      //
      // The scale still comes from the cluster, so the zoom level keeps
      // adapting to how much context this node carries — a leaf stays
      // readable instead of being magnified for context it does not have.
      // Trade-off, stated plainly: if the context is far wider than the
      // viewport even at the minimum scale, some of it goes off-screen. That
      // is the correct trade, because the node you are on stays in the same
      // place every time, and the context that spills is what you pan to
      // deliberately.
      setTransform({
        x: containerW / 2 - selectedLayout.x * targetK,
        y: containerH / 2 - selectedLayout.y * targetK,
        k: targetK,
      });
    } else {
      // Smoothly pan and center directly on selected node with zero latency!
      setTransform((prev) => ({
        ...prev,
        x: containerW / 2 - selectedLayout.x * prev.k,
        y: containerH / 2 - selectedLayout.y * prev.k,
      }));
    }
  }, [selectedNodeId, focusZoomMode, nodes, root]);

  /**
   * Is the node being edited actually on screen?
   *
   * Screen position of a node is world position through the current
   * transform: sx = x * k + translateX. The node counts as visible when its
   * whole box lands inside the container, so a balloon half off the edge does
   * not count as "you can see it".
   *
   * Reported rather than rendered here so the decision lives with the
   * component that owns the floating mirror.
   */
  const editTargetId = draft?.active ? (draft.targetId ?? null) : null;
  useEffect(() => {
    if (!onEditTargetVisibleChange) return;
    const el = containerRef.current;
    if (!editTargetId || !el) {
      onEditTargetVisibleChange(true);
      return;
    }
    const layout = nodes.find((n) => n.id === editTargetId);
    if (!layout) {
      onEditTargetVisibleChange(true);
      return;
    }
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) {
      onEditTargetVisibleChange(true);
      return;
    }
    const halfW = (layout.width / 2) * transform.k;
    const halfH = (layout.height / 2) * transform.k;
    const sx = layout.x * transform.k + transform.x;
    const sy = layout.y * transform.k + transform.y;
    const visible =
      sx - halfW >= 0 && sx + halfW <= w && sy - halfH >= 0 && sy + halfH <= h;
    onEditTargetVisibleChange(visible);
  }, [editTargetId, nodes, transform, onEditTargetVisibleChange]);

  // Mouse Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.k * zoomFactor));

    const newX = mouseX - (mouseX - transform.x) * (newK / transform.k);
    const newY = mouseY - (mouseY - transform.y) * (newK / transform.k);

    setTransform({ x: newX, y: newY, k: newK });
  };

  // Keyboard equivalent of the wheel/drag: zoom on +/-, pan on the arrows
  // while the container itself holds focus (a focused node owns the arrows).
  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '0') {
        e.preventDefault();
        fitToScreen();
      }
      return;
    }

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        zoomBy(ZOOM_STEP);
        return;
      case '-':
      case '_':
        e.preventDefault();
        zoomBy(1 / ZOOM_STEP);
        return;
      default:
        break;
    }

    if (e.target !== containerRef.current) return;

    const pan = (dx: number, dy: number) => {
      e.preventDefault();
      setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    };

    switch (e.key) {
      case 'ArrowLeft':
        pan(PAN_STEP, 0);
        break;
      case 'ArrowRight':
        pan(-PAN_STEP, 0);
        break;
      case 'ArrowUp':
        pan(0, PAN_STEP);
        break;
      case 'ArrowDown':
        pan(0, -PAN_STEP);
        break;
      default:
        break;
    }
  };

  // Tree navigation on the focused node (WAI-ARIA tree pattern).
  const handleNodeKeyDown = useCallback(
    (nodeId: string, e: React.KeyboardEvent) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const index = navOrder.indexOf(nodeId);
      e.stopPropagation();

      const firstChild = nodes.find((n) => n.parentId === nodeId);

      switch (e.key) {
        case 'ArrowDown':
          if (index >= 0 && index < navOrder.length - 1) {
            e.preventDefault();
            focusNode(navOrder[index + 1]);
          }
          break;
        case 'ArrowUp':
          if (index > 0) {
            e.preventDefault();
            focusNode(navOrder[index - 1]);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (node.hasChildren && node.collapsed) {
            // No handler means the read-only client window: expanding is not
            // offered, so the key does nothing rather than implying it can.
            onToggleCollapse?.(nodeId);
          } else if (firstChild) {
            focusNode(firstChild.id);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (node.hasChildren && !node.collapsed) {
            onToggleCollapse?.(nodeId);
            if (node.parentId) focusNode(node.parentId);
          } else if (node.parentId) {
            focusNode(node.parentId);
          }
          break;
        case 'Home':
          if (navOrder.length) {
            e.preventDefault();
            focusNode(navOrder[0]);
          }
          break;
        case 'End':
          if (navOrder.length) {
            e.preventDefault();
            focusNode(navOrder[navOrder.length - 1]);
          }
          break;
        case 'Enter':
        case ' ':
          // Always swallowed: Space would otherwise scroll the page out from
          // under the map when the canvas is read-only (client window).
          e.preventDefault();
          onNodeClick?.(nodeId);
          break;
        default:
          break;
      }
    },
    [nodes, navOrder, focusNode, onNodeClick, onToggleCollapse]
  );

  // Pointer Down (Pan drag)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: transform.x,
      initialY: transform.y,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    setTransform((prev) => ({
      ...prev,
      x: dragStartRef.current.initialX + dx,
      y: dragStartRef.current.initialY + dy,
    }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
  };

  const isDark = theme === 'noite';

  // SVG geometry cannot take a Tailwind class, but it does resolve CSS custom
  // properties, so the canvas reads the same tokens as the rest of the app
  // rather than carrying its own hex literals.
  //
  // SC 1.4.11 (3:1 against --surface):
  //   connector  var(--border)            4.85:1 papel · 4.04:1 noite
  //   highlight  var(--accent-text)       5.02:1 papel · 11.11:1 noite
  // Decorative only (background texture, and the wide glow under the
  // highlighted path) stays exempt.
  const gridDotColor = 'var(--border-muted)';
  const connectorColor = 'var(--border)';
  const highlightStroke = 'var(--accent-text)';

  const mapLabel = clientName
    ? `Mapa mental da sessão com ${clientName}${sessionDate ? `, ${sessionDate}` : ''}`
    : 'Mapa mental da sessão';

  return (
    <div
      ref={containerRef}
      role="application"
      tabIndex={0}
      aria-label={mapLabel}
      aria-describedby="mapa-teclas"
      onKeyDown={handleContainerKeyDown}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      /* The canvas is a percentage of a resizable split, so its usable width
         is not the viewport width: at 1280px it can be 793px (62% pane) or
         1280px (maximised) and at 375px it is 233px. A viewport breakpoint
         cannot tell those apart — a container query can, and Tailwind v4 ships
         `@container` + the `@min-*` variants, so nothing is hand-written and
         index.css stays untouched. */
      className={`@container relative w-full h-full select-none overflow-hidden bg-surface ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* Describes only the keys that actually work in this instance. The
          read-only client window has no onToggleCollapse, so promising
          "seta para a direita abre" there is a false instruction read out to
          a screen-reader user on every focus. */}
      <p id="mapa-teclas" className="sr-only">
        {onToggleCollapse
          ? 'Use Tab para entrar no mapa. Com um ponto selecionado, as setas para cima e para baixo movem entre os pontos visíveis, a seta para a direita abre ou entra no primeiro filho, a seta para a esquerda fecha ou volta ao pai, e Enter ou Espaço selecionam o ponto em modo edição. Com o mapa selecionado, use mais e menos para ajustar o zoom, as setas para deslocar e Ctrl+0 para enquadrar tudo.'
          : 'Use Tab para entrar no mapa. Com um ponto selecionado, as setas para cima e para baixo movem entre os pontos visíveis e Enter ou Espaço selecionam o ponto. Com o mapa selecionado, use mais e menos para ajustar o zoom, as setas para deslocar e Ctrl+0 para enquadrar tudo.'}
      </p>

      <svg
        ref={svgRef}
        className="w-full h-full block"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id={`bg-dots-${theme}`}
            x="0"
            y="0"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1.3" fill={gridDotColor} opacity="0.6" />
          </pattern>
        </defs>

        {/* Background Dots — decorative texture, hidden from AT */}
        <rect
          width="100%"
          height="100%"
          fill={`url(#bg-dots-${theme})`}
          className="pointer-events-none"
          aria-hidden="true"
        />

        {/* World Transform Group */}
        <g
          /* Marks the group the pan/zoom applies to. The image export reads
             this to measure the content in its own coordinates instead of the
             camera's, so the exported frame follows the map, not the view. */
          data-world="true"
          transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}
          style={{ transition: isDragging ? 'none' : 'transform 0.12s cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {/* Connector Links — the tree structure is carried by
              aria-level/posinset, so the curves are hidden from AT. */}
          <g className="links-group" aria-hidden="true">
            {links.map((link) => {
              const isHigh = link.isHighlighted;
              return (
                <g key={link.id}>
                  {isHigh && (
                    <path
                      d={link.path}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="6"
                      strokeOpacity="0.5"
                      strokeLinecap="round"
                    />
                  )}
                  <path
                    d={link.path}
                    fill="none"
                    /* Papel: the branch palette, which measures 4.64:1-9.58:1
                       as a 2.2px stroke on --surface. Noite: the palette is far
                       too dark on a dark canvas, so connectors take the neutral
                       --border token instead. */
                    stroke={isHigh ? highlightStroke : (isDark ? connectorColor : link.color)}
                    strokeWidth={isHigh ? 3.5 : 2.2}
                    strokeOpacity={isHigh ? 1 : 0.9}
                    strokeLinecap="round"
                    className="transition-colors duration-300"
                  />
                </g>
              );
            })}

            {/* Ghost Connector Link */}
            {ghostLink && (
              <path
                d={ghostLink.path}
                fill="none"
                stroke={ghostLink.color}
                strokeWidth="2.2"
                strokeDasharray="5 4"
                strokeOpacity="0.85"
                strokeLinecap="round"
                className="animate-pulse"
              />
            )}
          </g>

          {/* Balloon Nodes */}
          <g
            className="nodes-group"
            role="tree"
            aria-label="Pontos do mapa"
            aria-orientation="horizontal"
          >
            {nodes.map((node) => {
              const isRoot = node.id === root.id;
              const isTargetParent = draft?.active && draft.mode === 'add' && draft.parentId === node.id;
              const isEditing = draft?.active && draft.mode === 'edit' && draft.targetId === node.id;
              const isSelected = selectedNodeId === node.id;
              const siblings = siblingInfo.get(node.id);

              return (
                <BalloonNode
                  key={node.id}
                  layoutNode={node}
                  isRoot={isRoot}
                  isTargetParent={isTargetParent}
                  isEditing={isEditing}
                  isSelected={isSelected}
                  theme={theme}
                  fontScale={fontScale}
                  liveTextMode={liveTextMode}
                  isFocusTarget={node.id === activeNodeId}
                  level={node.depth + 1}
                  posInSet={siblings?.pos ?? 1}
                  setSize={siblings?.size ?? 1}
                  nodeRef={(el) => {
                    nodeRefs.current[node.id] = el;
                  }}
                  onNodeFocus={setActiveNodeId}
                  onNodeKeyDown={handleNodeKeyDown}
                  onNodeClick={onNodeClick}
                  onToggleCollapse={onToggleCollapse}
                />
              );
            })}

            {/* Ghost Balloon Node — a preview of a node that does not exist
                yet, so it is not part of the tree. */}
            {ghostNode && (
              <BalloonNode
                key={ghostNode.id}
                layoutNode={{
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
                  node: {
                    id: ghostNode.id,
                    text: ghostNode.text,
                    collapsed: false,
                    color: ghostNode.color,
                    children: [],
                  },
                }}
                isGhost={true}
                ghostText={ghostNode.text}
                theme={theme}
                fontScale={fontScale}
                liveTextMode={liveTextMode}
              />
            )}
          </g>
        </g>
      </svg>

      {/* Floating Canvas Controls.
          Every button clears the 44px touch floor (min-w/min-h-touch, the
          `--spacing-touch` token = 2.75rem). The cluster wraps and caps its own
          width instead of overflowing, and the one text label is dropped on a
          narrow canvas — decided by the canvas width, not the viewport, so the
          same 5 buttons read as a label + 4 icons on a wide pane and as 5
          icons on a 233px one without a horizontal scrollbar either way. */}
      <div
        className="absolute bottom-4 right-4 flex max-w-[calc(100%-2rem)] flex-wrap items-center justify-end gap-0.5 rounded-panel border border-line bg-surface-raised p-1 text-content shadow-md"
      >
        {/* Toggle Focus Zoom Mode Button */}
        {onToggleFocusZoomMode && !readOnly && (
          <>
            <button
              type="button"
              onClick={onToggleFocusZoomMode}
              aria-pressed={focusZoomMode}
              aria-label="Zoom no Foco"
              title={
                focusZoomMode
                  ? 'Foco com Zoom ATIVADO (aproxima o nó, pais e filhos ao navegar no outline)'
                  : 'Ativar Foco com Zoom (aproxima nó + pais + filhos ao navegar)'
              }
              className={`flex min-h-touch min-w-touch items-center justify-center gap-1 rounded-control px-2.5 text-xs font-semibold transition-colors @min-[24rem]:px-3 ${
                focusZoomMode
                  ? 'bg-accent text-content-onaccent shadow-xs'
                  : 'hover:bg-content/10 text-content-muted'
              }`}
            >
              <Target className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden whitespace-nowrap @min-[24rem]:inline">Zoom no Foco</span>
            </button>
            <div className="mx-0.5 h-6 w-px shrink-0 bg-line-muted" aria-hidden="true" />
          </>
        )}

        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={transform.k >= MAX_ZOOM}
          aria-label="Aumentar zoom"
          title="Aumentar zoom (+)"
          className="flex min-h-touch min-w-touch items-center justify-center rounded-control hover:bg-content/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={transform.k <= MIN_ZOOM}
          aria-label="Diminuir zoom"
          title="Diminuir zoom (-)"
          className="flex min-h-touch min-w-touch items-center justify-center rounded-control hover:bg-content/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          <Minus className="w-4 h-4" aria-hidden="true" />
        </button>
        <div className="mx-0.5 h-6 w-px shrink-0 bg-line-muted" aria-hidden="true" />
        <button
          type="button"
          onClick={fitToScreen}
          aria-label="Ajustar mapa à tela"
          title="Ajustar mapa à tela (Ctrl+0)"
          className="flex min-h-touch min-w-touch items-center justify-center rounded-control hover:bg-content/10 transition-colors"
        >
          <Maximize2 className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={resetZoom}
          aria-label="Resetar zoom para 100%"
          title="Resetar zoom para 100%"
          className="flex min-h-touch min-w-touch items-center justify-center rounded-control hover:bg-content/10 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
