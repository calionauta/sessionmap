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

  useEffect(() => {
    if (activeNodeId) {
      startDwellTimer(activeNodeId);
    }
  }, [activeNodeId, startDwellTimer]);

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
    <div
      className={`flex flex-col h-full overflow-hidden select-text ${
        isDark ? 'bg-[#0E131F] text-slate-100' : 'bg-white text-slate-900'
      }`}
    >
      {/* Refined Sidebar Header */}
      <div
        className={`px-4 py-3 border-b shrink-0 ${
          isDark
            ? 'bg-[#131926] border-slate-800 text-slate-100'
            : 'bg-slate-50 border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center justify-between text-xs font-bold tracking-tight">
          <span className="uppercase text-[11px] tracking-wider text-slate-700 dark:text-slate-300">
            Tópicos da Sessão
          </span>
          <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
            {flatItems.length} balões
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400">
          <span>Enter: <strong className="font-semibold text-slate-900 dark:text-slate-200">Irmão</strong></span>
          <span>·</span>
          <span className="font-bold text-amber-700 dark:text-amber-400">Ctrl+Enter: Filho</span>
          <span>·</span>
          <span>Tab: Indentar</span>
        </div>
      </div>

      {/* Lines Scrollable Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 outline-none">
        {flatItems.map((item, index) => {
          const isRootItem = item.id === root.id;
          const isRowActive = activeNodeId === item.id;
          const isRowSelected = selectedNodeId === item.id;
          const charCount = item.text.length;
          const isCharWarning = charCount > 90;

          // Compute unequivocal high-contrast visual styling (WCAG AAA compliant)
          let rowContainerStyle = '';
          let inputTextStyle = '';
          let inputInlineColor = '';
          let bulletStyle = '';

          if (isRowActive) {
            // Active typing line: MAXIMUM CONTRAST
            if (isDark) {
              rowContainerStyle = 'bg-slate-800 border-2 border-amber-400 text-white shadow-md ring-2 ring-amber-400/25';
              inputTextStyle = '!text-white font-bold placeholder:text-slate-300 caret-amber-400';
              inputInlineColor = '#FFFFFF';
              bulletStyle = 'bg-amber-400 ring-2 ring-amber-400/40';
            } else {
              rowContainerStyle = 'bg-slate-950 border-2 border-amber-500 text-white shadow-md ring-2 ring-slate-950/15';
              inputTextStyle = '!text-white font-bold placeholder:text-slate-300 caret-amber-400';
              inputInlineColor = '#FFFFFF';
              bulletStyle = 'bg-amber-400 ring-2 ring-white/50';
            }
          } else if (isRowSelected) {
            // Selected node: Solid Gold/Amber badge with PURE BLACK TEXT (19:1 contrast)
            if (isDark) {
              rowContainerStyle = 'bg-amber-400 border-2 border-amber-300 text-black shadow-md font-extrabold';
              inputTextStyle = '!text-black font-black placeholder:text-slate-900 caret-black';
              inputInlineColor = '#000000';
              bulletStyle = 'bg-black';
            } else {
              rowContainerStyle = 'bg-amber-300 border-2 border-amber-600 text-black shadow-sm font-extrabold';
              inputTextStyle = '!text-black font-black placeholder:text-slate-900 caret-black';
              inputInlineColor = '#000000';
              bulletStyle = 'bg-black';
            }
          } else {
            // Normal unselected line: High contrast dark text on light mode, bright on dark mode
            if (isDark) {
              rowContainerStyle = 'border border-transparent hover:bg-slate-800/80 text-slate-100';
              inputTextStyle = isRootItem
                ? 'font-extrabold text-white text-base font-mono'
                : 'text-slate-100 font-semibold placeholder:text-slate-400 caret-amber-400';
              inputInlineColor = '#F8FAFC';
              bulletStyle = isRootItem ? 'bg-amber-400' : 'bg-slate-500';
            } else {
              rowContainerStyle = 'border border-transparent hover:bg-slate-100 text-slate-950';
              inputTextStyle = isRootItem
                ? 'font-extrabold text-slate-950 text-base font-mono'
                : 'text-slate-950 font-bold placeholder:text-slate-500 caret-slate-950';
              inputInlineColor = '#020617';
              bulletStyle = isRootItem ? 'bg-slate-950' : 'bg-slate-500';
            }
          }

          return (
            <div
              key={item.id}
              onClick={() => {
                focusInput(item.id);
              }}
              className={`group flex items-center py-2 px-2.5 rounded-lg transition-all relative cursor-text ${rowContainerStyle}`}
              style={{
                paddingLeft: `${Math.max(10, item.level * 22 + 10)}px`,
              }}
            >
              {/* Left indicator marker for active item */}
              {isRowActive && (
                <div
                  className={`absolute left-0 top-1.5 bottom-1.5 w-1.5 rounded-r ${
                    isDark ? 'bg-amber-400' : 'bg-amber-400'
                  }`}
                />
              )}

              {/* Indent Guide Line */}
              {item.level > 0 && (
                <div
                  className={`absolute top-0 bottom-0 border-l ${
                    isDark ? 'border-slate-800' : 'border-slate-200'
                  }`}
                  style={{ left: `${item.level * 22 - 3}px` }}
                />
              )}

              {/* Collapse button or bullet dot */}
              <div className="w-5 h-5 flex items-center justify-center shrink-0 mr-2">
                {item.hasChildren ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateRoot(toggleNodeCollapse(root, item.id), 'collapse');
                    }}
                    className={`p-0.5 rounded transition-colors ${
                      isRowActive || isRowSelected
                        ? 'text-white hover:bg-white/20'
                        : isDark
                        ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                        : 'text-slate-600 hover:text-slate-950 hover:bg-slate-200'
                    }`}
                  >
                    {item.collapsed ? (
                      <ChevronRight className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                ) : (
                  <div className={`w-2 h-2 rounded-full transition-transform ${bulletStyle}`} />
                )}
              </div>

              {/* Line Input with Guaranteed High-Contrast Typography */}
              <div className="flex-1 relative flex items-center">
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
                  style={{ color: inputInlineColor }}
                  className={`w-full bg-transparent border-0 outline-none text-sm transition-colors py-0.5 pr-24 ${inputTextStyle}`}
                />

                {/* Right controls: + Filho button & counters */}
                <div className="absolute right-1 flex items-center gap-1.5">
                  {/* + Filho Action Button on hover/focus */}
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateChild(item);
                    }}
                    title="Criar nó filho dentro deste (Ctrl+Enter)"
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all ${
                      isRowActive
                        ? 'opacity-100 bg-amber-400 text-slate-950 border-amber-500 hover:bg-amber-300'
                        : 'opacity-0 group-hover:opacity-100 bg-amber-100 hover:bg-amber-200 text-amber-950 border-amber-400'
                    }`}
                  >
                    <CornerDownRight className="w-3 h-3 text-amber-700" />
                    <span>+ Filho</span>
                  </button>

                  {/* Character Counter */}
                  {charCount > 70 && (
                    <span
                      className={`text-[10px] font-mono tabular-nums ${
                        isRowActive
                          ? 'text-amber-300 font-bold'
                          : isCharWarning
                          ? 'text-amber-700 dark:text-amber-400 font-bold'
                          : isDark
                          ? 'text-slate-400'
                          : 'text-slate-600'
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

                  {/* 3s Focus Dwell Circular Progress */}
                  {isRowActive && dwellActive && dwellProgress > 0 && dwellProgress < 100 && (
                    <div
                      className="relative w-4 h-4 flex items-center justify-center"
                      title={`Foco automático do cliente em ${Math.ceil(
                        focusDwellSeconds - (dwellProgress / 100) * focusDwellSeconds
                      )}s`}
                    >
                      <svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
                        <circle
                          cx="8"
                          cy="8"
                          r="6"
                          fill="none"
                          stroke={isDark ? '#475569' : '#CBD5E1'}
                          strokeWidth="2.5"
                        />
                        <circle
                          cx="8"
                          cy="8"
                          r="6"
                          fill="none"
                          stroke="#F59E0B"
                          strokeWidth="2.5"
                          strokeDasharray={37.7}
                          strokeDashoffset={37.7 - (37.7 * dwellProgress) / 100}
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Add item button at bottom */}
        <div className="pt-2 pl-2">
          <button
            type="button"
            onClick={() => {
              const { root: newRoot, newNode } = addChild(root, root.id, '');
              onUpdateRoot(newRoot, 'add');
              focusInput(newNode.id);
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-800 hover:text-black dark:text-slate-200 dark:hover:text-white transition-colors py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Adicionar Novo Tópico</span>
          </button>
        </div>
      </div>
    </div>
  );
};
