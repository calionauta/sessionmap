import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Maximize2, Minus, Plus, RotateCcw, Target } from 'lucide-react';
import { MindMapNode } from '../../types';
import { useMindMapLayout } from './useMindMapLayout';
import { BalloonNode } from './BalloonNode';
import { findPathToNode } from '../../utils/tree';

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
  svgRef: externalSvgRef,
}) => {
  const localSvgRef = useRef<SVGSVGElement | null>(null);
  const svgRef = externalSvgRef || localSvgRef;
  const containerRef = useRef<HTMLDivElement | null>(null);

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
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const padding = 140;
      const scaleX = (containerW - padding * 2) / clusterW;
      const scaleY = (containerH - padding * 2) / clusterH;
      // Generous zoom-in for family focus
      const targetK = Math.min(1.65, Math.max(0.75, Math.min(scaleX, scaleY)));

      setTransform({
        x: containerW / 2 - centerX * targetK,
        y: containerH / 2 - centerY * targetK,
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

  // Mouse Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newK = Math.min(2.5, Math.max(0.3, transform.k * zoomFactor));

    const newX = mouseX - (mouseX - transform.x) * (newK / transform.k);
    const newY = mouseY - (mouseY - transform.y) * (newK / transform.k);

    setTransform({ x: newX, y: newY, k: newK });
  };

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
  const gridDotColor = isDark ? '#334155' : '#D1D5DB';

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`relative w-full h-full select-none overflow-hidden ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{
        backgroundColor: isDark ? '#0B0F17' : '#F7F6F2',
      }}
    >
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

        {/* Background Dots */}
        <rect
          width="100%"
          height="100%"
          fill={`url(#bg-dots-${theme})`}
          className="pointer-events-none"
        />

        {/* World Transform Group */}
        <g
          transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}
          style={{ transition: isDragging ? 'none' : 'transform 0.12s cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {/* Connector Links */}
          <g className="links-group">
            {links.map((link) => {
              const isHigh = link.isHighlighted;
              return (
                <g key={link.id}>
                  {isHigh && (
                    <path
                      d={link.path}
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth="6"
                      strokeOpacity="0.5"
                      strokeLinecap="round"
                    />
                  )}
                  <path
                    d={link.path}
                    fill="none"
                    stroke={isHigh ? '#D97706' : (isDark ? '#475569' : link.color)}
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
          <g className="nodes-group">
            {nodes.map((node) => {
              const isRoot = node.id === root.id;
              const isTargetParent = draft?.active && draft.mode === 'add' && draft.parentId === node.id;
              const isEditing = draft?.active && draft.mode === 'edit' && draft.targetId === node.id;
              const isSelected = selectedNodeId === node.id;

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
                  onNodeClick={onNodeClick}
                  onToggleCollapse={onToggleCollapse}
                />
              );
            })}

            {/* Ghost Balloon Node */}
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
                  node: null as any,
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

      {/* Floating Canvas Controls */}
      <div
        className={`absolute bottom-4 right-4 flex items-center gap-1 p-1 rounded-xl border shadow-md backdrop-blur-md transition-opacity ${
          isDark
            ? 'bg-slate-900/90 border-slate-700 text-slate-200'
            : 'bg-white/95 border-stone-300 text-stone-800'
        } ${readOnly ? 'opacity-40 hover:opacity-100' : 'opacity-90 hover:opacity-100'}`}
      >
        {/* Toggle Focus Zoom Mode Button */}
        {onToggleFocusZoomMode && (
          <>
            <button
              type="button"
              onClick={onToggleFocusZoomMode}
              title={
                focusZoomMode
                  ? 'Foco com Zoom ATIVADO (aproxima o nó, pais e filhos ao navegar no outline)'
                  : 'Ativar Foco com Zoom (aproxima nó + pais + filhos ao navegar)'
              }
              className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                focusZoomMode
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'hover:bg-black/5 dark:hover:bg-white/10 text-stone-600 dark:text-slate-300'
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              <span>Zoom no Foco</span>
            </button>
            <div className="w-[1px] h-4 bg-stone-300 dark:bg-slate-700 mx-0.5" />
          </>
        )}

        <button
          type="button"
          onClick={() =>
            setTransform((prev) => ({
              ...prev,
              k: Math.min(2.5, prev.k * 1.2),
            }))
          }
          title="Aumentar zoom (+)"
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            setTransform((prev) => ({
              ...prev,
              k: Math.max(0.3, prev.k * 0.8),
            }))
          }
          title="Diminuir zoom (-)"
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        <div className="w-[1px] h-4 bg-stone-300 dark:bg-slate-700 mx-0.5" />
        <button
          type="button"
          onClick={fitToScreen}
          title="Ajustar mapa à tela (Ctrl+0)"
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            setTransform({
              x: (containerRef.current?.clientWidth || 800) / 2,
              y: (containerRef.current?.clientHeight || 600) / 2,
              k: 1,
            })
          }
          title="Resetar zoom para 100%"
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
