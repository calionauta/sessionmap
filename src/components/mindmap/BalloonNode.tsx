import React from 'react';
import { BRANCH_PALETTE, LayoutNode, themeColor } from './useMindMapLayout';

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
  /** Roving tabindex: exactly one node in the map is tabbable at a time. */
  isFocusTarget?: boolean;
  /** 1-based depth, exposed as aria-level. */
  level?: number;
  posInSet?: number;
  setSize?: number;
  nodeRef?: React.Ref<SVGGElement>;
  onNodeFocus?: (nodeId: string) => void;
  onNodeKeyDown?: (nodeId: string, e: React.KeyboardEvent) => void;
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
  isFocusTarget = true,
  level = 1,
  posInSet = 1,
  setSize = 1,
  nodeRef,
  onNodeFocus,
  onNodeKeyDown,
  onNodeClick,
  onToggleCollapse,
}) => {
  const { x, y, width, height, text, color, collapsed, hasChildren, childCount } = layoutNode;
  const isDark = theme === 'noite';

  // Expand/collapse is only reachable when a handler was supplied, which the
  // read-only client window deliberately does not do.
  const collapsible = Boolean(onToggleCollapse) && hasChildren;

  // A saved node colour is canonical in BRANCH_PALETTE; the night ramp is
  // applied here at paint time so a map authored in one theme stays legible
  // in the other. See themeColor() for why this is not a data migration.
  const branchColor = color ? themeColor(color, theme) : null;

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
  // Fills are literal on purpose: the balloons sit on the SVG canvas, not on
  // a DOM surface, and their text pair is the one that matters most in the
  // app (the client reads them across a room).
  //   texto do balão   #FFFFFF on #1E293B 16.88:1 · #151D2C 20.17:1 ·
  //                    #020617 21.00:1 (noite)  ·  #090D16 on #FFFFFF 19.43:1 (papel)
  //   contorno         var(--border) 4.85:1 / 4.04:1 on the canvas
  let fillColor = isDark ? '#1E293B' : '#FFFFFF';
  let strokeColor = branchColor || 'var(--border)';
  let textColor = isDark ? '#FFFFFF' : '#090D16';
  let strokeWidth = 2.2;

  if (isRoot) {
    // Root is the one inverted balloon: a dark pill in BOTH themes, so it
    // reads as the anchor rather than as another branch. White on it is
    // 18.37:1 (papel) / 21.00:1 (noite).
    fillColor = isDark ? '#020617' : '#0F172A';
    strokeColor = 'var(--accent-text)';
    strokeWidth = 2.5;
    textColor = '#FFFFFF';
  } else if (branchColor) {
    if (isDark) {
      fillColor = '#151D2C';
      strokeColor = branchColor;
      strokeWidth = 2.2;
      textColor = '#FFFFFF';
    } else {
      fillColor = '#FFFFFF';
      strokeColor = branchColor;
      strokeWidth = 2.2;
      textColor = '#090D16';
    }
  }

  if (isGhost) {
    fillColor = isDark ? '#1E293B' : '#FFFFFF';
    strokeColor = branchColor || BRANCH_PALETTE[0];
    strokeWidth = 2;
  }

  const rx = isRoot ? 24 : 18;

  // Selection / focus ring. Must clear SC 1.4.11 (3:1) against the canvas AND
  // against the balloon fill it encircles — --accent-text measures 5.02:1 /
  // 11.11:1 on the canvas and 5.02:1 on a white fill. Shape (solid vs dashed)
  // carries the state too, so it survives Windows High Contrast and SC 1.4.1.
  const ringColor = 'var(--accent-text)';
  // The +N badge is small (11px bold), so it needs a fill the white text
  // clears 4.5:1 on. Every BRANCH_PALETTE entry is dark and saturated, which
  // is right for the connector strokes but not for white text: BRANCH_PALETTE[0]
  // (#1D4ED8) only gives 6.30:1, and the old hard-coded #3B82F6 fallback gave
  // 3.68:1 and failed. Inverting the badge to the canvas colour with the
  // accent-text label makes it readable in both themes and independent of which
  // branch colour the node happens to carry.
  const badgeFill = 'var(--surface)';
  const badgeStroke = 'var(--accent-text)';
  const badgeLabel = 'var(--accent-text)';

  return (
    <g
      ref={nodeRef}
      transform={`translate(${x}, ${y})`}
      className={`group transition-transform duration-300 ease-out select-none ${
        onNodeClick ? 'cursor-pointer' : ''
      }`}
      data-node-id={layoutNode.id}
      role={isGhost ? undefined : 'treeitem'}
      tabIndex={isGhost ? undefined : isFocusTarget ? 0 : -1}
      aria-level={isGhost ? undefined : level}
      aria-posinset={isGhost || setSize < 2 ? undefined : posInSet}
      aria-setsize={isGhost || setSize < 2 ? undefined : setSize}
      // Only announce a collapsed state the user can actually act on. In the
      // read-only client window there is no +N badge and ArrowRight is inert,
      // so aria-expanded would be a promise the UI does not keep. The hidden
      // child count is folded into the label instead, so the information is
      // still available without implying an action that does not exist.
      aria-expanded={
        !isGhost && hasChildren && collapsible ? !collapsed : undefined
      }
      aria-selected={!isGhost ? isSelected : undefined}
      aria-label={
        isGhost
          ? undefined
          : collapsed && hasChildren
            ? `${displayText} (recolhido, ${childCount} ${
                childCount === 1 ? 'ponto oculto' : 'pontos ocultos'
              })`
            : displayText
      }
      aria-hidden={isGhost ? true : undefined}
      onFocus={() => onNodeFocus?.(layoutNode.id)}
      onKeyDown={(e) => onNodeKeyDown?.(layoutNode.id, e)}
      onClick={(e) => {
        if (onNodeClick && !isGhost) {
          e.stopPropagation();
          onNodeClick(layoutNode.id);
        }
      }}
    >
      {/* Touch floor. A one-line balloon is ~40px tall (20px of padding + one
          19.6px line), so the drawn pill alone is under the 44x44 target. A
          transparent rect gives an interactive node the full floor without
          changing the balloon. Only added when the node is clickable: in the
          read-only client window it would do nothing but steal taps from the
          pan surface. Painted first, so every visible element stays on top. */}
      {onNodeClick && !isGhost && (
        <rect
          x={-Math.max(width, 44) / 2}
          y={-Math.max(height, 44) / 2}
          width={Math.max(width, 44)}
          height={Math.max(height, 44)}
          fill="transparent"
          pointerEvents="all"
        />
      )}

      {/* Selection halo — one solid ring, >= 3:1 on both themes. The old
          second, 0.4-alpha #FBBF24 ring was 1.24:1 and decorative. */}
      {isSelected && (
        <rect
          x={-width / 2 - 7}
          y={-height / 2 - 7}
          width={width + 14}
          height={height + 14}
          rx={rx + 5}
          ry={rx + 5}
          fill="none"
          stroke={ringColor}
          strokeWidth="3.5"
          className="animate-pulse"
        />
      )}

      {/* Keyboard focus ring — dashed so it is never confused with selection */}
      <rect
        x={-width / 2 - 7}
        y={-height / 2 - 7}
        width={width + 14}
        height={height + 14}
        rx={rx + 5}
        ry={rx + 5}
        fill="none"
        stroke={ringColor}
        strokeWidth="3"
        strokeDasharray="6 4"
        className="opacity-0 group-focus:opacity-100 pointer-events-none"
      />

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
          stroke="var(--accent-text)"
          strokeWidth="2.5"
          strokeDasharray="4 3"
          className="animate-pulse"
        />
      )}

      {/* Editing active node highlight. The old #2563EB was 4.83:1 on a white
          balloon but only 2.31:1 on the dark #1E293B fill, and it was the one
          remaining literal blue in the file. Dashes now distinguish it from
          the solid selection ring, so the two never rely on hue alone. */}
      {isEditing && !isSelected && (
        <rect
          x={-width / 2 - 4}
          y={-height / 2 - 4}
          width={width + 8}
          height={height + 8}
          rx={rx + 2}
          ry={rx + 2}
          fill="none"
          stroke="var(--accent-text)"
          strokeWidth="2.5"
          strokeDasharray="2 3"
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
          {/* "destino" tag. The branch colour was used as 9px text on a pale
              wash, which is well under 4.5:1 for four of the eight palette
              entries. --accent-text is 5.02:1 / 11.11:1 on --surface-raised and
              the palette still shows as the dashed ring around the node, so the
              branch identity is not lost. */}
          <rect
            x="-26"
            y="-8"
            width="52"
            height="16"
            rx="8"
            ry="8"
            fill="var(--surface-raised)"
            stroke="var(--accent-text)"
            strokeWidth="1"
          />
          <text
            x="0"
            y="3"
            textAnchor="middle"
            fill="var(--accent-text)"
            fontSize="9"
            fontWeight="700"
            className="tracking-wider uppercase"
          >
            destino
          </text>
        </g>
      )}

      {/* Node Text. The treeitem above carries the accessible name (the
          untruncated text); this one is the visual rendering only, so a
          screen reader does not read the two-line split as a run. */}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill={textColor}
        fontSize={fontSize}
        fontWeight={isRoot ? '800' : '600'}
        aria-hidden="true"
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
                /* The live caret inherits the balloon's own text colour, which
                   is 19.43:1 / 16.88:1 on the fill. The old literal #2563EB was
                   4.83:1 on white and 2.31:1 on the dark ghost fill. */
                <tspan className="animate-ping font-mono">
                  ▌
                </tspan>
              )}
            </tspan>
          </>
        ) : (
          <tspan x="0" y="0">
            {line1}
            {isGhost && liveTextMode === 'live' && (
              <tspan className="animate-ping font-mono">
                ▌
              </tspan>
            )}
          </tspan>
        )}
      </text>

      {/* Collapsed Children Badge (+N). Hidden from AT: the treeitem already
          exposes aria-expanded and the same action is on Left/Right. */}
      {collapsed && hasChildren && onToggleCollapse && (
        /* Origin is the centre of the 44x44 touch target, not the centre of
           the 22px badge. The target therefore grows entirely OUTWARD from the
           balloon edge; a disc centred on the badge would have eaten a 12px
           sliver of the node's own hit area, and every tap on the right edge
           of a collapsed node would collapse it instead of selecting it. */
        <g
          transform={`translate(${width / 2 + 21}, 0)`}
          aria-hidden="true"
          className="cursor-pointer hover:opacity-90"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(layoutNode.id);
          }}
        >
          {/* `pointer-events="all"` is required: a `fill="transparent"` shape
              is only hit-testable when it is explicitly painted-for-events. */}
          <rect x="-22" y="-22" width="44" height="44" fill="transparent" pointerEvents="all" />
          <circle
            cx="-11"
            r="11"
            fill={badgeFill}
            stroke={badgeStroke}
            strokeWidth="2"
          />
          <text
            x="-11"
            textAnchor="middle"
            dominantBaseline="central"
            fill={badgeLabel}
            fontSize="11"
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
