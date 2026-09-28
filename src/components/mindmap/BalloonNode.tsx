import React from 'react';
import { LayoutNode } from './useMindMapLayout';

interface BalloonNodeProps {
  layoutNode: LayoutNode;
  isRoot?: boolean;
  isTargetParent?: boolean;
  isEditing?: boolean;
  isSelected?: boolean;
  isGhost?: boolean;
  ghostText?: string;
  theme: 'papel' | 'noite';
  fontScale?: number;
  liveTextMode?: 'live' | 'confirm_only';
  onNodeClick?: (nodeId: string) => void;
  onToggleCollapse?: (nodeId: string) => void;
}

export const BalloonNode: React.FC<BalloonNodeProps> = ({
  layoutNode,
  isRoot = false,
  isTargetParent = false,
  isEditing = false,
  isSelected = false,
  isGhost = false,
  ghostText = '',
  theme,
  fontScale = 1.0,
  liveTextMode = 'live',
  onNodeClick,
  onToggleCollapse,
}) => {
  const { x, y, width, height, text, color, collapsed, hasChildren, childCount } = layoutNode;
  const isDark = theme === 'noite';

  // Compute text lines (max 2 lines)
  const displayText = isGhost
    ? (liveTextMode === 'confirm_only' ? 'digitando…' : (ghostText || 'novo ponto…'))
    : (text || 'Sem título');

  // Split into lines if needed
  const charsPerLine = Math.max(16, Math.floor(width / (9 * fontScale)));
  let line1 = displayText;
  let line2 = '';

  if (displayText.length > charsPerLine) {
    const spaceIdx = displayText.lastIndexOf(' ', charsPerLine);
    if (spaceIdx > 6) {
      line1 = displayText.substring(0, spaceIdx);
      line2 = displayText.substring(spaceIdx + 1);
    } else {
      line1 = displayText.substring(0, charsPerLine);
      line2 = displayText.substring(charsPerLine);
    }
    // Truncate line 2 if still too long
    if (line2.length > charsPerLine + 6) {
      line2 = line2.substring(0, charsPerLine + 3) + '…';
    }
  }

  const hasTwoLines = Boolean(line2);
  const fontSize = (isRoot ? 16 : 13.5) * fontScale;
  const lineHeight = fontSize * 1.35;

  // Background and border styling based on theme and role
  let fillColor = isDark ? '#1E293B' : '#FFFFFF';
  let strokeColor = color || (isDark ? '#64748B' : '#334155');
  let textColor = isDark ? '#FFFFFF' : '#090D16';
  let strokeWidth = 2.2;

  if (isRoot) {
    fillColor = isDark ? '#020617' : '#0F172A';
    strokeColor = isDark ? '#38BDF8' : '#0F172A';
    strokeWidth = 2.5;
    textColor = '#FFFFFF';
  } else if (color) {
    if (isDark) {
      fillColor = '#151D2C';
      strokeColor = color;
      strokeWidth = 2.2;
      textColor = '#FFFFFF';
    } else {
      fillColor = '#FFFFFF';
      strokeColor = color;
      strokeWidth = 2.2;
      textColor = '#090D16';
    }
  }

  if (isGhost) {
    fillColor = isDark ? '#1E293B' : '#FFFFFF';
    strokeColor = color || '#2563EB';
    strokeWidth = 2;
  }

  const rx = isRoot ? 24 : 18;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      className={`transition-transform duration-300 ease-out select-none ${
        onNodeClick ? 'cursor-pointer' : ''
      }`}
      onClick={(e) => {
        if (onNodeClick && !isGhost) {
          e.stopPropagation();
          onNodeClick(layoutNode.id);
        }
      }}
    >
      {/* 3s Focus Selected Halo / Glow */}
      {isSelected && (
        <>
          <rect
            x={-width / 2 - 6}
            y={-height / 2 - 6}
            width={width + 12}
            height={height + 12}
            rx={rx + 4}
            ry={rx + 4}
            fill="none"
            stroke="#F59E0B"
            strokeWidth="3.5"
            strokeOpacity="0.8"
            className="animate-pulse"
          />
          <rect
            x={-width / 2 - 11}
            y={-height / 2 - 11}
            width={width + 22}
            height={height + 22}
            rx={rx + 8}
            ry={rx + 8}
            fill="none"
            stroke="#FBBF24"
            strokeWidth="1.5"
            strokeOpacity="0.4"
          />
        </>
      )}

      {/* Target Parent Highlight (receiving new child) */}
      {isTargetParent && !isSelected && (
        <rect
          x={-width / 2 - 5}
          y={-height / 2 - 5}
          width={width + 10}
          height={height + 10}
          rx={rx + 3}
          ry={rx + 3}
          fill="none"
          stroke={color || '#2563EB'}
          strokeWidth="2.5"
          strokeDasharray="4 3"
          className="animate-pulse"
        />
      )}

      {/* Editing active node highlight */}
      {isEditing && !isSelected && (
        <rect
          x={-width / 2 - 4}
          y={-height / 2 - 4}
          width={width + 8}
          height={height + 8}
          rx={rx + 2}
          ry={rx + 2}
          fill="none"
          stroke="#3B82F6"
          strokeWidth="2.5"
        />
      )}

      {/* Base Balloon Pill Shadow & Fill */}
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={rx}
        ry={rx}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={isGhost ? '5 4' : undefined}
        filter={isDark ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' : 'drop-shadow(0 2px 4px rgba(0,0,0,0.06))'}
        className="transition-colors duration-200"
      />

      {/* Target Parent Badge Pill Tag */}
      {isTargetParent && (
        <g transform={`translate(0, ${-height / 2 - 10})`}>
          <rect
            x="-26"
            y="-8"
            width="52"
            height="16"
            rx="8"
            ry="8"
            fill={isDark ? '#1E293B' : '#EFF6FF'}
            stroke={color || '#2563EB'}
            strokeWidth="1"
          />
          <text
            x="0"
            y="3"
            textAnchor="middle"
            fill={color || '#2563EB'}
            fontSize="9"
            fontWeight="700"
            className="tracking-wider uppercase"
          >
            destino
          </text>
        </g>
      )}

      {/* Node Text */}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill={textColor}
        fontSize={fontSize}
        fontWeight={isRoot ? '800' : '600'}
        className="font-sans pointer-events-none tracking-tight"
      >
        {hasTwoLines ? (
          <>
            <tspan x="0" y={-lineHeight * 0.45}>
              {line1}
            </tspan>
            <tspan x="0" y={lineHeight * 0.55}>
              {line2}
              {isGhost && liveTextMode === 'live' && (
                <tspan fill="#3B82F6" className="animate-ping font-mono">
                  ▌
                </tspan>
              )}
            </tspan>
          </>
        ) : (
          <tspan x="0" y="0">
            {line1}
            {isGhost && liveTextMode === 'live' && (
              <tspan fill="#3B82F6" className="animate-ping font-mono">
                ▌
              </tspan>
            )}
          </tspan>
        )}
      </text>

      {/* Collapsed Children Badge (+N) */}
      {collapsed && hasChildren && onToggleCollapse && (
        <g
          transform={`translate(${width / 2 + 10}, 0)`}
          className="cursor-pointer hover:opacity-90"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(layoutNode.id);
          }}
        >
          <circle
            r="11"
            fill={color || '#3B82F6'}
            stroke={isDark ? '#0F172A' : '#FFFFFF'}
            strokeWidth="2"
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="#FFFFFF"
            fontSize="10"
            fontWeight="700"
            className="font-mono pointer-events-none"
          >
            +{childCount}
          </text>
        </g>
      )}
    </g>
  );
};
