import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Info, PanelLeft, Minimize2 } from 'lucide-react';
import { FlatOutlineItem, MindMapNode, SelectReason } from '../../types';
import { findNodeById, flattenTree, parseMarkdownToTree, treeToMarkdown } from '../../utils/tree';
import { readLine, lineIndexAt, topicLines, parentTopicLine, BufferLine } from '../../utils/bufferLine';

interface MarkdownOutlineProps {
  root: MindMapNode;
  /** Commits a parsed tree. `reason` decides whether it is one undo step. */
  onUpdateRoot: (newRoot: MindMapNode, reason: string) => void;
  onSelectNode: (nodeId: string | null, reason: SelectReason) => void;
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
 * Everything one question about one position needs.
 *
 * Five positional parameters was five ways to call this wrong, and two of them
 * — the value and the line index — are not independent: neither means anything
 * without the other. Bundling them says what the function actually asks, which
 * is "given where the caret is, what does a new bullet there attach to".
 */
interface CaretPlace {
  /** The buffer as typed. */
  value: string;
  /** The line the caret is on, already taken apart. */
  line: BufferLine;
  /** The topics, root excluded, in document order. */
  topics: FlatOutlineItem[];
  /** The line index of every topic, parallel to `topics`. */
  starts: number[];
}

/**
 * The topic an empty bullet at the caret's indent would become a child of.
 *
 * Walks the lines above and takes the first one that is a topic at a SHALLOWER
 * indent, which is exactly how the parser nests. A bullet at column zero finds
 * nothing and returns null, and the caller reads that as the session root.
 */
function parentAbove({ value, line, topics, starts }: CaretPlace): FlatOutlineItem | null {
  const parentLine = parentTopicLine(value, line.index, line.indent);
  if (parentLine === -1) return null;
  // `starts` is carried in rather than recomputed: the caller already walked
  // the buffer for the caret's own line, and doing it twice on every caret
  // move is the kind of redundancy that turns into a stall once a session is
  // long.
  const ordinal = starts.indexOf(parentLine);
  if (ordinal === -1) return null;
  return topics[ordinal] ?? null;
}

export const MarkdownOutline: React.FC<MarkdownOutlineProps> = ({
  root,
  onUpdateRoot,
  onSelectNode,
  onDraftChange,
  selectedNodeId,
  theme,
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
  const [showHelp, setShowHelp] = useState(false);
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
  const liveValueRef = useRef('');
  const liveTreeRef = useRef<{ items: FlatOutlineItem[]; root: MindMapNode } | null>(null);

  /**
   * The tree the buffer describes, parsed ONCE per distinct text.
   *
   * It used to be parsed three times over: a memo on `text`, a second pass for
   * the caret reading the DOM, and a third at commit time. Each pass mints
   * fresh ids for every node it cannot recycle by position, so a topic created a
   * moment earlier had one id in the caret, another in the tree that was
   * committed, and a third once that one was re-read. The mind map renders the
   * COMMITTED tree while the selection names an id from this one, so the two
   * never matched: no selection halo on a topic being written, and no recentre
   * either — `centreOn` looks the id up in the committed layout, fails, and
   * returns. The map only appeared to follow because autoFit was re-framing.
   *
   * One parse fixes it by construction rather than by synchronising: the commit
   * hands over the very tree this returned, so the id the caret saw is the id
   * the map will look for.
   *
   * Keyed on the DOM value, not on the state, because `setText` is async — on
   * the keystroke that turns "- " into "- sono" the state still holds the old
   * text. An arrow key does not change the value, so it does not re-parse.
   */
  const liveTree = useCallback((): { items: FlatOutlineItem[]; root: MindMapNode } => {
    const el = textareaRef.current;
    const value = el ? el.value : text;
    if (liveTreeRef.current && liveValueRef.current === value) return liveTreeRef.current;
    const parsed = parseMarkdownToTree(value, root.text, root);
    const next = { items: flattenTree(parsed, 0, null, 0, true), root: parsed };
    liveValueRef.current = value;
    liveTreeRef.current = next;
    return next;
  }, [root, text]);

  /**
   * How many balloons the buffer describes, for the header's count.
   *
   * A useMemo that CALLS liveTree rather than a second parse of its own: the
   * cache is keyed on the string, so when this runs the tree is already there
   * and it is a lookup. Deriving the count from a different parse would be the
   * same id-mismatch mistake again, one field over.
   */
  const balloonCount = useMemo(() => liveTree().items.length, [liveTree, text]);

  /**
   * Which topic the caret is in, and where a new one would land.
   *
   * The text has no ids, so the caret has to be mapped back to a node for the
   * client broadcast and the highlight. It is matched by POSITION: the Nth line
   * that starts a topic is the Nth topic. Matching by text was the obvious
   * thing, and it is wrong the moment a session says the same word twice — for
   * notes about sleep, family or anxiety that is not an edge case but a
   * Tuesday. Two "ansiedade" lines, and the map lit the first one whichever
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
    /* The live tree, not the committed one: on the keystroke that completes a
       topic, `text` has not caught up and the topic has no node yet. */
    const live = liveTree();
    const topics = live.items.filter((i) => i.id !== live.root.id);
    const starts = topicLines(value);
    const aligned = starts.length === topics.length;
    const ordinal = starts.indexOf(lineIndex);

    /* THE SESSION HEADING IS THE ROOT NODE, which is what it is: the session's
     * own name. Reading it as "not a topic" left the map dead on the one line a
     * therapist lands on first, and dead on the client's screen with it. The
     * lift already refuses to move the root, so resolving it costs nothing. */
    if (line.isHeading) {
      return {
        node: live.items[0] ?? null,
        parentId: live.root.id,
        parentText: live.root.text,
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
      const parentItem = parentAbove({ value, line, topics, starts });
      return {
        node: null,
        parentId: parentItem?.id ?? live.root.id,
        // A bullet at column zero has no shallower topic above it, so its parent
        // is the session. Saying so here rather than leaving it undefined saves
        // the view a fallback lookup to reach the same answer.
        parentText: parentItem?.text ?? live.root.text,
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

    const parent = own.parentId ? findNodeById(live.root, own.parentId) : null;
    return {
      node: own,
      parentId: own.parentId ?? live.root.id,
      parentText: parent?.text,
      onBullet: true,
      lineIndex,
    };
  }, [liveTree]);

  const broadcastCaret = useCallback(
    (caret: Caret) => {
      onDraftChange({
        mode: caret.node && caret.node.text ? 'edit' : 'add',
        parentId: caret.node ? (caret.node.parentId ?? liveTree().root.id) : caret.parentId,
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
    [liveTree, onDraftChange]
  );

  /* ==================== WHERE THE CARET IS ==================== */

  /**
   * The topic the map is already following — in both windows.
   *
   * Held so the follow is a CHANGE, not a position: arrowing across a line
   * character by character would otherwise re-centre the map on every
   * keystroke, which reads as the map chasing the cursor rather than showing
   * where you are.
   */
  const followedRef = useRef<string | null>(null);

  /**
   * Moves the therapist's OWN map to the topic under the cursor.
   *
   * Both windows, immediately. A therapist writing in the left pane wants the
   * balloon they are writing into in the middle of their own window AND in the
   * client's; making either of them wait, or navigate somewhere else first, is
   * the map not answering a question that was asked.
   */
  const announceCaret = useCallback(
    (caret: Caret) => {
      const id = caret.node?.id ?? null;
      if (id === followedRef.current) return;
      followedRef.current = id;
      onSelectNode(id, 'caret');
    },
    [onSelectNode]
  );

  /**
   * Where the caret went, and what that should mean for the highlight.
   *
   * Navigation ARMS the dwell rather than highlighting, or the setting would
   * control nothing; a pointer click is a deliberate act on one topic and
   * highlights at once.
   */
  /**
   * A click is a deliberate act on one topic and says so. Everything else —
   * an arrow, a keystroke, a fresh bullet — is the caret being somewhere, and
   * the map follows the TOPIC it is on. Which is a change, not a position:
   * announced once per topic, so typing inside one does not re-centre the map
   * on every character.
   */
  const followCaret = useCallback(
    (intent: 'navigate' | 'typing' | 'explicit') => {
      const caret = caretNode();
      broadcastCaret(caret);
      if (intent === 'explicit') {
        followedRef.current = caret.node?.id ?? null;
        onSelectNode(caret.node?.id ?? null, 'click');
        return;
      }
      announceCaret(caret);
    },
    [announceCaret, broadcastCaret, caretNode, onSelectNode]
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
      /* liveTree, NOT a second parse of `value` here.

         This is the path a paste takes — the debounce is what commits a whole
         document — and a second parse mints fresh ids for every node it cannot
         recycle by position. The caret had already resolved against the first
         parse, so the tree the mind map then rendered held DIFFERENT ids for the
         same topics: no node matched the selection, nothing highlighted, and
         centreOn could not find anything to centre. It looked like navigation
         simply stopped working partway down a long document, and the first few
         topics worked because their ids happened to line up.

         The blur handler below got this right. Two call sites, one of them
         fixed, is the whole reason it went unnoticed. */
      onUpdateRoot(liveTree().root, 'markdown');
    }, PARSE_DEBOUNCE_MS);
  }, [isUnchanged, liveTree, onUpdateRoot, root, text]);


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


  /**
   * Tab indents, Shift+Tab outdents — on the selected lines.
   *
   * The whole reason a plain textarea is not enough here, and the thing the
   * therapist flagged: Tab in a textarea normally moves focus, so the level of
   * a bullet would have to be typed as spaces. Every outliner solves it the
   * same way, by taking the key and rewriting the indent of the affected lines.
   *
   * Tab is therefore CAPTURED, which means it no longer moves focus out of the
   * field. That is a real accessibility cost, and it is the price of the trade:
   * in exchange, selection and cut-and-paste work ACROSS levels, which the
   * browser gives for free and a list of one-input-per-topic never could.
   * Escape leaves the textarea, so the field is not a keyboard trap.
   *
   * It is a plain arrow function rather than a useCallback because it closes
   * over commitEdit, which is declared just above it.
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
   * inside nothing, which is what every outliner does. Without it, a therapist
   * who keeps pressing Enter walks down the buffer leaving a stack of blanks.
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

    if (e.key === 'Escape') {
      // The escape hatch for the captured Tab.
      e.preventDefault();
      el.blur();
      return;
    }

    /* Enter starts the next topic. Shift+Enter is left alone, so a thought can
     * still run over two lines. */
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
      {/* Header. */}
      <div className="px-4 py-3 border-b border-line-muted shrink-0 bg-surface-inset text-content">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-bold tracking-tight">
          <span className="uppercase text-[11px] tracking-wider text-content-muted">
            Tópicos da Sessão
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-bold text-content-muted">
              {balloonCount} balões
            </span>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              aria-expanded={showHelp}
              aria-controls="buffer-help"
              aria-label="Como escrever e mover tópicos"
              title="Como escrever e mover tópicos"
              className="ctl w-7 h-7 !min-h-0 px-0"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
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
        {/* Two keys, and only the two a textarea cannot show for itself. Tab is
            CAPTURED here to indent, which is invisible until it surprises
            someone, and Esc is the only way out. Everything else is either
            guessable or behind the help button — a footer that explained
            everything taught the things nobody needed and buried the two that
            mattered. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px] font-mono text-content-muted">
          <strong className="font-bold text-content">Tab</strong>
          <span>indenta</span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-bold text-content">Esc</strong> solta o Tab
          </span>
        </div>
      </div>

      {/* PROGRESSIVE DISCLOSURE. An inline panel, not a popover: nothing is
          positioned, nothing is trapped, and there is no second close path to
          get wrong. A reference you open once and read does not need a dialog. */}
      {showHelp && (
        <div
          id="buffer-help"
          role="region"
          aria-label="Como escrever e mover tópicos"
          className="shrink-0 px-4 py-3 border-t border-line bg-surface-inset text-[11px] leading-relaxed text-content-muted"
        >
          <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-x-6">
            <p className="min-w-0">
              <strong className="font-bold text-content">Escrever</strong>
            </p>
            <p className="min-w-0">
              <strong className="font-bold text-content">Mover</strong>
            </p>

            <p className="min-w-0">
              <code className="text-content">-</code> no começo da linha cria um tópico
            </p>
            <p className="min-w-0 sm:row-span-3">
              Recorte um bloco e cole onde ele devia ficar. A{' '}
              <strong className="font-bold text-content">indentação da primeira linha</strong>{' '}
              decide quem é o pai — o lugar onde o cursor parou não decide nada.
            </p>

            <p className="min-w-0">
              <strong className="font-bold text-content">Enter</strong> abre o próximo
              tópico no mesmo nível
            </p>
            <p className="min-w-0">
              <strong className="font-bold text-content">Tab</strong> /{' '}
              <strong className="font-bold text-content">Shift+Tab</strong> aumenta /
              diminui o nível
            </p>
            <p className="min-w-0">
              Em <strong className="font-bold text-content">Esc</strong>, o bullet vazio
              some
            </p>
          </div>
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

      {hint && (
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
           * key all move the caret and all fire it, so the follow tracks the
           * caret rather than a list of keys that would still miss the mouse. */
          onSelect={() => followCaret('navigate')}
          onClick={() => {
            /* A click is a deliberate act, so it says so rather than letting
             * the select above speak for it. Whichever order the browser fires
             * them in, the outcome is the same node: select follows, click
             * follows and marks it deliberate. */
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
            const value = textareaRef.current?.value ?? text;
            if (!isUnchanged(value)) {
              onUpdateRoot(liveTree().root, 'markdown');
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

    </div>
  );
};
