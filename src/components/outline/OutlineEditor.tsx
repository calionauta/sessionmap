import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  CornerDownRight,
  Info,
  Search,
  X,
  ChevronUp,
  MoveVertical,
  Check,
  PanelLeft,
  Minimize2,
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
  moveNode,
  moveCandidates,
  initialLiftTarget,
  stepLiftTarget,
  branchIndexOf,
  MOVE_REFUSAL_TEXT,
  deleteNode,
  toggleNodeCollapse,
  findParentAndIndex,
  findNodeById,
  parseMarkdownToTree,
  searchNormalize,
  matchesQuery,
} from '../../utils/tree';

/**
 * The chord that lifts a row for re-parenting.
 *
 * Shift is not optional here, and that is a macOS constraint rather than a
 * style choice. Cmd+M minimizes the window and Option+M is a system chord;
 * both are claimed by the window manager, which intercepts them BEFORE the
 * page receives the keydown. No amount of preventDefault reaches that layer,
 * so the original Alt+M binding did nothing in a browser on macOS while the
 * window quietly minimized. A two-modifier chord is outside what macOS
 * reserves, and all three common forms are accepted so neither Cmd nor Ctrl
 * users are left out.
 *
 * The visible Mover button on each row calls the same startLift, so the
 * gesture is reachable even where no chord survives the OS.
 */
export function isLiftChord(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (!e.shiftKey) return false;
  // Exactly one modifier, so a three-finger mash is not a lift.
  const mods = [e.ctrlKey, e.metaKey, e.altKey].filter(Boolean).length;
  return mods === 1;
}

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
  /**
   * Allows re-parenting a topic to another branch.
   *
   * Gated rather than always on because a move is the one edit the therapist
   * cannot undo by typing: Ctrl+Z is the only way back, and a client is
   * watching the shared screen when it lands. The operation itself is fully
   * covered by tree.test.ts either way.
   */
  enableNodeMove: boolean;
  /**
   * Multiplies every dimension of a row, not only the glyphs. Scales the text,
   * the row's height, the indent step and the control gutter together, so the
   * hierarchy stays readable at a larger size instead of the text growing
   * inside rows that did not.
   */
  outlineFontScale?: number;
  /**
   * Whether the outline currently owns the whole window, and the toggle for it.
   *
   * Supplied by the host so the button sits on the sidebar header — the surface
   * it acts on — while the persisted state stays in one place. The control is
   * optional so a caller that does not offer the layout change simply does not
   * render it.
   */
  maximizeOutline?: boolean;
  onToggleMaximize?: () => void;
  /**
   * Hides the pane without unmounting it, while the client-notes panel takes
   * the full height. Kept mounted on purpose: unmounting would drop the row
   * focus and whatever the therapist had selected on the canvas.
   */
  hidden?: boolean;
}

export const OutlineEditor: React.FC<OutlineEditorProps> = ({
  root,
  onUpdateRoot,
  onDraftChange,
  onSelectNode,
  selectedNodeId,
  focusDwellSeconds = 3,
  theme,
  enableNodeMove = false,
  outlineFontScale = 1,
  maximizeOutline = false,
  onToggleMaximize,
  hidden = false,
}) => {
  const isDark = theme === 'noite';

  /**
   * Re-parenting ("lift").
   *
   * `liftedId` is the node in flight; `liftTargetId` is the row the cursor is
   * currently aiming at, and the destination is ALWAYS "last child of that
   * row". One destination, one position — reordering after the move is
   * Alt+Arrow, which is unambiguous on its own, whereas a move that could also
   * land before or after some row has three plausible outcomes per gesture and
   * one of them is always a mistake.
   *
   * The preview is a whole second ROOT, not a marker drawn between rows. That
   * is the whole trick: flattenTree() already knows how to render a tree, so
   * previewing means calling it on moveNode()'s result and letting the ordinary
   * row renderer show the subtree sitting at its new depth, with its own guide
   * line, in its new place. No placeholder rows, no second render path, and
   * the mouse and the keyboard share the same preview because they are the same
   * function.
   *
   * It is local state and MUST stay that way. Routing it through onUpdateRoot
   * would push a history entry and broadcast a snapshot, so the client's screen
   * would watch a subtree fly across and then snap back on Esc. Only Enter
   * commits.
   */
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const [liftTargetId, setLiftTargetId] = useState<string | null>(null);
  /**
   * True only while a POINTER is down on the Mover handle.
   *
   * Separate from isLifting because the cursor has to change to "grabbing" and
   * the lifted row has to look picked up. A keyboard lift is in the same state
   * but the pointer is not involved, so showing a grabbing cursor for it would
   * be a lie about what the user is doing.
   */
  const [isDragging, setIsDragging] = useState(false);

  const isLifting = liftedId !== null;

  /** The rows the lift cursor can land on, in visual order. */
  const liftCandidates = useMemo(
    () => (liftedId ? moveCandidates(root, liftedId) : []),
    [root, liftedId]
  );

  /**
   * The tree the outline actually renders.
   *
   * While lifting with the KEYBOARD this is the preview: the same list of rows,
   * recomputed from the moved tree, so the lifted subtree genuinely appears at
   * its destination depth. The rows are keyed by node id (see the key= below),
   * so React MOVES the input's DOM node instead of remounting it — focus, the
   * caret and the registration in inputRefs all survive the whole lift, which
   * is why there is no focus bookkeeping to write here.
   *
   * While a POINTER is dragging, it is deliberately NOT shown. Reordering the
   * list under a pointer is a feedback loop: the destination outline moves the
   * row the pointer is over, the next hit-test reads the row that took its
   * place, and the drop lands one row off what the user is looking at. The
   * dashed outline is enough — it names the destination without moving the
   * thing the pointer is tracking.
   */
  const previewRoot = useMemo(() => {
    if (!liftedId || !liftTargetId) return null;
    if (isDragging) return null;
    return moveNode(root, liftedId, liftTargetId).root;
  }, [root, liftedId, liftTargetId, isDragging]);

  const flatItems = flattenTree(
    previewRoot ?? root,
    0,
    null,
    0,
    true
  );

  const [activeNodeId, setActiveNodeId] = useState<string | null>(root.id);
  const [dwellProgress, setDwellProgress] = useState<number>(0);
  const [dwellActive, setDwellActive] = useState<boolean>(false);
  /** Transient explanation for a refused action, in a live region. */
  const [hint, setHint] = useState<string>('');
  /**
   * Outline search.
   *
   * It MARKS matches rather than filtering rows out. Hiding a row would hide
   * its ancestors, so a filtered outline is no longer a tree — a child whose
   * parents vanished reads as a root. The tree stays intact and the matching
   * rows are tinted, which is also what makes the whole-path context visible
   * while jumping around.
   */
  const [query, setQuery] = useState<string>('');
  const [matchCursor, setMatchCursor] = useState<number>(0);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);

  const normalizedQuery = searchNormalize(query);
  /** Rows whose text contains the query, in visual order. */
  const matchIds = normalizedQuery
    ? flatItems
        .filter((i) => matchesQuery(i.text, normalizedQuery))
        .map((i) => i.id)
    : [];
  const isSearching = normalizedQuery.length > 0;

  /**
   * Moves to the next/previous match and focuses that row.
   *
   * Focusing a row is what makes the search worth having: focusInput also
   * drives the map highlight and the client's live highlight, so jumping to a
   * match shows the therapist WHERE that thought sits in the shared screen,
   * not merely that the word exists somewhere in the list.
   */
  const stepMatch = (delta: number) => {
    if (matchIds.length === 0) return;
    const next = (matchCursor + delta + matchIds.length) % matchIds.length;
    setMatchCursor(next);
    // Jumping to a search hit is deliberate, so it highlights now. Making the
    // therapist wait out the dwell after already saying "take me here" would
    // be a second, invisible wait.
    focusInput(matchIds[next], true, 'explicit');
  };

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  /**
   * Row elements, for drag hit-testing by real geometry.
   *
   * Measuring beats guessing: a drop is decided by where the pointer actually
   * is over a row's box, which is what the eye is tracking, not by an index
   * count that drifts as rows resize with the font scale.
   */
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  /** The scrolling list, for edge auto-scroll during a drag. */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** Detaches the window-level listeners a drag installs. */
  const dragCleanupRef = useRef<(() => void) | null>(null);
  /**
   * Mirrors of the lift state, so the window-level pointerup handler reads the
   * CURRENT destination rather than the one captured when the drag started.
   * Without these a drag that ends over a different row than it began on would
   * commit the original target — the pointer moved, and the row followed the
   * eye, but the commit ignored both.
   */
  const liftTargetIdRef = useRef<string | null>(null);
  liftTargetIdRef.current = liftTargetId;
  const commitLiftRef = useRef<((destination?: string) => void) | null>(null);
  /**
   * Set by the end of a drag, consumed by the handle's onClick.
   *
   * The browser fires a click after every pointerup, including a drag's. That
   * click is not a second gesture, it is the tail of the first one.
   */
  const suppressClickRef = useRef(false);
  /**
   * Focus that could not be applied synchronously because the target input
   * had not mounted yet. Applied by the input's ref callback, and flushed as a
   * safety net by the effect below in case the row reuses an existing node id.
   */
  const pendingFocusRef = useRef<{ nodeId: string; selectAll: boolean } | null>(null);

  /**
   * Stable focus helper shared by focusInput() and the input ref callback.
   * A ref (not a closure) so the ref callback does not need to be re-created
   * on every render just to reach it.
   */
  const applyFocusRef = useRef(
    (el: HTMLInputElement, _nodeId: string, selectAll: boolean) => {
      el.focus();
      if (selectAll) {
        el.select();
      } else {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }
  );
  const dwellTimerRef = useRef<number | null>(null);
  const dwellAnimRef = useRef<number | null>(null);
  const dwellStartTimeRef = useRef<number>(0);

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

  // Declared after startDwellTimer on purpose: focusInput arms the dwell,
  // so startDwellTimer must already exist when this dependency array is
  // evaluated.
  /**
   * Why the focus is moving.
   *
   * 'navigate' — traversal (arrows, Enter, Tab, undo, cancel, creating a row).
   *   The map and the client screen do NOT follow, because that is what the
   *   dwell setting exists to control. The dwell timer is armed instead, so
   *   parking on a row for the configured time highlights it.
   *
   * 'explicit' — a deliberate act on one node: a pointer click on a row, or
   *   jumping to a search match. Highlights immediately, no dwell wait.
   */
  type FocusIntent = 'navigate' | 'explicit';

  // Synchronous, zero-latency focus & selection!
  const focusInput = useCallback(
    (
      nodeId: string,
      selectAll: boolean = false,
      intent: FocusIntent = 'navigate'
    ) => {
      setActiveNodeId(nodeId);

      if (intent === 'explicit') {
        onSelectNode(nodeId, 'click');
      } else {
        // Respect the setting: traversal only ARMS the dwell. With
        // focusDwellSeconds at 0 startDwellTimer returns early, so traversal
        // never auto-highlights and only a click does.
        startDwellTimer(nodeId);
      }

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

      // The target input may not exist yet. Creating a sibling/child calls
      // onUpdateRoot, which only SCHEDULES a re-render; React has not
      // committed the new <input> by the time this runs, so
      // inputRefs.current has no entry for it. Previously that case fell
      // through silently, the new row mounted with the caret still in the
      // previous row, and typing edited the wrong node.
      //
      // Record the intent and let the ref callback apply it on mount.
      const el = inputRefs.current.get(nodeId);
      if (el) {
        applyFocusRef.current(el, nodeId, selectAll);
      } else {
        pendingFocusRef.current = { nodeId, selectAll };
      }
    },
    [onSelectNode, root, onDraftChange, startDwellTimer]
  );

  useEffect(() => {
    return () => {
      resetDwellTimer();
    };
  }, [resetDwellTimer]);

  // Safety net: if a deferred focus is still pending after the commit, the row
  // either rendered or the target no longer exists. Applying it here covers the
  // case where React reuses an already-mounted input (same node id), which does
  // not re-run the ref callback, and clears the request when the target is gone
  // so a later stray mount cannot steal focus.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const el = inputRefs.current.get(pending.nodeId);
    if (el) {
      pendingFocusRef.current = null;
      applyFocusRef.current(el, pending.nodeId, pending.selectAll);
    } else if (findNodeById(root, pending.nodeId) === null) {
      pendingFocusRef.current = null;
    }
  });

  // The dwell timer is armed from a deliberate POINTER click on a row (see
  // the row onClick below), never from activeNodeId.
  //
  // The timer is the ONLY thing that auto-highlights during traversal now.
  // It used to be decoration: focusInput() broadcast onSelectNode(id,
  // 'navigate') synchronously on every step and ClientView treats every
  // `reason` identically, so the dwell was re-sending a node that had already
  // been sent, and focusDwellSeconds controlled nothing at all.
  //
  // There were two broadcasters, not one. handleKeyDown was the obvious one,
  // but the input's onFocus was the back door: arrowing the caret moves DOM
  // focus, onFocus fired, and the map followed regardless of the key handler.
  // Fixing only the key handler would have left traversal broadcasting.
  //
  // Traversal arms the timer; parking for the configured time fires it; a
  // pointer click bypasses it entirely. With focusDwellSeconds at 0 the timer
  // never arms, so only a click highlights.

  /**
   * Refuses to create a child under a row with no text, and says why.
   *
   * Silently doing nothing (the previous behaviour) reads as a dropped key: the
   * therapist presses Ctrl+Enter, nothing appears, and the app looks broken.
   * The message is rendered in a live region, so it is announced rather than
   * only shown, and the caret is returned to the row with its text selected so
   * the next keystroke simply writes.
   */
  const rejectEmptyParent = (item: FlatOutlineItem) => {
    setHint('Escreva a anotação antes de criar um subitem dentro dela.');
    focusInput(item.id, true);
  };

  // Create Child directly (Ctrl+Enter or button)
  const handleCreateChild = (item: FlatOutlineItem) => {
    resetDwellTimer();

    // A lift is in flight: a new row would appear in the PREVIEW, then vanish
    // on Esc, or land in a tree that is about to be replaced. Refuse instead.
    if (isLifting) return;

    // A child of an empty row would be a thought hanging off nothing. The
    // parent has no text yet, so the tree would grow a subtree that renders as
    // "Sem título" in the map and in every export. The root is exempt: it
    // already holds the session date, and "Adicionar Novo Tópico" is meant to
    // seed a first child under it.
    if (item.id !== root.id && item.text.trim() === '') {
      rejectEmptyParent(item);
      return;
    }

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

  /**
   * Cancels a row that was created but never typed into. Runs on blur, so
   * moving the caret away drops the placeholder instead of leaving an empty
   * balloon in the map.
   *
   * The node is only removed when it is blank AND childless. A blank node that
   * acquired children is a real structural parent by then.
   */
  const handleCancelIfBlank = (item: FlatOutlineItem) => {
    if (item.id === root.id) return;
    if (item.text.trim() !== '') return;
    if ((item.node.children || []).length > 0) return;

    const { root: newRoot, nextFocusId } = deleteNode(root, item.id);
    onUpdateRoot(newRoot, 'delete');
    onDraftChange({
      mode: 'add',
      parentId: null,
      targetId: null,
      text: '',
      active: false,
    });
    // Caret lands on the next row so navigation continues where the user
    // expects; if this was the last row, on the one above.
    if (nextFocusId) {
      requestAnimationFrame(() => focusInput(nextFocusId));
    }
  };

  // Keyboard navigation & tree actions
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    item: FlatOutlineItem,
    currentIndex: number
  ) => {
    resetDwellTimer();

    /* LIFT FIRST, before every other branch.
     *
     * Placed here rather than lower down because the arrow branches below move
     * the caret and the selection. If the lift were handled after them, the very
     * first arrow would edit the row instead of aiming the drop, and the whole
     * gesture would look broken.
     */
    if (isLifting) {
      handleLiftKey(e);
      return;
    }

    /* 0. Lift the row for re-parenting.
     *
     * The binding is Cmd/Ctrl+Shift+M — or Alt+Shift+M where Alt is not an
     * OS modifier — because a single-modifier M is unusable on macOS: Cmd+M
     * minimizes and Option+M is a system shortcut, and those are handled by
     * the window manager before the page ever sees the keydown. A browser
     * cannot preventDefault its way out of an OS-owned chord, which is
     * exactly the failure class a modifier shortcut is exposed to. Adding
     * Shift clears the chords macOS claims, and Alt+Shift+M is accepted as
     * well for people on a layout where that is the natural chord.
     *
     * There is also a visible button on the active row, so the gesture is
     * reachable without remembering a chord at all.
     */
    if (isLiftChord(e) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      e.stopPropagation();
      startLift(item);
      return;
    }

    // 1. Ctrl+Enter or Cmd+Enter: CREATE DIRECT CHILD INSTANTLY!
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleCreateChild(item);
      return;
    }

    // 2. Standard Enter: Create Sibling
    if (e.key === 'Enter') {
      e.preventDefault();

      // Enter on a row that was never typed into cancels that row rather than
      // leaving an empty one and starting the next: the user was mid-thought
      // and a stray Return should not litter the map with placeholders. The
      // session timestamp is the root, which is never blank in practice, so
      // this does not make Enter inert on a fresh session.
      if (item.id !== root.id && item.text.trim() === '') {
        setHint('Anotação vazia descartada. Escreva algo antes de criar a próxima.');
        handleCancelIfBlank(item);
        return;
      }

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

  /* ==================== RE-PARENTING (the lift) ==================== */

  /**
   * How long the "movido para…" confirmation stays up.
   *
   * The existing `hint` band is the wrong channel for a success message:
   * handleInputChange clears it on the very next keystroke, so a confirmation
   * would be unreadable. The lift is a two-step gesture, and the question
   * "did it commit or not?" needs an answer that survives typing.
   */
  const LIFT_NOTICE_MS = 3500;
  const [liftNotice, setLiftNotice] = useState<string>('');
  const liftNoticeTimerRef = useRef<number | null>(null);

  const sayLiftNotice = useCallback((message: string) => {
    setLiftNotice(message);
    if (liftNoticeTimerRef.current) window.clearTimeout(liftNoticeTimerRef.current);
    liftNoticeTimerRef.current = window.setTimeout(() => {
      setLiftNotice('');
      liftNoticeTimerRef.current = null;
    }, LIFT_NOTICE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (liftNoticeTimerRef.current) window.clearTimeout(liftNoticeTimerRef.current);
      /* A drag's listeners are on the window, not on this component, so
       * unmounting does not remove them. A drag interrupted by a session
       * switch, a route change or a reload would leave them behind, and the
       * NEXT pointerup anywhere in the app would be delivered to a handler
       * holding a dead component's state — committing a move the therapist
       * never made. */
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  /**
   * A lift can only be driven from a row's input, because the arrow keys are
   * handled there. If focus leaves the rows — the search field, a modal, another
   * pane, or the tab itself — no keydown will ever reach the handler again, and
   * the outline would stay in "moving" with the arrows inert and no visible way
   * out. So focus leaving the pane ends the lift.
   *
   * This is the same reasoning that rules out a HELD modifier: a gesture the
   * app cannot recover from is worse than one it never offered. The lift is
   * local state, so cancelling costs nothing and the tree is untouched.
   */
  const outlinePaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isLifting) return;

    /**
     * Focus moved to a known element.
     *
     * Only a destination OUTSIDE the pane strands the lift: the search field,
     * a modal, another pane. The Mover button lives inside the pane, so a lift
     * started from it is a legitimate lift even when the browser moved focus
     * anyway (its onMouseDown preventDefault is meant to stop that, but that is
     * a behaviour the lift must not depend on to work at all).
     */
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next) return; // handled by window blur below
      if (!outlinePaneRef.current?.contains(next)) {
        setLiftedId(null);
        setLiftTargetId(null);
      }
    };

    /**
     * Focus left the document: alt-tab, the screensaver taking over, a system
     * dialog. Here relatedTarget is null and the keyup that would end a held
     * modifier never arrives, which is the reason a hold is unsafe at all. A
     * latch needs the same net.
     */
    const onWindowBlur = () => {
      setLiftedId(null);
      setLiftTargetId(null);
    };

    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [isLifting]);

  /** Drops the lift without touching the tree. Esc is the usual way out. */
  /**
   * The candidate whose row is nearest a pointer Y position.
   *
   * Takes the candidate list as an argument rather than closing over
   * `liftCandidates`. The window listeners a drag installs are created during
   * the pointerdown, which is BEFORE setLiftedId has re-rendered — so a closure
   * over the memo would have captured the empty list from the previous render
   * and every hit-test would return null. Passing it in means the same
   * computation works from the event handler and from the render.
   *
   * Nearest rather than "the row the pointer is inside", because the rows the
   * move cannot use — the dragged node's own subtree, its current parent — must
   * be skipped rather than refused. Nearest-valid keeps the drag moving
   * smoothly over them: the destination stays where it last was, which is what
   * a hand carrying something does when it passes over a wall.
   */
  const nearestCandidate = (
    clientY: number,
    candidates: string[]
  ): string | null => {
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const id of candidates) {
      const el = rowRefs.current.get(id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      // happy-dom and a hidden pane both report 0x0; a row with no box cannot
      // be aimed at, and treating it as "at distance 0" would make it win every
      // hit-test.
      if (rect.height === 0 && rect.width === 0) continue;
      // 0 when the pointer is over the row, otherwise the distance to its edge.
      const distance =
        clientY < rect.top
          ? rect.top - clientY
          : clientY > rect.bottom
            ? clientY - rect.bottom
            : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    }
    return best;
  };

  /**
   * Starts a pointer drag from the Mover handle.
   *
   * Listeners live on the window rather than on the handle, because once the
   * pointer leaves the handle the element stops receiving events unless it
   * captures them, and a capture would swallow the click on rows underneath
   * that the user may be aiming at.
   *
   * Auto-scroll is not optional: the pane can be three rows tall on a phone,
   * so a destination 20 rows away is unreachable without it.
   */
  const startDrag = (e: React.PointerEvent, item: FlatOutlineItem) => {
    if (!enableNodeMove) return;
    if (item.id === root.id) {
      setHint(MOVE_REFUSAL_TEXT.root);
      return;
    }
    if (isLifting) return;
    // Primary button only. A right-click opens a context menu; treating it as a
    // drag start means the menu appears with a half-finished move behind it.
    if (e.button !== 0) return;

    const candidates = moveCandidates(root, item.id);
    if (candidates.length === 0) {
      setHint('Não há outro tópico para receber este aqui.');
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setLiftedId(item.id);

    // Aim at nothing until the pointer actually moves.
    //
    // Aiming on pointer-down would make a plain click a move to whatever row
    // happened to be nearest the handle — so a click on the button silently
    // relocated a topic, which is the worst thing this control could do. A
    // press-and-release with no movement is a click, and the click handler
    // already deals with that (it starts the keyboard lift). Movement is what
    // makes it a drag, so the destination appears only once there is one.
    setLiftTargetId(null);

    const originY = e.clientY;
    let moved = false;
    /**
     * The destination, tracked OUTSIDE React state.
     *
     * setState is asynchronous, so a pointerup arriving in the same tick as the
     * last pointermove would read a stale ref and commit the previous
     * destination — or none. A hand moves and releases in the same few
     * milliseconds, so this is the normal case, not an edge one. The ref is the
     * pointer's own record of where it is; React state is only for painting.
     */
    let targetRef: string | null = null;

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - originY) < 4) return; // not yet a drag
      moved = true;
      const next = nearestCandidate(ev.clientY, candidates);
      if (next) {
        targetRef = next;
        setLiftTargetId(next);
      }

      // Edge auto-scroll: 48px of margin at each end of the visible list. The
      // pane can be three rows tall on a phone, so a destination 20 rows away is
      // otherwise unreachable without scrolling by hand mid-drag.
      const scroller = scrollRef.current;
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const EDGE = 48;
      if (ev.clientY < box.top + EDGE) {
        scroller.scrollTop -= Math.max(6, (box.top + EDGE - ev.clientY) / 3);
      } else if (ev.clientY > box.bottom - EDGE) {
        scroller.scrollTop += Math.max(6, (ev.clientY - (box.bottom - EDGE)) / 3);
      }
    };

    const onUp = () => {
      cleanup();
      // Suppress the click that the browser will synthesise after this
      // release. Without it the button's onClick runs a moment later, sees no
      // lift in flight, and starts a SECOND one — so a single drag committed
      // the move and then reopened the lift on the moved row, which showed as
      // two updates and left the outline stuck in "moving".
      suppressClickRef.current = true;
      // A release that never moved is a click, and the click handler owns it.
      // A release that moved commits only if it landed on a destination:
      // letting go over empty space below the list is a cancel, which is what
      // letting go of something means.
      if (!moved || !targetRef) {
        cancelLift();
        return;
      }
      setLiftTargetId(targetRef);
      commitLiftRef.current?.(targetRef);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      cleanup();
      cancelLift();
    };

    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey, true);
      dragCleanupRef.current = null;
    }

    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true);
  };

  const cancelLift = useCallback(() => {
    setLiftedId(null);
    setLiftTargetId(null);
    setIsDragging(false);
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  /* A hidden pane is still mounted on purpose (see the `hidden` prop), so it
     never fires blur and the focusout guard above never runs. Expanding the
     client notes mid-lift would otherwise leave the outline "moving" behind a
     panel, with the row focus intact underneath and no way for the therapist to
     know why the arrows stopped aiming. */
  useEffect(() => {
    if (hidden) cancelLift();
  }, [hidden, cancelLift]);

  /**
   * Lifts a row, aiming the cursor at the first candidate.
   *
   * The first candidate is the row ABOVE the lifted one, not the top of the
   * outline: the mis-filed topic that motivates a move is nearly always a
   * sibling or a cousin, so starting the cursor in the visual neighbourhood of
   * where the row already sits makes Enter, which lands on the first candidate,
   * do the obvious thing instead of teleporting the subtree to the top.
   */
  const startLift = useCallback(
    (item: FlatOutlineItem) => {
      if (!enableNodeMove) return;
      if (item.id === root.id) {
        setHint(MOVE_REFUSAL_TEXT.root);
        return;
      }
      if (isLifting) return;

      const candidates = moveCandidates(root, item.id);
      if (candidates.length === 0) {
        setHint('Não há outro tópico para receber este aqui.');
        return;
      }

      setLiftedId(item.id);
      setLiftTargetId(initialLiftTarget(root, item.id));
    },
    [enableNodeMove, isLifting, root]
  );

  /**
   * Commits the lift: one moveNode, one onUpdateRoot.
   *
   * One commit is the whole point. Two calls (detach, then attach) would put two
   * entries in the history stack and let the client window receive an
   * intermediate state in which the subtree does not exist.
   *
   * The moved node is re-selected afterwards so the client sees WHERE it went.
   * A move is a deliberate act, so it bypasses the dwell and highlights at
   * once, for the same reason a click does: the dwell exists to stop the map
   * chasing the therapist while they scan, not to delay a decision already
   * made. The highlight path is recomputed from the committed tree, so the
   * client's screen shows the new ancestry rather than a stale one.
   */
  const commitLift = useCallback(
    /**
     * The destination. A drag passes the one its pointer actually reached
     * rather than the last one React painted, because the pointer and the
     * release can be closer together than a re-render.
     */
    (destination?: string) => {
      const targetId = destination ?? liftTargetId;
      if (!liftedId || !targetId) return;
      const source = findNodeById(root, liftedId);
      const target = findNodeById(root, targetId);
      if (!source || !target) {
        cancelLift();
        return;
      }

      const result = moveNode(root, liftedId, targetId);
      if (!result.success) {
        cancelLift();
        setHint(MOVE_REFUSAL_TEXT[result.refusal ?? 'no-change']);
        return;
      }

      // Whether the balloon changes side in the map, which the outline cannot
      // show: the map alternates top-level branches by index parity.
      const before = branchIndexOf(root, liftedId);
      const after = branchIndexOf(result.root, liftedId);
      const flipsSide = before !== -1 && after !== -1 && before % 2 !== after % 2;

      const label = target.text.trim() || 'a linha da sessão';
      cancelLift();

      onUpdateRoot(result.root, 'move');
      onSelectNode(liftedId, 'click');
      // The row keeps its id, so its input is the same element: the caret returns
      // to the end of the text it was already in, with no focus bookkeeping.
      focusInput(liftedId, false, 'explicit');

      sayLiftNotice(
        flipsSide
          ? `“${source.text.trim() || 'Tópico'}” movido para “${label}”. Ele muda de lado no mapa para o cliente.`
          : `“${source.text.trim() || 'Tópico'}” movido para “${label}”.`
      );
    },
    [liftedId, liftTargetId, root, cancelLift, onUpdateRoot, onSelectNode, focusInput, sayLiftNotice]
  );

  // The drag's pointerup handler is registered once at drag start, before
  // commitLift would have been re-created. A ref keeps it calling the current
  // closure rather than a stale one.
  commitLiftRef.current = commitLift;

  /**
   * Keyboard control while a lift is in flight.
   *
   * Everything is swallowed. A keystroke that falls through to the input would
   * edit the row that is in the air, and the therapist would type a word into a
   * node whose position is about to change.
   */
  const handleLiftKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!liftCandidates.length) {
      if (e.key === 'Escape') cancelLift();
      return;
    }

    const step = (delta: number) => setLiftTargetId(stepLiftTarget(liftCandidates, liftTargetId, delta));

    switch (e.key) {
      case 'ArrowDown':
        return step(1);
      case 'ArrowUp':
        return step(-1);
      // A screenful at a time, for a destination that is not a neighbour. The
      // pane can be three rows tall on a phone, so paging is not a luxury.
      case 'PageDown':
        return step(4);
      case 'PageUp':
        return step(-4);
      case 'Home':
        return setLiftTargetId(liftCandidates[0]);
      case 'End':
        return setLiftTargetId(liftCandidates[liftCandidates.length - 1]);
      case 'Enter':
        return commitLift();
      case 'Escape':
        cancelLift();
        return;
      default:
        return;
    }
  };

  // Input change handler
  const handleInputChange = (item: FlatOutlineItem, newText: string) => {
    // NO length cap. There used to be a hard 280-character limit that
    // silently refused the keystroke, so a therapist writing a longer thought
    // watched the last characters simply not appear — with no message, because
    // a refused keystroke and a dropped one look identical. The balloon now
    // grows to fit whatever is typed, so there is no reason to stop.

    // Typing during a lift would edit a node whose position is still being
    // decided, so the text would be written into the wrong branch.
    if (isLifting) return;

    // Typing resolves whatever hint was showing: the reason it appeared
    // ("write before adding a subitem") no longer applies.
    setHint('');

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
    /* flex-1 min-h-0, not h-full. The pane is a flex COLUMN that now has a
       sibling below it (the client-notes panel). h-full resolves against the
       pane's own height, so outline + panel together exceeded it and the
       section overflowed instead of the outline yielding space. As a flex
       child it should claim the remaining space and be allowed to shrink. */
    <div
      ref={outlinePaneRef}
      className={`@container flex flex-1 min-h-0 flex-col min-w-0 overflow-hidden select-text bg-surface-raised text-content ${
        hidden ? 'hidden' : ''
      }`}
      /* --row-scale multiplies the whole row, not just the glyphs.
       *
       * Scaling only font-size would leave the text bigger inside rows sized
       * for the old one: 46px rows with 20px text, indentation unchanged, so
       * depth 6 ate the same space as before and the hierarchy became harder to
       * read, not easier. Every dimension that belongs to a row — font, line
       * height, vertical padding, the indent step, the gutter and the control
       * cluster — reads this one property, so the rhythm is preserved at any
       * size and there is a single knob to turn.
       */
      style={
        {
          '--row-scale': outlineFontScale,
          // Clamped so an extreme value cannot make a row taller than the pane.
          fontSize: `calc(1rem * var(--row-scale))`,
        } as React.CSSProperties
      }
    >
      {/* Refined Sidebar Header */}
      <div className="px-4 py-3 border-b border-line-muted shrink-0 bg-surface-inset text-content">
        {/* Both header rows wrap instead of crushing: at 200% zoom inside a
            291px pane the title + counter cannot share a line. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-bold tracking-tight">
          <span className="uppercase text-[11px] tracking-wider text-content-muted">
            Tópicos da Sessão
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-bold text-content-muted">
              {flatItems.length} balões
            </span>
            {/* The full-screen toggle lives HERE, on the surface it acts on,
                rather than behind a settings dialog. It is a per-session way of
                working — "I want to read and write, the client has the map" —
                and a thing you toggle many times a day should be one click on
                the thing itself, not a trip through a modal.

                It is safe here only because this header is visible in BOTH
                layouts: when the outline is expanded it is still the only pane
                on screen, so the control that shrinks it is never the control
                that was hidden. */}
            {onToggleMaximize && (
              <button
                type="button"
                onClick={onToggleMaximize}
                title={
                  maximizeOutline
                    ? 'Mostrar a prévia do mapa ao lado'
                    : 'Expandir os tópicos para a tela inteira'
                }
                aria-label={
                  maximizeOutline
                    ? 'Mostrar a prévia do mapa ao lado dos tópicos'
                    : 'Expandir os tópicos para a tela inteira, ocultando o mapa'
                }
                aria-pressed={maximizeOutline}
                className="ctl w-7 h-7 !min-h-0 px-0"
              >
                {maximizeOutline ? (
                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <PanelLeft className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
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
          {/* Only advertised when it is live, so the line never names a
              shortcut that does nothing. */}
          {enableNodeMove && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="font-semibold text-content">Ctrl+Shift+M</strong>: Mover
              </span>
            </>
          )}
        </div>

        {/* Search.
            Collapsed to a button by default so the pane keeps its height for
            the rows; it takes over the shortcut line while open, because that
            line is the least valuable thing on screen at that moment. */}
        {isSearching || searchOpen ? (
          <div className="mt-2 flex items-center gap-1.5">
            <div className="relative flex-1 min-w-0 flex items-center">
              <Search
                className="w-3.5 h-3.5 absolute left-2.5 text-content-subtle pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="outline-search" className="sr-only">
                Buscar nos tópicos da sessão
              </label>
              <input
                id="outline-search"
                type="search"
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setMatchCursor(0);
                }}
                onFocus={() => {
                  /* Focus leaving a row would strand the lift: no keydown would
                   * ever reach handleLiftKey again, so the outline would sit in
                   * "moving" with the arrow keys doing nothing and no visible way
                   * out. The search field is the one focusable thing outside the
                   * rows, so taking focus there drops the lift rather than
                   * trapping it. */
                  if (isLifting) cancelLift();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    stepMatch(e.shiftKey ? -1 : 1);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setQuery('');
                    setSearchOpen(false);
                  }
                }}
                placeholder="Buscar tópico…"
                aria-describedby="outline-search-count"
                className="w-full pl-8 pr-2 py-1.5 text-xs rounded-control border border-line bg-surface-raised text-content placeholder:text-content-subtle"
              />
            </div>
            {/* Live count: reading "3 de 12" is how the therapist knows
                whether the word is absent or just off-screen. */}
            <span
              id="outline-search-count"
              role="status"
              aria-live="polite"
              className="shrink-0 font-mono text-[11px] text-content-muted whitespace-nowrap tabular-nums"
            >
              {matchIds.length > 0
                ? `${matchCursor + 1}/${matchIds.length}`
                : isSearching
                  ? '0'
                  : ''}
            </span>
            <button
              type="button"
              onClick={() => stepMatch(-1)}
              disabled={matchIds.length === 0}
              aria-label="Ocorrência anterior"
              className="ctl w-8 h-8 !min-h-0 px-0 shrink-0"
            >
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => stepMatch(1)}
              disabled={matchIds.length === 0}
              aria-label="Próxima ocorrência"
              className="ctl w-8 h-8 !min-h-0 px-0 shrink-0"
            >
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSearchOpen(false);
              }}
              aria-label="Fechar busca"
              className="ctl w-8 h-8 !min-h-0 px-0 shrink-0"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          /* Drawn as a search FIELD, because that is what it is: a collapsed
             field you click to open. It used to be bare 11px text with a small
             icon and no border, which reads as a caption or a label — nothing
             about it said "press me". Same visual language as the input it
             becomes, so the transition is one the eye can predict, and the
             whole row is the target rather than a word inside it. */
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Buscar nos tópicos da sessão"
            className="mt-2 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-control border border-line bg-surface text-content-subtle hover:text-content hover:border-accent-text hover:bg-surface-raised transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left text-xs">Buscar tópicos…</span>
          </button>
        )}
      </div>

      {/* Lift-in-progress banner.
          This is the state indicator a held modifier would have needed and
          could not have provided honestly: while it is up, the outline is
          showing a PREVIEW, arrows aim, Enter commits and Esc cancels. It sits
          where the refusal hint sits rather than at the top, so it appears in
          the same place the eye already goes for "what just happened to my
          keystroke". */}
      {isLifting && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 px-4 py-2 border-t border-line bg-surface-inset text-[11px] font-semibold text-content flex items-start gap-1.5"
        >
          <MoveVertical className="w-3.5 h-3.5 shrink-0 mt-px text-accent-text" aria-hidden="true" />
          <span className="min-w-0">
            {isDragging ? (
              <>
                <strong className="font-bold">Solte</strong> sobre o tópico de destino, ou{' '}
                <strong className="font-bold">Esc</strong> para cancelar. O tópico vai como
                último filho de onde você soltar.
              </>
            ) : (
              <>
                Movendo “{findNodeById(root, liftedId ?? '')?.text.trim() || 'tópico'}” —{' '}
                <strong className="font-bold">setas</strong> escolhem o destino,{' '}
                <strong className="font-bold">Enter</strong> confirma,{' '}
                <strong className="font-bold">Esc</strong> cancela.
              </>
            )}
          </span>
        </div>
      )}

      {/* Move confirmation. Its own channel, not the hint band: the hint is
          cleared by the next keystroke (see handleInputChange), and a success
          message the therapist cannot finish reading is the same as no message
          at all. Both are announced; they never show at once. */}
      {liftNotice && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 px-4 py-2 border-t border-line bg-accent-soft text-[11px] font-semibold text-content flex items-start gap-1.5"
        >
          <Check className="w-3.5 h-3.5 shrink-0 mt-px text-accent-text" aria-hidden="true" />
          <span className="min-w-0">{liftNotice}</span>
        </div>
      )}

      {/* Refused-action feedback.
          role="status" + aria-live="polite" so a screen-reader user hears why
          a key did nothing, instead of the app appearing to drop the input.
          Fixed to the bottom of the pane so it never reflows the outline the
          therapist is looking at, and it disappears on the next keystroke
          because the hint is no longer true. */}
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

      {/* Lines Scrollable Area.
          `--indent-step` is the one knob the whole tree scales from. It used to
          be a hard-coded 22px per level, so depth 12 asked for 274px of indent
          inside a pane that is 142px wide on a phone — the overflow the
          design audit flagged under C2. The row reads the step through
          calc(), so shrinking it here re-spaces every level at once.
          overflow-x-hidden (which overflow-y:auto already implies) keeps the
          44px hit expanders from ever producing a sideways scrollbar. */}
      <div
        ref={scrollRef}
        className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto p-3 space-y-1 outline-none [--indent-step:22px] @max-[520px]:[--indent-step:14px] @max-[320px]:[--indent-step:8px]"
      >
        {flatItems.map((item, index) => {
          const isRootItem = item.id === root.id;
          const isRowActive = activeNodeId === item.id;
          const isRowSelected = selectedNodeId === item.id;
          // Lift state. The moved row is the one being carried; the target row
          // is the destination. Note that `item` comes from the PREVIEW tree
          // while lifting, so the moved row already renders at its new depth and
          // this flag is the only thing that says which row is in the air.
          const isLifted = isLifting && item.id === liftedId;
          const isLiftTarget = isLifting && item.id === liftTargetId;
          const charCount = item.text.length;
          // Search match state. The current match is called out more strongly
          // than the others, so stepping through them is legible in a long
          // outline instead of a wall of equally tinted rows.
          const isMatch = isSearching && matchesQuery(item.text, normalizedQuery);
          const isCurrentMatch =
            isMatch && matchIds[matchCursor % Math.max(matchIds.length, 1)] === item.id;

          // The active row is a full row INVERSION, not a 1px ring — 20.17:1
          // in papel. That is the strongest focus indicator in the app and
          // the pattern the rest of the app should copy, so it is preserved
          // exactly. index.css has no inverted-surface token, so the two
          // inversion fills stay literal here (see report: needs a
          // --surface-inverted pair). Everything else is a semantic token.
          let rowContainerStyle = '';
          let inputTextStyle = '';
          let bulletStyle = '';

          if (isLiftTarget && !isRowSelected) {
            /* THIRD row state: the drop destination.
             *
             * Checked BEFORE isRowActive, and that ordering is load-bearing.
             * The session row is the active row on a fresh session (the caret
             * starts there), and it is also a legal drop target — the lift aims
             * at it first. With isRowActive tested first, the destination wore
             * the caret's inversion and the dashed target outline was never
             * painted, so the very first thing a therapist saw after lifting
             * was an unmarked row. The caret is still visible: it is on the
             * LIFTED row, which is a different row, and the two states are
             * rendered on separate elements.
             *
             * Deliberately not the amber wash either — that says "the client is
             * looking here", which is a different thing entirely.
             */
            rowContainerStyle =
              'border-2 border-dashed border-accent-text bg-transparent text-content';
            inputTextStyle = isRootItem
              ? 'font-extrabold text-base font-mono'
              : 'font-bold placeholder:text-content-muted caret-content';
            bulletStyle = 'bg-accent-text';
          } else if (isRowActive) {
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
          //
          // The step is multiplied by --row-scale so a deeper level still costs
          // proportionally the same at a larger text size. Without that, turning
          // the font up would make each indent level visually smaller relative
          // to the text, and the hierarchy would flatten exactly when the user
          // asked for it to be easier to read.
          const padLeft = `min(calc(${item.level} * var(--indent-step, 22px) * var(--row-scale, 1) + 10px), var(--indent-cap, 38cqi))`;

          return (
            <div
              key={item.id}
              ref={(el) => {
                if (el) rowRefs.current.set(item.id, el);
                else rowRefs.current.delete(item.id);
              }}
              onClick={() => {
                // A click during a lift aims the drop at that row, rather than
                // jumping the caret there. Moving the caret mid-lift would
                // leave the lifted node's input unfocused, and the very next
                // arrow would edit instead of aiming.
                if (isLifting) {
                  if (liftCandidates.includes(item.id)) setLiftTargetId(item.id);
                  return;
                }
                // A click on a row names one node on purpose, so it highlights
                // immediately and does not wait out the dwell. Making the
                // deliberate path wait while the accidental one did not was
                // backwards: the dwell exists to stop the map jumping around
                // while you scan, not to delay a decision you already made.
                focusInput(item.id, false, 'explicit');
              }}
              /* py-2.5, not py-2. At py-2 the row was 40px tall inside a 44px
                 pitch: two controls shared one 44px band, and a ::before
                 expander lost the 2px it poked past its own row to the NEXT
                 row, which paints later. 46px rows give each expander a band
                 of its own with room to spare.
                 Both paddings scale with --row-scale so a larger font gets a
                 proportionally taller row: the 46px band exists to give each
                 row's controls their own space, and a 20px line inside a 46px
                 box is a line that no longer has a band of its own. */
              className={`group flex items-center px-2.5 rounded-lg transition-all relative cursor-text ${rowContainerStyle}${
                isCurrentMatch
                  ? ' ring-2 ring-accent ring-offset-1 ring-offset-surface-raised'
                  : isMatch
                    ? ' ring-1 ring-accent/50'
                    : ''
              }`}
              style={
                {
                  '--pad-left': padLeft,
                  paddingLeft: 'var(--pad-left)',
                  paddingTop: 'calc(0.625rem * var(--row-scale, 1))',
                  paddingBottom: 'calc(0.625rem * var(--row-scale, 1))',
                  // "Picked up" while the pointer is carrying it, merged into
                  // the same style object the row already needed. Without a
                  // visible change to the lifted row a drag looks like nothing
                  // is happening until the destination outline appears — and on
                  // a touchscreen the row under the finger is hidden by the
                  // hand, so the drop target was the only feedback there was.
                  ...(isDragging && isLifted
                    ? { opacity: 0.45, transform: 'scale(0.99)' }
                    : {}),
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
              {/* Gutter. Scales with the row so the chevron, the bullet and
                  the space before the text keep their proportions instead of
                  crowding a larger line. The 4px of slack the original
                  w-7 carried is preserved as a scaled minimum. */}
              <div
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 'calc(1.75rem * var(--row-scale, 1))',
                  height: 'calc(1.25rem * var(--row-scale, 1))',
                  marginRight: 'calc(0.5rem * var(--row-scale, 1))',
                }}
              >
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
                      // Collapsing during a lift would collapse against the real
                      // tree while the outline shows the preview, and the two
                      // would disagree about what is visible.
                      if (isLifting) return;
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
                    if (el) {
                      inputRefs.current.set(item.id, el);
                      // This input just mounted, so a focus request that was
                      // deferred because it did not exist can land now.
                      const pending = pendingFocusRef.current;
                      if (pending && pending.nodeId === item.id) {
                        pendingFocusRef.current = null;
                        applyFocusRef.current(el, item.id, pending.selectAll);
                      }
                    } else {
                      inputRefs.current.delete(item.id);
                    }
                  }}
                  type="text"
                  value={item.text}
                  placeholder={isRootItem ? 'Data/Hora ou Tema da Sessão' : 'Digite a anotação…'}
                  onFocus={() => {
                    // Mirrors DOM focus to the row highlight ONLY.
                    //
                    // This used to call focusInput(), which was the second
                    // reason the dwell setting was ignored: moving the caret
                    // with the arrows moves DOM focus, onFocus fires, and the
                    // map followed whether or not the key handler wanted it
                    // to. Fixing only handleKeyDown would have left traversal
                    // broadcasting through the back door.
                    setActiveNodeId(item.id);
                  }}
                  /* The lifted row must not be edited while its position is
                     still being decided: the text would be written into the
                     wrong branch. handleKeyDown swallows every key during a
                     lift, and this closes the paths that do not go through it —
                     a paste, a drag-drop of text, the mobile keyboard's
                     autocorrect. */
                  readOnly={isLifted}
                  /* Leaving a row that was created but never typed into cancels
                     it, so "make a row and move on" leaves no empty balloon
                     behind. Rows with text, the root, and blank rows that
                     gained children are all left alone. */
                  onBlur={() => handleCancelIfBlank(item)}
                  onChange={(e) => handleInputChange(item, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, item, index)}
                  onPaste={(e) => handlePaste(e, item)}
                  /* pr reserves the row for the absolutely positioned control
                     cluster. It is 112px on a normal pane but only 32px on a
                     narrow one, where the + Filho button drops to icon-only —
                     otherwise 96px of reserved space left ~16px of a 142px
                     pane for the actual text, and the field looked broken.
                     Past 520px the Mover label joins in and the reserve grows
                     to match, for the same reason. */
                  /* The `text-sm` is gone: it was the fixed size that made the
                     outline un-scalable, since a class cannot be overridden by
                     the --row-scale the rest of the row reads. The font now
                     comes from the container's calc(1rem * --row-scale), and
                     the root row keeps its extra weight and step up from there.
                     The right gutter also scales, or a larger line would run
                     under the control cluster. */
                  className={`w-full bg-transparent border-0 outline-none transition-colors ${isRootItem ? 'font-extrabold' : 'font-bold'} ${inputTextStyle}`}
                  style={
                    {
                      paddingLeft: 0,
                      paddingTop: 'calc(0.125rem * var(--row-scale, 1))',
                      paddingBottom: 'calc(0.125rem * var(--row-scale, 1))',
                      paddingRight: 'calc(2rem * var(--row-scale, 1))',
                      fontSize: isRootItem
                        ? 'calc(1rem * var(--row-scale, 1))'
                        : 'calc(0.875rem * var(--row-scale, 1))',
                    } as React.CSSProperties
                  }
                />

                {/* Right controls: Mover, + Filho, counters.
                    Positioned and sized off the same scale, so at a larger font
                    the cluster grows with the row instead of overlapping the
                    text. */}
                <div
                  className="absolute flex items-center"
                  style={{
                    right: 'calc(0.25rem * var(--row-scale, 1))',
                    gap: 'calc(0.375rem * var(--row-scale, 1))',
                  }}
                >
                  {/* Mover. The chord is the fast path, but a chord is not
                      always available: macOS claims several single-modifier
                      combinations for the window manager before the page ever
                      sees the keydown, and there is no key to hold on a
                      touchscreen. A visible control makes the gesture
                      reachable either way, and it calls the same startLift the
                      chord does — one implementation, nothing to drift. */}
                  {enableNodeMove && (
                    <button
                      type="button"
                      onPointerDown={(e) => startDrag(e, item)}
                      onClick={(e) => {
                        /* The click the browser synthesises at the end of a
                           drag is the tail of that gesture, not a new one.
                           Swallowing it is what stops a single drag from
                           committing the move and then immediately reopening
                           the lift on the row it just moved. */
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          e.stopPropagation();
                          e.preventDefault();
                          return;
                        }
                        /* Otherwise it is a genuine click. A keyboard
                           activation (Enter/Space) lands here too, which is how
                           the control stays reachable without a pointer. */
                        e.stopPropagation();
                        e.preventDefault();
                        if (isLifting) return;
                        startLift(item);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          startLift(item);
                        }
                      }}
                      /* Keep focus in the input. Without this the button takes
                         focus on pointerdown, the row blurs, and a blank row is
                         cancelled by the blur BEFORE this handler runs — the
                         same trap the + Filho button documents. It also stops
                         the focusout guard from cancelling the lift the drag
                         just started. */
                      onMouseDown={(e) => e.preventDefault()}
                      title={
                        isDragging
                          ? 'Solte sobre o tópico de destino'
                          : 'Arraste para mover para outro ramo (ou Ctrl+Shift+M)'
                      }
                      aria-label={`Mover ${item.text || 'este tópico'}: arraste até o destino, ou use Ctrl+Shift+M`}
                      className={`relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border border-accent-text text-accent-text transition-opacity select-none touch-none before:content-[''] before:absolute before:-inset-3 ${
                        isDragging ? 'cursor-grabbing' : 'cursor-grab'
                      } ${
                        isRowActive || isDragging
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100'
                      }`}
                    >
                      <MoveVertical className="w-3 h-3" aria-hidden="true" />
                      <span className="hidden @min-[520px]:inline">Mover</span>
                    </button>
                  )}

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
                      if (isLifting) return;
                      handleCreateChild(item);
                    }}
                    /* Keep focus in the input. Without this the button takes
                       focus on mousedown, blur fires, and a blank row is
                       cancelled by the blur BEFORE this click handler runs —
                       so "+ Filho" on an empty row would delete the row. */
                    onMouseDown={(e) => e.preventDefault()}
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

                  {/* Character counter.
                      A plain count, not a budget. It used to read "87/90" in a
                      warning colour with a "recommended: up to ~90 characters"
                      tooltip, which was advice about a limit that no longer
                      exists — the balloon grows to fit whatever is written, and
                      the input no longer refuses a keystroke. A counter that
                      implies a ceiling it does not enforce is worse than none.
                      Each state keeps its own colour: the old single
                      `text-accent-text` warning was 1.93:1 on the papel
                      selected wash and exactly 1.00:1 on the noite one. */}
                  {charCount > 70 && (
                    <span
                      /* Below 384px of pane the counter competes with the field
                         for the only 32px of reserved gutter, so it stands down
                         rather than overlapping the annotation. */
                      className={`hidden @min-[384px]:inline text-[10px] font-mono tabular-nums ${
                        isRowActive
                          ? 'text-accent font-bold'
                          : isRowSelected
                          ? 'text-content-onaccent font-bold'
                          : 'text-content-muted'
                      }`}
                      title={`${charCount} caracteres — o balão cresce para caber tudo`}
                    >
                      {charCount}
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
