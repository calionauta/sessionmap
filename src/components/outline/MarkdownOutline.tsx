import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, Keyboard, ListTree, MoveVertical, PanelLeft, Minimize2 } from 'lucide-react';
import { FlatOutlineItem, MindMapNode } from '../../types';
import { findNodeById, moveNode, branchIndexOf, flattenTree, parseMarkdownToTree, treeToMarkdown } from '../../utils/tree';
import { isLiftChord, moveCandidates, MOVE_REFUSAL_TEXT } from '../../utils/lift';
import { readLine, lineIndexAt, topicLines, parentTopicLine } from '../../utils/bufferLine';

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
  /**
   * Seconds the caret must rest on a topic before its balloon lights up.
   *
   * The setting is global and the row editor has always honoured it, so a
   * therapist who set it to 3 seconds and then switched to this mode was told
   * nothing and simply got no auto-focus. 0 means "never", which is honoured
   * here too rather than treated as "use the default".
   */
  focusDwellSeconds: number;
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

/** Everything the caret's line implies, resolved against the parsed tree. */
interface Caret {
  /** The topic the caret is inside, or null when the line is not one yet. */
  node: FlatOutlineItem | null;
  /** Where a new topic on this line would attach. */
  parentId: string | null;
  parentText: string | undefined;
  /** The line is the session heading or a bullet — either way the map cares. */
  onBullet: boolean;
  lineIndex: number;
}

/**
 * The topic an empty bullet at `indent` would become a child of.
 *
 * Walks the lines above and takes the first one that is a topic at a SHALLOWER
 * indent, which is exactly how the parser nests. A bullet at column zero finds
 * nothing and returns null, and the caller reads that as the session root.
 */
function parentAbove(
  value: string,
  lineIndex: number,
  indent: string,
  topics: FlatOutlineItem[],
  rootId: string
): FlatOutlineItem | null {
  const parentLine = parentTopicLine(value, lineIndex, indent);
  if (parentLine === -1) return null;
  const ordinal = topicLines(value).indexOf(parentLine);
  if (ordinal === -1) return null;
  return topics[ordinal] ?? null;
}

export const MarkdownOutline: React.FC<MarkdownOutlineProps> = ({
  root,
  onUpdateRoot,
  onSelectNode,
  onDraftChange,
  selectedNodeId,
  focusDwellSeconds,
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
   * Which topic the caret is in, and where a new one would land.
   *
   * The text has no ids, so the caret has to be mapped back to a node for the
   * client broadcast and the highlight. It is matched by POSITION: the Nth line
   * that starts a topic is the Nth topic. Matching by text was the obvious
   * thing, and it is wrong the moment a session says the same word twice — for
   * notes about sleep, family or anxiety that is not an edge case but a
   * Tuesday. Two "ansiedade" lines, and the dwell lit the first one whichever
   * line the caret was on.
   *
   * Position is trusted only when the counts agree, one topic-starting line per
   * topic, which is what the canonical form always produces. Pasted prose with
   * wrapped paragraphs and blank lines breaks the correspondence, and there the
   * text is a better guess than a count that has drifted.
   */
  const caretNode = useCallback((): Caret => {
    const el = textareaRef.current;
    const empty: Caret = {
      node: null,
      parentId: null,
      parentText: undefined,
      onBullet: false,
      lineIndex: -1,
    };
    if (!el) return empty;

    const value = el.value;
    const lineIndex = lineIndexAt(value, el.selectionStart);
    // The WHOLE line, not just the part before the caret. A caret sitting one
    // character into "- cansaço" would otherwise read the line as "-" and match
    // no topic at all, so the highlight and the lift would both do nothing
    // until the therapist typed further into the text.
    const line = readLine(value, lineIndex);
    const topics = flatItems.filter((i) => i.id !== parsedRoot.id);
    const starts = topicLines(value);
    const aligned = starts.length === topics.length;
    const ordinal = starts.indexOf(lineIndex);

    /* THE SESSION HEADING IS THE ROOT NODE, which is what it is: the session's
     * own name. Reading it as "not a topic" left the dwell dead on the one line
     * a therapist lands on first, and dead on the client's screen with it. The
     * lift already refuses to move the root, so resolving it costs nothing. */
    if (line.isHeading) {
      return {
        node: flatItems[0] ?? null,
        parentId: parsedRoot.id,
        parentText: parsedRoot.text,
        onBullet: true,
        lineIndex,
      };
    }

    // A blank line or a wrapped paragraph belongs to no topic, and saying so is
    // what keeps the footer from describing an edit nobody is making.
    if (!line.isBullet) return { ...empty, lineIndex };

    // An empty bullet has no node yet: the parser discards it. The parent comes
    // from the buffer's own indentation, because the tree cannot help for a node
    // that does not exist.
    if (line.isEmptyBullet) {
      const parentItem = parentAbove(value, lineIndex, line.indent, topics, parsedRoot.id);
      return {
        node: null,
        parentId: parentItem?.id ?? parsedRoot.id,
        // A bullet at column zero has no shallower topic above it, so its parent
        // is the session. Saying so here rather than leaving it undefined saves
        // the view a fallback lookup to reach the same answer.
        parentText: parentItem?.text ?? parsedRoot.text,
        onBullet: true,
        lineIndex,
      };
    }

    let own: FlatOutlineItem | null = null;
    if (ordinal !== -1 && aligned) {
      own = topics[ordinal];
    } else {
      const sameText = topics.filter((t) => t.text === line.text);
      if (sameText.length === 1) {
        own = sameText[0];
      } else if (sameText.length > 1 && ordinal !== -1) {
        // Duplicated text with the counts out of step: take the one nearest in
        // document order rather than always the first.
        own = sameText.reduce((best, t) =>
          Math.abs(topics.indexOf(t) - ordinal) < Math.abs(topics.indexOf(best) - ordinal)
            ? t
            : best
        );
      }
    }

    if (!own) return { ...empty, lineIndex, onBullet: true };

    const parent = own.parentId ? findNodeById(parsedRoot, own.parentId) : null;
    return {
      node: own,
      parentId: own.parentId ?? parsedRoot.id,
      parentText: parent?.text,
      onBullet: true,
      lineIndex,
    };
  }, [flatItems, parsedRoot]);

  const broadcastCaret = useCallback(
    (caret: Caret) => {
      onDraftChange({
        mode: caret.node && caret.node.text ? 'edit' : 'add',
        parentId: caret.node ? (caret.node.parentId ?? parsedRoot.id) : caret.parentId,
        parentText: caret.parentText,
        targetId: caret.node?.id ?? null,
        text: caret.node?.text ?? '',
        /* active is true for a bullet even when it is empty. The whole point
         * of the empty case is that something is being started: a ghost balloon
         * and a footer that says where. `Boolean(node)` here is what made both
         * of them vanish. */
        active: caret.onBullet,
      });
    },
    [onDraftChange, parsedRoot.id]
  );

  /* ==================== DWELL (auto-focus) ==================== */

  const dwellRef = useRef<{ nodeId: string; timer: number } | null>(null);

  const cancelDwell = useCallback(() => {
    if (dwellRef.current) {
      window.clearTimeout(dwellRef.current.timer);
      dwellRef.current = null;
    }
  }, []);

  /**
   * Resting the caret on a topic lights its balloon up, after the configured
   * delay.
   *
   * A plain setTimeout rather than the row editor's requestAnimationFrame loop,
   * and the difference is the whole reason: that loop exists to animate the
   * progress ring on the active row. There is no row here, so there is nothing
   * to draw, and a timer that fires once is less code than a loop that redraws
   * sixty times a second to report the same thing.
   *
   * Armed on every caret move and on typing. Typing counts as resting: a
   * therapist working through a session writes a thought, pauses to think, and
   * that pause is exactly the moment the map should catch up with them.
   */
  const armDwell = useCallback(
    (nodeId: string | null) => {
      cancelDwell();
      if (!nodeId || focusDwellSeconds <= 0) return;
      dwellRef.current = {
        nodeId,
        timer: window.setTimeout(() => {
          dwellRef.current = null;
          onSelectNode(nodeId, 'focus3s');
        }, focusDwellSeconds * 1000),
      };
    },
    [cancelDwell, focusDwellSeconds, onSelectNode]
  );

  useEffect(() => cancelDwell, [cancelDwell]);

  /**
   * The line the dwell was last armed for.
   *
   * A dwell is about a TOPIC, and a topic is a line. Moving the caret left and
   * right inside one line changes nothing the map can show, so re-arming on
   * every arrow press was churn: a timer torn down and rebuilt for a balloon
   * that was never going to be a different balloon. Only a change of line
   * re-arms, which is also the only change that can change the answer.
   *
   * Typing is the exception and does re-arm, because it changes the text of the
   * balloon. A therapist writing a thought and pausing to think should see the
   * map catch up with what they have written so far, not with what they wrote
   * before the pause.
   */
  const armedLineRef = useRef<number>(-1);

  /**
   * Where the caret went, and what that should mean for the highlight.
   *
   * Same intents the row editor uses, for the same reason. Navigation ARMS the
   * dwell rather than highlighting, or the setting would control nothing; a
   * pointer click is a deliberate act on one topic and highlights at once.
   */
  const followCaret = useCallback(
    (intent: 'navigate' | 'typing' | 'explicit') => {
      const caret = caretNode();
      broadcastCaret(caret);

      if (intent === 'explicit') {
        cancelDwell();
        armedLineRef.current = caret.lineIndex;
        onSelectNode(caret.node?.id ?? null, 'click');
        return;
      }
      if (intent === 'navigate' && caret.lineIndex === armedLineRef.current) {
        return;
      }
      armedLineRef.current = caret.lineIndex;
      armDwell(caret.node?.id ?? null);
    },
    [armDwell, broadcastCaret, cancelDwell, caretNode, onSelectNode]
  );

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
  /**
   * Rewrites the buffer, puts the caret where it belongs, and re-broadcasts.
   *
   * The re-broadcast is explicit rather than left to the browser's `select`
   * event, which setSelectionRange does fire but which fires only sometimes in
   * practice and never in the test DOM. Without it, a key that rewrites the
   * buffer programmatically leaves the map describing the line the caret just
   * left. Calling it twice is harmless: followCaret ignores a second call on
   * the same line.
   */
  const commitEdit = (next: string, caretAt: number) => {
    setText(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.setSelectionRange(caretAt, caretAt);
      followCaret('navigate');
    });
    scheduleParse();
  };

  /**
   * Enter starts the next topic at the same level.
   *
   * A plain textarea's Enter reproduces the previous line's INDENT but not its
   * bullet, so it produced a line the parser reads as a wrapped paragraph
   * folded into the topic above — no new topic, no ghost balloon, and the
   * therapist having to type "- " by hand every single time. It is the one
   * thing a textarea cannot do and an outliner must, so it is taken here.
   *
   * The marker is REPEATED rather than normalised to "- ". A buffer pasted
   * from a document that uses "*" keeps "*" while it is being edited, and the
   * canonical "-" arrives later as a visible rewrite the therapist can see and
   * undo. Swapping the marker under the caret with no visible cause is the
   * worse surprise of the two.
   *
   * Enter on an EMPTY bullet ends the topic instead of nesting another one
   * inside nothing, which is what every outliner does and what the row editor
   * already did here ("Anotação vazia descartada"). Without it, a therapist who
   * keeps pressing Enter walks down the buffer leaving a stack of blanks.
   *
   * Returns false for a line that is not a topic — a wrapped paragraph, a blank
   * line — and the caller lets the browser have the key, because there a soft
   * break IS what was meant. Shift+Enter is never intercepted: it is the way to
   * write a thought that runs over two lines.
   */
  const insertTopicLine = (el: HTMLTextAreaElement): boolean => {
    const { selectionStart, selectionEnd, value } = el;
    const line = readLine(value, lineIndexAt(value, selectionStart));

    // Leaving an empty topic: strip the bullet and put the caret where it was,
    // so typing continues as prose at the old level.
    if (line.isEmptyBullet) {
      // The line disappears along with ONE of the two newlines that bracketed
      // it. Taking neither leaves a blank line where the topic was; taking both
      // would join the line above to the one below. The following newline goes
      // first, and only the last line has to fall back to the one before it.
      const hasFollowingNewline = line.end < value.length;
      const keep = hasFollowingNewline ? line.start : Math.max(0, line.start - 1);
      commitEdit(value.slice(0, keep) + value.slice(line.end + (hasFollowingNewline ? 1 : 0)), keep + line.indent.length);
      return true;
    }

    // The session heading carries no bullet to repeat, so the first topic after
    // it is always a top-level "- ".
    const prefix = line.isHeading
      ? '- '
      : line.isBullet
        ? line.indent + line.marker + line.gap
        : null;
    if (prefix === null) return false;

    const insert = '\n' + prefix;
    commitEdit(
      value.slice(0, selectionEnd) + insert + value.slice(selectionEnd),
      selectionEnd + insert.length
    );
    return true;
  };

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

    /* Enter starts the next topic. After the lift, because a lifted row's Enter
     * is a commit — see the branch above. Shift+Enter is left alone so a
     * thought can still run over two lines. */
    if (e.key === 'Enter' && !e.shiftKey && insertTopicLine(el)) {
      e.preventDefault();
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
            followCaret('typing');
          }}
          onKeyDown={handleKeyDown}
          /* onSelect, not onKeyUp: a click, a drag-selection and every arrow
           * key all move the caret and all fire it, so the dwell follows the
           * caret rather than a list of keys that would still miss the mouse.
           *
           * 'navigate' rather than 'typing' on purpose — only a change of LINE
           * re-arms the dwell from here, so the left and right arrows inside
           * one topic do not keep restarting a timer whose answer cannot
           * change. */
          onSelect={() => followCaret('navigate')}
          onClick={() => {
            /* Resolves the dwell the select above armed. Whichever order the
             * browser fires them in, the outcome is the same node: select
             * arms, click cancels and highlights. Relying on that is safe here
             * because a re-armed dwell on the node just highlighted would only
             * re-broadcast an id that is already selected — there is no ring in
             * this mode for it to look wrong against. */
            followCaret('explicit');
          }}
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
            // Otherwise the dwell would fire into a field nobody is in and
            // light a balloon up on the way out.
            cancelDwell();
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

      {/* Why the buffer says what it says, and how to get back out of Tab.

          The cut-and-paste sentence used to read "selecione um bloco e cole em
          outro lugar para mover um ramo inteiro", which is TRUE and was the
          reason a therapist tried it — and it left out the one thing that
          decides the result. The destination is not where the caret landed; it
          is the indentation of the first pasted line. The same paste under a
          different indent builds a different tree, silently, and the footer was
          asking for a technique whose main rule it did not state.

          So it says the rule, and it points at Ctrl+Shift+M, which does the
          same thing without the indent bookkeeping. */}
      <div className="shrink-0 px-4 py-2 border-t border-line bg-surface-inset text-[11px] text-content-muted flex items-start gap-1.5">
        <Keyboard className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
        <span className="min-w-0 leading-relaxed">
          <strong className="font-semibold text-content">-</strong> marca um tópico,{' '}
          <strong className="font-semibold text-content">Tab</strong> aumenta o nível e{' '}
          <strong className="font-semibold text-content">Esc</strong> solta o teclado
          (o Tab fica preso aqui de propósito).
          {enableNodeMove && (
            <>
              {' '}
              <strong className="font-semibold text-content">Ctrl+Shift+M</strong>{' '}
              move o tópico sob o cursor.
            </>
          )}{' '}
          Recortar e colar um ramo também funciona — o nível de onde ele colar
          é o que decide o pai, não o lugar onde o cursor parou.
        </span>
      </div>
    </div>
  );
};
