import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  CornerDownRight,
} from 'lucide-react';
import { FlatOutlineItem, MindMapNode } from '../../types';
import {
  flattenTree,
  updateNodeText,
  addSibling,
  addChild,
  indentNode,
  unindentNode,
  moveSibling,
  deleteNode,
  toggleNodeCollapse,
  findParentAndIndex,
  findNodeById,
  parseMarkdownToTree,
} from '../../utils/tree';

interface OutlineEditorProps {
  root: MindMapNode;
  onUpdateRoot: (newRoot: MindMapNode, reason?: string) => void;
  onDraftChange: (draft: {
    mode: 'add' | 'edit';
    parentId: string | null;
    targetId?: string | null;
    parentText?: string;
    text: string;
    active: boolean;
  }) => void;
  onSelectNode: (nodeId: string | null, reason: 'focus3s' | 'click' | 'clear' | 'navigate') => void;
  selectedNodeId: string | null;
  focusDwellSeconds: number;
  theme: 'papel' | 'noite';
}

export const OutlineEditor: React.FC<OutlineEditorProps> = ({
  root,
  onUpdateRoot,
  onDraftChange,
  onSelectNode,
  selectedNodeId,
  focusDwellSeconds = 3,
  theme,
}) => {
  const isDark = theme === 'noite';
  const flatItems = flattenTree(root, 0, null, 0, true);

  const [activeNodeId, setActiveNodeId] = useState<string | null>(root.id);
  const [dwellProgress, setDwellProgress] = useState<number>(0);
  const [dwellActive, setDwellActive] = useState<boolean>(false);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const dwellTimerRef = useRef<number | null>(null);
  const dwellAnimRef = useRef<number | null>(null);
  const dwellStartTimeRef = useRef<number>(0);

  // Synchronous, zero-latency focus & selection!
  const focusInput = useCallback(
    (nodeId: string, selectAll: boolean = false) => {
      setActiveNodeId(nodeId);
      // Immediately notify parent to position mindmap with 0ms delay!
      onSelectNode(nodeId, 'navigate');

      // Update draft synchronously so parent/mirror updates instantly
      const pInfo = findParentAndIndex(root, nodeId);
      const parentNode = pInfo?.parent || root;
      const targetNode = findNodeById(root, nodeId);
      if (targetNode) {
        onDraftChange({
          mode: targetNode.text ? 'edit' : 'add',
          parentId: parentNode.id,
          parentText: parentNode.text,
          targetId: targetNode.id,
          text: targetNode.text,
          active: true,
        });
      }

      const el = inputRefs.current.get(nodeId);
      if (el) {
        el.focus();
        if (selectAll) {
          el.select();
        } else {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }
    },
    [onSelectNode, root, onDraftChange]
  );

  // Reset 3s dwell timer
  const resetDwellTimer = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    if (dwellAnimRef.current) {
      cancelAnimationFrame(dwellAnimRef.current);
      dwellAnimRef.current = null;
    }
    setDwellProgress(0);
    setDwellActive(false);
  }, []);

  // Start 3s dwell timer when resting on a node
  const startDwellTimer = useCallback(
    (nodeId: string) => {
      resetDwellTimer();
      if (!nodeId || focusDwellSeconds <= 0) return;

      setDwellActive(true);
      dwellStartTimeRef.current = performance.now();
      const durationMs = focusDwellSeconds * 1000;

      const step = () => {
        const elapsed = performance.now() - dwellStartTimeRef.current;
        const pct = Math.min(100, (elapsed / durationMs) * 100);
        setDwellProgress(pct);

        if (elapsed < durationMs) {
          dwellAnimRef.current = requestAnimationFrame(step);
        } else {
          onSelectNode(nodeId, 'focus3s');
          setDwellActive(false);
        }
      };

      dwellAnimRef.current = requestAnimationFrame(step);
    },
    [focusDwellSeconds, onSelectNode, resetDwellTimer]
  );

  useEffect(() => {
    return () => {
      resetDwellTimer();
    };
  }, [resetDwellTimer]);

  // The dwell timer is armed from a deliberate POINTER click on a row (see
  // the row onClick below), never from activeNodeId.
  //
  // It used to run off `activeNodeId`, which meant every ArrowUp/ArrowDown
  // step re-armed it — a keyboard user scanning the outline lit up the
  // client's screen on every row they passed, with focusDwellSeconds: 0 in
  // Settings as the only escape. Arming on click keeps the feature intact
  // for the mouse flow it was designed for and removes it from traversal.
  //
  // Note: the client-facing highlight on traversal does NOT actually come
  // from this timer. focusInput() already broadcasts onSelectNode(id,
  // 'navigate') synchronously, and ClientView treats every `reason`
  // identically (ClientView.tsx:114), so the dwell only re-sent the node it
  // had already sent. See the report: if traversal should stop moving the
  // client's highlight at all, focusInput's 'navigate' call is the line to
  // change, not this one.

  // Create Child directly (Ctrl+Enter or button)
  const handleCreateChild = (item: FlatOutlineItem) => {
    resetDwellTimer();
    const { root: newRoot, newNode } = addChild(root, item.id, '');
    onUpdateRoot(newRoot, 'addChild');

    onDraftChange({
      mode: 'add',
      parentId: item.id,
      parentText: item.text,
      targetId: newNode.id,
      text: '',
      active: true,
    });

    focusInput(newNode.id);
  };

  // Keyboard navigation & tree actions
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    item: FlatOutlineItem,
    currentIndex: number
  ) => {
    resetDwellTimer();

    // 1. Ctrl+Enter or Cmd+Enter: CREATE DIRECT CHILD INSTANTLY!
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleCreateChild(item);
      return;
    }

    // 2. Standard Enter: Create Sibling
    if (e.key === 'Enter') {
      e.preventDefault();
      const { root: newRoot, newNode } = addSibling(root, item.id, '');
      onUpdateRoot(newRoot, 'addSibling');

      const pInfo = findParentAndIndex(newRoot, newNode.id);
      const parentNode = pInfo?.parent || root;

      onDraftChange({
        mode: 'add',
        parentId: parentNode.id,
        parentText: parentNode.text,
        targetId: newNode.id,
        text: '',
        active: true,
      });

      focusInput(newNode.id);
      return;
    }

    // 3. Tab / Shift+Tab: Indent / Unindent
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const { root: newRoot, success } = unindentNode(root, item.id);
        if (success) {
          onUpdateRoot(newRoot, 'unindent');
          const pInfo = findParentAndIndex(newRoot, item.id);
          const parentNode = pInfo?.parent || root;
          onDraftChange({
            mode: item.text ? 'edit' : 'add',
            parentId: parentNode.id,
            parentText: parentNode.text,
            targetId: item.id,
            text: item.text,
            active: true,
          });
          focusInput(item.id);
        }
      } else {
        const { root: newRoot, success } = indentNode(root, item.id);
        if (success) {
          onUpdateRoot(newRoot, 'indent');
          const pInfo = findParentAndIndex(newRoot, item.id);
          const parentNode = pInfo?.parent || root;
          onDraftChange({
            mode: item.text ? 'edit' : 'add',
            parentId: parentNode.id,
            parentText: parentNode.text,
            targetId: item.id,
            text: item.text,
            active: true,
          });
          focusInput(item.id);
        }
      }
      return;
    }

    // 4. Alt+ArrowUp / Alt+ArrowDown: Move sibling
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 'up' : 'down';
      const { root: newRoot, success } = moveSibling(root, item.id, dir);
      if (success) {
        onUpdateRoot(newRoot, 'move');
        focusInput(item.id);
      }
      return;
    }

    // 5. ArrowUp / ArrowDown: INSTANT ZERO-LATENCY NAVIGATION
    if (e.key === 'ArrowUp' && !e.altKey) {
      if (currentIndex > 0) {
        e.preventDefault();
        const prevItem = flatItems[currentIndex - 1];
        focusInput(prevItem.id);
      }
      return;
    }

    if (e.key === 'ArrowDown' && !e.altKey) {
      if (currentIndex < flatItems.length - 1) {
        e.preventDefault();
        const nextItem = flatItems[currentIndex + 1];
        focusInput(nextItem.id);
      }
      return;
    }

    // 6. Backspace on empty line: delete or unindent
    if (e.key === 'Backspace' && item.text === '' && item.id !== root.id) {
      e.preventDefault();
      const { root: newRoot, nextFocusId } = deleteNode(root, item.id);
      onUpdateRoot(newRoot, 'delete');
      onDraftChange({
        mode: 'add',
        parentId: null,
        targetId: null,
        text: '',
        active: false,
      });
      if (nextFocusId) {
        focusInput(nextFocusId);
      }
      return;
    }

    // 7. Esc: Clear selection & highlights
    if (e.key === 'Escape') {
      onSelectNode(null, 'clear');
      resetDwellTimer();
    }
  };

  // Input change handler
  const handleInputChange = (item: FlatOutlineItem, newText: string) => {
    if (newText.length > 280) return;

    resetDwellTimer();
    const newRoot = updateNodeText(root, item.id, newText);
    onUpdateRoot(newRoot, 'typing');

    const pInfo = findParentAndIndex(newRoot, item.id);
    const parentNode = pInfo?.parent || root;

    onDraftChange({
      mode: 'edit',
      parentId: parentNode.id,
      parentText: parentNode.text,
      targetId: item.id,
      text: newText,
      active: true,
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, item: FlatOutlineItem) => {
    const text = e.clipboardData.getData('text');
    if (!text || (!text.includes('\n') && !text.includes('#'))) return;

    e.preventDefault();
    const pastedTree = parseMarkdownToTree(text, item.text || 'Importado');
    if (item.id === root.id) {
      onUpdateRoot(pastedTree, 'paste');
    } else {
      const newRoot = {
        ...root,
        children: (root.children || []).map(function attach(node: MindMapNode): MindMapNode {
          if (node.id === item.id) {
            return {
              ...node,
              children: [...(node.children || []), ...(pastedTree.children || [])],
            };
          }
          return {
            ...node,
            children: (node.children || []).map(attach),
          };
        }),
      };
      onUpdateRoot(newRoot, 'paste');
    }
  };

  return (
    /* The pane is NOT sized by the viewport: TherapistView gives it an inline
       `width: {outlineWidthPercent}%` of a flex row, so the same pane can be
       547px on a 1440px screen and 142px on a 375px one, and a user's zoom
       moves it again. A viewport breakpoint (sm:/md:) would therefore be the
       wrong axis twice over. This component declares itself a query CONTAINER
       and every rule below is written against the pane's own inline size. */
    <div className="@container flex flex-col h-full min-w-0 overflow-hidden select-text bg-surface-raised text-content">
      {/* Refined Sidebar Header */}
      <div className="px-4 py-3 border-b border-line-muted shrink-0 bg-surface-inset text-content">
        {/* Both header rows wrap instead of crushing: at 200% zoom inside a
            291px pane the title + counter cannot share a line. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-bold tracking-tight">
          <span className="uppercase text-[11px] tracking-wider text-content-muted">
            Tópicos da Sessão
          </span>
          <span className="font-mono text-[11px] font-bold text-content-muted">
            {flatItems.length} balões
          </span>
        </div>
        {/* Hierarchy is carried by weight, not colour: text-accent-text on
            bg-surface-inset is 4.40:1 in the papel theme, just under AA. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px] font-mono text-content-muted">
          <span>
            Enter: <strong className="font-semibold text-content">Irmão</strong>
          </span>
          <span aria-hidden="true">·</span>
          <strong className="font-bold text-content">Ctrl+Enter: Filho</strong>
          <span aria-hidden="true">·</span>
          <span>Tab: Indentar</span>
        </div>
      </div>

      {/* Lines Scrollable Area.
          `--indent-step` is the one knob the whole tree scales from. It used to
          be a hard-coded 22px per level, so depth 12 asked for 274px of indent
          inside a pane that is 142px wide on a phone — the overflow the
          design audit flagged under C2. The row reads the step through
          calc(), so shrinking it here re-spaces every level at once.
          overflow-x-hidden (which overflow-y:auto already implies) keeps the
          44px hit expanders from ever producing a sideways scrollbar. */}
      <div className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto p-3 space-y-1 outline-none [--indent-step:22px] @max-[520px]:[--indent-step:14px] @max-[320px]:[--indent-step:8px]">
        {flatItems.map((item, index) => {
          const isRootItem = item.id === root.id;
          const isRowActive = activeNodeId === item.id;
          const isRowSelected = selectedNodeId === item.id;
          const charCount = item.text.length;
          const isCharWarning = charCount > 90;

          // The active row is a full row INVERSION, not a 1px ring — 20.17:1
          // in papel. That is the strongest focus indicator in the app and
          // the pattern the rest of the app should copy, so it is preserved
          // exactly. index.css has no inverted-surface token, so the two
          // inversion fills stay literal here (see report: needs a
          // --surface-inverted pair). Everything else is a semantic token.
          let rowContainerStyle = '';
          let inputTextStyle = '';
          let bulletStyle = '';

          if (isRowActive) {
            rowContainerStyle = isDark
              ? 'bg-[#1e293b] border-2 border-accent text-white shadow-md ring-2 ring-accent/25'
              : 'bg-[#020617] border-2 border-accent text-white shadow-md ring-2 ring-[#020617]/15';
            // White-on-near-black placeholder: no token covers an inverted
            // foreground, so slate-300 (13.59:1 / 9.85:1) is kept.
            inputTextStyle =
              '!text-white font-bold placeholder:text-slate-300 caret-accent';
            bulletStyle = 'bg-accent ring-2 ring-accent/40';
          } else if (isRowSelected) {
            // Selected node: amber wash with PURE BLACK TEXT (18.86:1 papel /
            // 12.58:1 noite). In papel the 2px --accent-text border carries the
            // state against the page (5.02:1, up from 3.19:1 for the old
            // border-amber-600). In noite the fill itself is 12.44:1 against
            // the page, so the row needs no border — and a --border border
            // there measured only 2.85:1 against the amber it was outlining,
            // i.e. it was a 2px edge nobody could see.
            rowContainerStyle = isDark
              ? 'bg-accent text-black shadow-md font-extrabold'
              : 'bg-accent-soft border-2 border-accent-text text-black shadow-sm font-extrabold';
            inputTextStyle = '!text-black font-black placeholder:text-content-onaccent caret-black';
            bulletStyle = 'bg-black';
          } else {
            // Normal line. hover:bg-content/5 is a single token expression
            // that washes correctly in both themes (4% darker in papel,
            // lighter in noite), replacing two hardcoded slate hovers.
            rowContainerStyle = 'border border-transparent hover:bg-content/5 text-content';
            inputTextStyle = isRootItem
              ? 'font-extrabold text-base font-mono'
              : 'font-bold placeholder:text-content-muted caret-content';
            bulletStyle = isRootItem ? 'bg-accent' : 'bg-content-muted';
          }

          // Indent, clamped twice: the responsive step above, then a hard
          // ceiling of 38% of the pane so no row — however deep the tree —
          // can ask for more than a third of the space. `--indent-cap` is the
          // single override point, so a future drag-to-resize handle has one
          // knob to turn. Row padding and guide line both read this property,
          // which is how the two copies of `level * 22` stopped drifting.
          const padLeft = `min(calc(${item.level} * var(--indent-step, 22px) + 10px), var(--indent-cap, 38cqi))`;

          return (
            <div
              key={item.id}
              onClick={() => {
                focusInput(item.id);
                // Deliberate pointer activation arms the dwell auto-highlight.
                // Keyboard traversal deliberately does not (see the note
                // above the dwell timer).
                startDwellTimer(item.id);
              }}
              /* py-2.5, not py-2. At py-2 the row was 40px tall inside a 44px
                 pitch: two controls shared one 44px band, and a ::before
                 expander lost the 2px it poked past its own row to the NEXT
                 row, which paints later. 46px rows give each expander a band
                 of its own with room to spare. */
              className={`group flex items-center py-2.5 px-2.5 rounded-lg transition-all relative cursor-text ${rowContainerStyle}`}
              style={
                {
                  '--pad-left': padLeft,
                  paddingLeft: 'var(--pad-left)',
                } as React.CSSProperties
              }
            >
              {/* Indent Guide Line. --border-muted measured 2.56:1 / 2.45:1
                  here, and the line is the only visual cue for how deep a row
                  sits, so it takes the 3:1 --border token instead. */}
              {item.level > 0 && (
                <div
                  className="absolute top-0 bottom-0 border-l border-line"
                  style={{ left: 'calc(var(--pad-left) - 13px)' }}
                />
              )}

              {/* Collapse button or bullet dot. w-7, not w-5: the extra 4px of
                  slack is what lets the chevron's 12px ::before expander land
                  on the input's edge instead of being clipped by it — the
                  input is a later sibling, so it wins any overlap. Same icon
                  position, same 8px optical gap to the text. */}
              <div className="w-7 h-5 flex items-center justify-center shrink-0 mr-2">
                {item.hasChildren ? (
                  <button
                    type="button"
                    // Was tabIndex={-1}: collapse had NO keyboard equivalent
                    // anywhere in the app, so a collapsed subtree could never
                    // be re-expanded. It is always visible (no opacity-0), so
                    // nothing was hiding it from the tab order.
                    aria-expanded={!item.collapsed}
                    aria-label={
                      item.collapsed
                        ? `Expandir ${item.text || 'tópico'}`
                        : `Recolher ${item.text || 'tópico'}`
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      resetDwellTimer();
                      onUpdateRoot(toggleNodeCollapse(root, item.id), 'collapse');
                    }}
                    /* 20x20 visual, 59x64 effective target. `relative` plus an
                       invisible ::before grown 12px past every edge is the whole
                       trick: the box model never moves, so the row keeps its
                       density and the guide line stays aligned. Measured with
                       elementFromPoint, not asserted. */
                    className={`relative p-0.5 rounded transition-colors before:content-[''] before:absolute before:-inset-3 ${
                      isRowActive
                        ? 'text-white hover:bg-white/20'
                        : isRowSelected
                        ? 'text-black hover:bg-black/15'
                        : 'text-content-muted hover:text-content hover:bg-content/10'
                    }`}
                  >
                    {item.collapsed ? (
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                ) : (
                  <div className={`w-2 h-2 rounded-full transition-transform ${bulletStyle}`} />
                )}
              </div>

              {/* Line Input with Guaranteed High-Contrast Typography.
                  The inline style={{color}} is gone: `!text-white` / `!text-black`
                  compile to !important and already win over inline styles, and
                  the normal row inherits text-content from the row container. */}
              {/* min-w-0 is load-bearing: a flex item defaults to
                  min-width:auto, so the input's ~170px intrinsic width was
                  setting the row's floor and the row's floor was setting the
                  pane's floor. That is the whole reason the split overflowed. */}
              <div className="flex-1 min-w-0 relative flex items-center">
                <input
                  ref={(el) => {
                    if (el) inputRefs.current.set(item.id, el);
                    else inputRefs.current.delete(item.id);
                  }}
                  type="text"
                  value={item.text}
                  placeholder={isRootItem ? 'Data/Hora ou Tema da Sessão' : 'Digite a anotação…'}
                  onFocus={() => {
                    focusInput(item.id);
                  }}
                  onChange={(e) => handleInputChange(item, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, item, index)}
                  onPaste={(e) => handlePaste(e, item)}
                  /* pr reserves the row for the absolutely positioned control
                     cluster. It is 112px on a normal pane but only 32px on a
                     narrow one, where the + Filho button drops to icon-only —
                     otherwise 96px of reserved space left ~16px of a 142px
                     pane for the actual text, and the field looked broken. */
                  className={`w-full bg-transparent border-0 outline-none text-sm transition-colors py-0.5 pr-8 @min-[384px]:pr-28 ${inputTextStyle}`}
                />

                {/* Right controls: + Filho button & counters */}
                <div className="absolute right-1 flex items-center gap-1.5">
                  {/* + Filho. Was tabIndex={-1} + opacity-0, so it was
                      unreachable by keyboard AND invisible to it: focusable
                      but fully transparent. group-focus-within reveals it as
                      soon as focus lands inside the row. Ctrl+Enter is still
                      the fast path. pointer-coarse:opacity-100 closes the
                      last gap — a touchscreen fires no hover, and an
                      invisible-but-still-present button is an invisible click
                      target sitting on top of the text. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateChild(item);
                    }}
                    title="Criar nó filho dentro deste (Ctrl+Enter)"
                    aria-label="Criar nó filho dentro deste tópico"
                    /* 20px tall visual, 44px touch: the same invisible ::before
                       expander as the chevron, 12px past every edge. The
                       cluster is the row's last child, so it wins the hit over
                       the input underneath it — which is why the expander can
                       also claim the reserved gutter to its left. */
                    className={`relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border border-accent bg-accent text-content-onaccent transition-opacity before:content-[''] before:absolute before:-inset-3 ${
                      isRowActive
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100'
                    }`}
                  >
                    <CornerDownRight className="w-3 h-3" aria-hidden="true" />
                    <span className="hidden @min-[384px]:inline">+ Filho</span>
                  </button>

                  {/* Character Counter. Each state needs its own colour: the
                      old single `text-accent-text` warning was 1.93:1 on the
                      papel selected wash and exactly 1.00:1 on the noite one
                      (both are --accent-text sitting on --accent-soft /
                      --accent), and `text-accent` on the active row was
                      9.10:1 / 9.03:1, which is fine. */}
                  {charCount > 70 && (
                    <span
                      /* Below 384px of pane the counter competes with the field
                         for the only 32px of reserved gutter, so it stands down
                         rather than overlapping the annotation. Input is still
                         capped at 280 characters either way. */
                      className={`hidden @min-[384px]:inline text-[10px] font-mono tabular-nums ${
                        isRowActive
                          ? 'text-accent font-bold'
                          : isRowSelected
                          ? 'text-content-onaccent font-bold'
                          : isCharWarning
                          ? 'text-accent-text font-bold'
                          : 'text-content-muted'
                      }`}
                      title={
                        isCharWarning
                          ? 'Recomendação: até ~90 caracteres'
                          : `${charCount} caracteres`
                      }
                    >
                      {charCount}/90
                    </span>
                  )}

                  {/* Focus Dwell Circular Progress.
                      Track was #CBD5E1 on white = 1.48:1 and the arc
                      #F59E0B = 2.15:1; both fail SC 1.4.11 (needs 3:1).
                      stroke-line is 4.76:1 / 3.90:1 and stroke-accent-text is
                      5.02:1 / 11.12:1. One token each, so the isDark ternary
                      is gone. role=progressbar (not a live region, so it does
                      not spam a screen reader mid-animation). */}
                  {isRowActive && dwellActive && dwellProgress > 0 && dwellProgress < 100 && (() => {
                    const secondsLeft = Math.max(
                      0,
                      Math.ceil(focusDwellSeconds - (dwellProgress / 100) * focusDwellSeconds)
                    );
                    return (
                      <div
                        role="progressbar"
                        aria-label="Foco automático do cliente"
                        aria-valuemin={0}
                        aria-valuemax={focusDwellSeconds}
                        aria-valuenow={
                          Math.round((dwellProgress / 100) * focusDwellSeconds * 10) / 10
                        }
                        aria-valuetext={`${secondsLeft}s para focar no cliente`}
                        title={`Foco automático do cliente em ${secondsLeft}s`}
                        className="w-4 h-4"
                      >
                        <svg
                          className="w-4 h-4 -rotate-90"
                          viewBox="0 0 16 16"
                          aria-hidden="true"
                        >
                          <circle
                            cx="8"
                            cy="8"
                            r="6"
                            fill="none"
                            className="stroke-line"
                            strokeWidth="2.5"
                          />
                          <circle
                            cx="8"
                            cy="8"
                            r="6"
                            fill="none"
                            className="stroke-accent-text"
                            strokeWidth="2.5"
                            strokeDasharray={37.7}
                            strokeDashoffset={37.7 - (37.7 * dwellProgress) / 100}
                            strokeLinecap="round"
                          />
                        </svg>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}

        {/* Add item button at bottom — .ctl replaces 12 hardcoded
            slate/white classes and buys the 44px touch target floor.
            max-w-full lets it shrink below its label's natural width so it
            wraps to two lines inside a narrow pane instead of forcing one. */}
        <div className="pt-2 pl-2">
          <button
            type="button"
            onClick={() => {
              const { root: newRoot, newNode } = addChild(root, root.id, '');
              onUpdateRoot(newRoot, 'add');
              focusInput(newNode.id);
              startDwellTimer(newNode.id);
            }}
            className="ctl max-w-full cursor-pointer justify-center text-center text-xs font-bold leading-tight shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Adicionar Novo Tópico</span>
          </button>
        </div>
      </div>
    </div>
  );
};
