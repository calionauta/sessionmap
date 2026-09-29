import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, Keyboard, ListTree, MoveVertical, PanelLeft, Minimize2 } from 'lucide-react';
import { FlatOutlineItem, MindMapNode } from '../../types';
import {
  findNodeById,
  isLiftChord,
  moveCandidates,
  moveNode,
  branchIndexOf,
  MOVE_REFUSAL_TEXT,
  flattenTree,
  parseMarkdownToTree,
  treeToMarkdown,
} from '../../utils/tree';

interface MarkdownOutlineProps {
  root: MindMapNode;
  /** Commits a parsed tree. `reason` decides whether it is one undo step. */
  onUpdateRoot: (newRoot: MindMapNode, reason: string) => void;
  onSelectNode: (nodeId: string | null, reason: 'focus3s' | 'click' | 'clear' | 'navigate') => void;
  onDraftChange: (draft: {
    mode: 'add' | 'edit';
    parentId: string | null;
    parentText?: string;
    targetId?: string | null;
    text: string;
    active: boolean;
  }) => void;
  selectedNodeId: string | null;
  theme: 'papel' | 'noite';
  enableNodeMove: boolean;
  outlineFontScale: number;
  maximizeOutline?: boolean;
  onToggleMaximize?: () => void;
  hidden?: boolean;
}

/** How long typing settles before the text is parsed back into a tree. */
const PARSE_DEBOUNCE_MS = 400;

const INDENT = '  ';

export const MarkdownOutline: React.FC<MarkdownOutlineProps> = ({
  root,
  onUpdateRoot,
  onSelectNode,
  onDraftChange,
  selectedNodeId,
  theme,
  enableNodeMove,
  outlineFontScale = 1,
  maximizeOutline = false,
  onToggleMaximize,
  hidden = false,
}) => {
  const isDark = theme === 'noite';
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<number | null>(null);

  const [text, setText] = useState(() => treeToMarkdown(root));
  const [hint, setHint] = useState('');
  const [notice, setNotice] = useState('');
  const [lifted, setLifted] = useState<{ sourceId: string; targetId: string | null } | null>(null);
  const noticeTimer = useRef<number | null>(null);

  /**
   * Reload the buffer when the SESSION changes, not on every tree change.
   *
   * Keyed on the root's id: switching sessions must show the new one, but the
   * tree also changes as a result of what is typed in here, and reloading on
   * that would fight the caret. Two roots with the same id are the same
   * session, which is the only thing that matters here.
   */
  const sessionId = root.id;
  const lastSessionRef = useRef(sessionId);
  useEffect(() => {
    if (lastSessionRef.current === sessionId) return;
    lastSessionRef.current = sessionId;
    setText(treeToMarkdown(root));
    setLifted(null);
  }, [sessionId, root]);

  /**
   * The tree the text currently describes.
   *
   * Shown live rather than only on blur so the shared screen keeps mirroring
   * the session while the therapist writes — a mode that only updated on blur
   * would show the client a stale map for as long as they kept typing, which
   * is the whole point of the second screen.
   *
   * A lift is not drawn here: while dragging, the buffer is the source of truth
   * and moving rows under the pointer is not possible.
   */
  const parsedRoot = useMemo(
    () => parseMarkdownToTree(text, root.text, root),
    [text, root]
  );

  const flatItems = useMemo(
    () => flattenTree(parsedRoot, 0, null, 0, true),
    [parsedRoot]
  );

  /**
   * Which topic the caret is in, and its parent.
   *
   * The text has no ids, so the caret has to be mapped back to a node for the
   * client broadcast and the highlight. It is matched by the text of the line
   * the caret sits on: the rows model can hand over a node id, a text buffer
   * cannot, and the line is the only handle that exists.
   */
  const caretNode = useCallback((): { node: FlatOutlineItem | null; parentText: string | undefined } => {
    const el = textareaRef.current;
    if (!el) return { node: null, parentText: undefined };
    const before = el.value.slice(0, el.selectionStart);
    const lineStart = before.lastIndexOf('\n') + 1;
    // The WHOLE line, not just the part before the caret. A caret sitting one
    // character into "- cansaço" would otherwise read the line as "-" and match
    // no topic at all, so the highlight and the lift would both do nothing
    // until the therapist typed further into the text.
    const lineEnd = el.value.indexOf('\n', el.selectionStart);
    const line = el.value
      .slice(lineStart, lineEnd === -1 ? el.value.length : lineEnd)
      .replace(/^\s*#\s*/, '')
      .replace(/^\s*[-*+]\s*/, '')
      .trim();
    const item = flatItems.find((i) => i.id !== parsedRoot.id && i.text === line);
    if (!item) return { node: null, parentText: undefined };
    const parent = item.parentId ? findNodeById(parsedRoot, item.parentId) : null;
    return { node: item, parentText: parent?.text };
  }, [flatItems, parsedRoot]);

  const broadcastCaret = useCallback(() => {
    const { node, parentText } = caretNode();
    onDraftChange({
      mode: node && node.text ? 'edit' : 'add',
      parentId: node?.parentId ?? null,
      parentText,
      targetId: node?.id ?? null,
      text: node?.text ?? '',
      active: Boolean(node),
    });
  }, [caretNode, onDraftChange]);

  /**
   * Parses the buffer into the tree once typing settles.
   *
   * DEBOUNCED rather than on every keystroke, and the reason is the client
   * window. A parse per keystroke means a snapshot broadcast per keystroke, so
   * the client watches the map rebuild itself letter by letter; worse, a
   * half-typed line parses into a different tree each time and the map
   * thrashes. A short settle is what makes this feel like typing while keeping
   * one coherent structure per pause.
   */
  /**
   * True when the buffer already describes the tree the app holds.
   *
   * Compared against the CURRENT TREE, not against the buffer. Comparing the
   * buffer to itself is always true — parse it and serialise it back and you
   * get the same text — so the first real edit looked like "no change" and
   * nothing was ever committed. The question is not whether the text is
   * self-consistent, it is whether it differs from what is stored.
   */
  const isUnchanged = useCallback(
    (value: string): boolean => treeToMarkdown(root).trimEnd() === value.trimEnd(),
    [root]
  );

  const scheduleParse = useCallback(() => {
    if (pendingRef.current) window.clearTimeout(pendingRef.current);
    pendingRef.current = window.setTimeout(() => {
      pendingRef.current = null;
      const value = textareaRef.current?.value ?? text;
      if (isUnchanged(value)) return;
      onUpdateRoot(parseMarkdownToTree(value, root.text, root), 'markdown');
    }, PARSE_DEBOUNCE_MS);
  }, [isUnchanged, onUpdateRoot, root, text]);


  const sayNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      setNotice('');
      noticeTimer.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (pendingRef.current) window.clearTimeout(pendingRef.current);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  /* ==================== LIFT (the same one, driven from the buffer) ==================== */

  const startLift = () => {
    if (!enableNodeMove) return;
    const { node } = caretNode();
    if (!node) {
      setHint('Coloque o cursor numa anotação para movê-la.');
      return;
    }
    if (node.id === parsedRoot.id) {
      setHint(MOVE_REFUSAL_TEXT.root);
      return;
    }
    const candidates = moveCandidates(parsedRoot, node.id);
    if (candidates.length === 0) {
      setHint('Não há outro tópico para receber este aqui.');
      return;
    }
    setLifted({ sourceId: node.id, targetId: candidates[0] });
  };

  /** The topic in flight, resolved for the banner. */
  const source = lifted ? findNodeById(parsedRoot, lifted.sourceId) : null;

  const commitLift = useCallback(
    (targetId?: string) => {
      if (!lifted) return;
      const destination = targetId ?? lifted.targetId;
      if (!destination) return;
      const sourceNode = findNodeById(parsedRoot, lifted.sourceId);
      const result = moveNode(parsedRoot, lifted.sourceId, destination);
      setLifted(null);
      if (!result.success) {
        setHint(MOVE_REFUSAL_TEXT[result.refusal ?? 'no-change']);
        return;
      }
      const before = branchIndexOf(parsedRoot, lifted.sourceId);
      const after = branchIndexOf(result.root, lifted.sourceId);
      const flips = before !== -1 && after !== -1 && before % 2 !== after % 2;
      const target = findNodeById(result.root, destination);
      setText(treeToMarkdown(result.root));
      onUpdateRoot(result.root, 'move');
      onSelectNode(lifted.sourceId, 'click');
      sayNotice(
        flips
          ? `“${sourceNode?.text.trim() || 'Tópico'}” movido para “${target?.text.trim() || ''}”. Ele muda de lado no mapa para o cliente.`
          : `“${sourceNode?.text.trim() || 'Tópico'}” movido para “${target?.text.trim() || ''}”.`
      );
    },
    [lifted, parsedRoot, onUpdateRoot, onSelectNode, sayNotice]
  );

  const stepTarget = useCallback(
    (delta: number) => {
      if (!lifted) return;
      const candidates = moveCandidates(parsedRoot, lifted.sourceId);
      if (candidates.length === 0) return;
      const i = Math.max(0, candidates.indexOf(lifted.targetId ?? ''));
      setLifted({ ...lifted, targetId: candidates[Math.min(candidates.length - 1, Math.max(0, i + delta))] });
    },
    [lifted, parsedRoot]
  );

  /**
   * Tab indents, Shift+Tab outdents — on the selected lines.
   *
   * The whole reason a plain textarea is not enough here, and the thing the
   * therapist flagged: Tab in a textarea normally moves focus, so the level of
   * a bullet would have to be typed as spaces. Every outliner solves it the
   * same way, by taking the key and rewriting the indent of the affected lines.
   *
   * Tab is therefore CAPTURED, which means it no longer moves focus out of the
   * field. That is a real accessibility cost and the one thing this mode is
   * worse at than the row editor, where every topic is its own focusable field
   * and Tab walks them natively. Escape leaves the textarea, so the field is
   * not a keyboard trap.
   *
   * Declared after startLift/stepTarget/commitLift on purpose: it is a plain
   * arrow function, not a useCallback, and it calls all three. Declaring it
   * earlier would close over them in their temporal dead zone and throw the
   * first time a key was pressed.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;

    /* A LIFT in flight owns the keys, and it is checked FIRST for the same
     * reason the row editor checks it first: the arrow keys below move the
     * caret, so a lift that lost the race would edit the text instead of
     * aiming the drop. */
    if (lifted) {
      e.preventDefault();
      if (e.key === 'ArrowDown') return stepTarget(1);
      if (e.key === 'ArrowUp') return stepTarget(-1);
      if (e.key === 'PageDown') return stepTarget(4);
      if (e.key === 'PageUp') return stepTarget(-4);
      if (e.key === 'Home') {
        const first = moveCandidates(parsedRoot, lifted.sourceId)[0];
        if (first) setLifted({ ...lifted, targetId: first });
        return;
      }
      if (e.key === 'End') {
        const all = moveCandidates(parsedRoot, lifted.sourceId);
        if (all.length) setLifted({ ...lifted, targetId: all[all.length - 1] });
        return;
      }
      if (e.key === 'Enter') return commitLift();
      if (e.key === 'Escape') {
        setLifted(null);
        return;
      }
      return;
    }

    if (isLiftChord(e) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      e.stopPropagation();
      startLift();
      return;
    }

    if (e.key === 'Escape') {
      // The escape hatch for the captured Tab.
      e.preventDefault();
      el.blur();
      return;
    }

    if (e.key !== 'Tab') return;
    e.preventDefault();

    const { selectionStart, selectionEnd, value } = el;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineEndRaw = value.indexOf('\n', selectionEnd);
    const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');

    const next = lines
      .map((line) => {
        // A bullet's indent is meaningful; the "#" session line is not a bullet
        // and indenting it would hide the session row from the parser.
        if (e.shiftKey) {
          return line.startsWith(INDENT) ? line.slice(INDENT.length) : line.replace(/^\s/, '');
        }
        if (line.trim() === '' || line.trimStart().startsWith('#')) return line;
        return INDENT + line;
      })
      .join('\n');

    if (next === block) return;
    const updated = value.slice(0, lineStart) + next + value.slice(lineEnd);
    setText(updated);
    // Put the caret back where the same text now lives, adjusted by how much
    // the first line's indent grew or shrank.
    const delta = next.length - block.length;
    requestAnimationFrame(() => {
      el.setSelectionRange(selectionStart + delta, selectionEnd + delta);
    });
    scheduleParse();
  };

  return (
    <div
      className={`@container flex flex-1 min-h-0 flex-col min-w-0 overflow-hidden select-text bg-surface-raised text-content ${
        hidden ? 'hidden' : ''
      }`}
      style={{ fontSize: `calc(1rem * var(--row-scale, ${outlineFontScale}))` }}
    >
      {/* Header. Same shape as the row editor's, so switching between the two
          modes does not move the controls the therapist already knows. */}
      <div className="px-4 py-3 border-b border-line-muted shrink-0 bg-surface-inset text-content">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-bold tracking-tight">
          <span className="uppercase text-[11px] tracking-wider text-content-muted">
            Tópicos da Sessão
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-bold text-content-muted">
              {flatItems.length} balões
            </span>
            {onToggleMaximize && (
              <button
                type="button"
                onClick={onToggleMaximize}
                title={maximizeOutline ? 'Mostrar a prévia do mapa ao lado' : 'Expandir os tópicos para a tela inteira'}
                aria-label={maximizeOutline ? 'Mostrar a prévia do mapa ao lado dos tópicos' : 'Expandir os tópicos para a tela inteira, ocultando o mapa'}
                aria-pressed={maximizeOutline}
                className="ctl w-7 h-7 !min-h-0 px-0"
              >
                {maximizeOutline ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <PanelLeft className="w-3.5 h-3.5" aria-hidden="true" />}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px] font-mono text-content-muted">
          <strong className="font-bold text-content">Tab</strong>
          <span>indenta</span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-bold text-content">Shift+Tab</strong> desindenta
          </span>
          {enableNodeMove && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="font-bold text-content">Ctrl+Shift+M</strong> move
              </span>
            </>
          )}
        </div>
      </div>

      {lifted && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 px-4 py-2 border-t border-line bg-surface-inset text-[11px] font-semibold text-content flex items-start gap-1.5"
        >
          <MoveVertical className="w-3.5 h-3.5 shrink-0 mt-px text-accent-text" aria-hidden="true" />
          <span className="min-w-0">
            Movendo “{source?.text || 'tópico'}” —{' '}
            <strong className="font-bold">setas</strong> escolhem o destino,{' '}
            <strong className="font-bold">Enter</strong> confirma,{' '}
            <strong className="font-bold">Esc</strong> cancela.
          </span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 px-4 py-2 border-t border-line bg-accent-soft text-[11px] font-semibold text-content flex items-start gap-1.5"
        >
          <Info className="w-3.5 h-3.5 shrink-0 mt-px text-accent-text" aria-hidden="true" />
          <span className="min-w-0">{notice}</span>
        </div>
      )}

      {hint && !lifted && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 px-4 py-2 border-t border-line bg-accent-soft text-[11px] font-semibold text-content flex items-start gap-1.5"
        >
          <Info className="w-3.5 h-3.5 shrink-0 mt-px text-accent-text" aria-hidden="true" />
          <span className="min-w-0">{hint}</span>
        </div>
      )}

      {/* The buffer.

          One control, not one per topic. That is the whole trade this mode
          makes: a textarea copies, cuts, pastes and selects across levels with
          no code at all, and in exchange the outline stops being a list of
          individually focusable fields. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-hidden flex">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setHint('');
            setText(e.target.value);
            scheduleParse();
            broadcastCaret();
          }}
          onKeyDown={handleKeyDown}
          onSelect={broadcastCaret}
          onBlur={() => {
            /* Commit immediately on blur rather than waiting out the debounce:
             * switching session or opening a modal must not carry a
             * half-parsed tree across.
             *
             * Reads the ELEMENT, not the `text` state. A blur can arrive in
             * the same tick as the change that caused it, before React has
             * re-rendered with the new value — and the closure would still hold
             * the previous text, so the commit would be a no-op and the last
             * edit before leaving the field would be silently lost. The
             * textarea is the source of truth while it has focus. */
            if (pendingRef.current) window.clearTimeout(pendingRef.current);
            pendingRef.current = null;
            const value = textareaRef.current?.value ?? text;
            if (!isUnchanged(value)) {
              onUpdateRoot(parseMarkdownToTree(value, root.text, root), 'markdown');
            }
            onSelectNode(null, 'clear');
          }}
          spellCheck={false}
          aria-label="Tópicos da sessão em texto, com a hierarquia indicada por indentação"
          className={`flex-1 min-h-0 w-full resize-none bg-transparent p-3 outline-none font-mono leading-relaxed text-content placeholder:text-content-subtle ${
            isDark ? 'text-white' : 'text-content'
          }`}
          style={{ fontSize: 'calc(0.875rem * var(--row-scale, 1))' }}
        />
      </div>

      {/* Why the buffer says what it says, and how to get back out of Tab. */}
      <div className="shrink-0 px-4 py-2 border-t border-line bg-surface-inset text-[11px] text-content-muted flex items-start gap-1.5">
        <Keyboard className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
        <span className="min-w-0 leading-relaxed">
          <strong className="font-semibold text-content">-</strong> marca um tópico,{' '}
          <strong className="font-semibold text-content">Tab</strong> aumenta o nível e{' '}
          <strong className="font-semibold text-content">Esc</strong> solta o teclado
          (o Tab fica preso aqui de propósito). Selecione um bloco e cole em outro
          lugar para mover um ramo inteiro.
        </span>
      </div>
    </div>
  );
};
