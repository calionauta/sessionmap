import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Maximize2,
  CheckCircle2,
  Undo2,
  Redo2,
  Plus,
} from 'lucide-react';
import { Client, MindMap, MindMapNode, SelectReason, Settings } from '../types';
import { MindMapCanvas } from './mindmap/MindMapCanvas';
import { ShareGuideModal } from './modals/ShareGuideModal';
import { ExportModal } from './modals/ExportModal';
import { SettingsModal } from './modals/SettingsModal';
import { MapListDrawer } from './modals/MapListDrawer';
import { AdminClientManager } from './admin/AdminClientManager';
import { MarkdownOutline } from './outline/MarkdownOutline';
import { ClientNotesPanel } from './ui/ClientNotesPanel';
import { TypingBar } from './ui/TypingBar';
import { TopBar } from './TopBar';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import {
  getAllMaps,
  getAllClients,
  saveMap,
  deleteMap,
  getSettings,
  saveSettings,
  getActiveMapId,
  setActiveMapId,
  saveSnapshot,
  requestPersistence,
  archiveMap,
  unarchiveMap,
  isArchived,
  pruneEmptyLeaves,
  getMap,
  tidyOutline,
} from '../services/storage';
import { syncService } from '../services/sync';
import { findPathToNode, findNodeById, generateNodeId, toggleNodeCollapse, normalizeOutline } from '../utils/tree';
import { formatSessionTimestamp } from '../utils/text';
import { isTextEntryTarget } from '../utils/keyboard';
import {
  OUTLINE_MIN_PERCENT,
  OUTLINE_MAX_PERCENT,
  clampOutlineWidth,
} from '../utils/layout';

export const TherapistView: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [maps, setMaps] = useState<MindMap[]>([]);
  /** Every session, archived included. Only the archive views read this. */
  const [allMaps, setAllMaps] = useState<MindMap[]>([]);
  /**
   * Whether the node being edited is on-screen. The canvas already highlights
   * and centres it, so the floating "what am I editing" mirror only appears
   * when this is false.
   */
  /** Lifted so the outline can be hidden while the notes take the pane. */
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [activeMap, setActiveMap] = useState<MindMap | null>(null);
  const [settings, setSettings] = useState<Settings>(() => getSettings());

  // Split view ratio. The floor and the ceiling live in utils/layout so they
  // can be checked without mounting this.
  const [outlineWidthPercent, setOutlineWidthPercent] = useState<number>(OUTLINE_MIN_PERCENT);
  const [isResizingOutline, setIsResizingOutline] = useState<boolean>(false);
  /** Removes the window listeners a drag in flight installed. */
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  /** The split view, measured so a drag can turn a pointer into a percentage. */
  const mainRef = useRef<HTMLElement | null>(null);
  const [isMaximizedMap, setIsMaximizedMap] = useState<boolean>(false);
  /**
   * Dismisses the map so the outline takes the full width.
   *
   * Mirrors isMaximizedMap and the two are never both on: a window with neither
   * surface would be blank, which is the one outcome a layout toggle must not
   * produce. Persisted, because a therapist who always works this way should
   * not have to press it every session.
   */
  const [maximizeOutline, setMaximizeOutline] = useState<boolean>(
    () => getSettings().maximizeOutline
  );

  // Cross-window client status
  const [isClientConnected, setIsClientConnected] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Live draft & selection
  const [draft, setDraft] = useState<{
    mode: 'add' | 'edit';
    parentId: string | null;
    targetId?: string | null;
    parentText?: string;
    text: string;
    active: boolean;
  } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  /**
   * Whether the typing bar is up, on the CLIENT's rule rather than its own.
   *
   * A draft turns it on and an idle timer turns it off, which is what the
   * client window has always done. The therapist's copy used to key off whether
   * the edited node happened to be on screen, recomputed on every keystroke —
   * and since a balloon grows and shrinks as it is typed into, that answer
   * flipped while the sentence was being written and the bar flickered. One
   * rule for both windows is the whole fix; the flicker was a symptom of having
   * two.
   */
  const [typingBarVisible, setTypingBarVisible] = useState(false);
  const typingBarTimerRef = useRef<number | null>(null);
  const BAR_IDLE_MS = 1200;

  useEffect(() => {
    if (!draft?.active) {
      setTypingBarVisible(false);
      if (typingBarTimerRef.current) window.clearTimeout(typingBarTimerRef.current);
      return;
    }
    setTypingBarVisible(true);
    if (typingBarTimerRef.current) window.clearTimeout(typingBarTimerRef.current);
    typingBarTimerRef.current = window.setTimeout(() => {
      setTypingBarVisible(false);
      typingBarTimerRef.current = null;
    }, BAR_IDLE_MS);
    return () => {
      if (typingBarTimerRef.current) window.clearTimeout(typingBarTimerRef.current);
    };
  }, [draft?.active, draft?.text]);

  /**
   * Which pane a NARROW window is showing.
   *
   * A separate boolean from the two maximisations, deliberately. Those are a
   * desktop preference, and folding this into them would mean that rotating a
   * phone rewrote the split the therapist chose on the laptop — the layout
   * would come back wrong. Below the breakpoint the split is not a split, so
   * this is the switch, and above it the maximisations keep their meaning
   * untouched.
   */
  const isNarrow = useNarrowViewport();
  const [narrowPane, setNarrowPane] = useState<'outline' | 'map'>('outline');

  /**
   * Layout policy, kept separate from "is there a session".
   *
   * `activeMap` is tested at the call site rather than folded in here, because a
   * boolean cannot narrow a nullable for the compiler and the cast that follows
   * would be a lie about a condition that really can be false.
   */
  const showOutlinePane = !isMaximizedMap && (!isNarrow || narrowPane === 'outline');
  const showMap = !maximizeOutline && (!isNarrow || narrowPane === 'map');
  /** On a narrow window the outline takes the whole width whatever it says. */
  const outlineFull = maximizeOutline || isNarrow;

  // Modals state
  const [isShareGuideOpen, setIsShareGuideOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMapListOpen, setIsMapListOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Undo/Redo history stack
  const historyRef = useRef<MindMapNode[]>([]);
  const historyIndexRef = useRef<number>(-1);

  // Autosave status
  const [saveStatus, setSaveStatus] = useState<'salvo' | 'salvando'>('salvo');
  const autosaveTimerRef = useRef<number | null>(null);

  // 10s Delete Undo Toast
  const [deletedMapUndo, setDeletedMapUndo] = useState<MindMap | null>(null);
  const undoToastTimerRef = useRef<number | null>(null);

  const svgCanvasRef = useRef<SVGSVGElement | null>(null);
  const clientWindowRef = useRef<Window | null>(null);

  const refreshAllData = useCallback(async () => {
    const [loadedClients, allLoadedMaps] = await Promise.all([
      getAllClients(),
      getAllMaps(),
    ]);
    setClients(loadedClients);
    // EVERY session, archived included, for the admin panel's archive view.
    //
    // This was never assigned, so `allMaps` stayed [] for the life of the
    // session and the whole per-client history rendered as "no sessions" —
    // the panel filters on clientId against a list that was always empty. The
    // old comment claimed the archive UI "reads them from storage directly";
    // it did not, it read this state. Assigning it is the entire fix.
    setAllMaps(allLoadedMaps);
    // Archived sessions stay out of the WORKING state entirely, so they never
    // show up in the header picker, the session list, or the active-map
    // fallback below.
    const loadedMaps = allLoadedMaps.filter((m) => !isArchived(m));
    setMaps(loadedMaps);

    const savedActiveId = getActiveMapId();
    // A session that was just archived must not stay selected: the previous
    // branch would silently reopen the record the user just put away.
    const current =
      loadedMaps.find((m) => m.id === savedActiveId) || loadedMaps[0] || null;
    if (current) {
      setActiveMap(current);
      historyRef.current = [current.root];
      historyIndexRef.current = 0;
    } else {
      setActiveMap(null);
    }
  }, []);

  // 1. Initial Load
  useEffect(() => {
    requestPersistence();
    refreshAllData();

    syncService.startHostHeartbeat();
    const unsub = syncService.onConnectionChange((connected) => {
      setIsClientConnected(connected);
    });

    return () => {
      syncService.stopHostHeartbeat();
      unsub();
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (undoToastTimerRef.current) clearTimeout(undoToastTimerRef.current);
    };
  }, [refreshAllData]);

  // Window A title. The client name IS shown here — see the ShareGuide
  // caveat below about screen-sharing the browser chrome.
  useEffect(() => {
    const title = activeMap
      ? `PRIVADO · ${activeMap.clientName || 'Cliente'} (${activeMap.sessionDate || activeMap.title})`
      : 'PRIVADO · SessionMap';
    document.title = title;
  }, [activeMap]);

  // Sync theme class to document.documentElement for consistent system-wide CSS & Tailwind dark mode
  useEffect(() => {
    if (settings.theme === 'noite') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.theme]);

  // Synchronize active map to client window
  useEffect(() => {
    if (activeMap) {
      syncService.send({ type: 'snapshot', map: activeMap });
    }
  }, [activeMap]);

  // Broadcast draft changes
  const handleDraftChange = useCallback(
    (newDraft: {
      mode: 'add' | 'edit';
      parentId: string | null;
      targetId?: string | null;
      parentText?: string;
      text: string;
      active: boolean;
    }) => {
      setDraft(newDraft);
      syncService.send({ type: 'draft', draft: newDraft });
    },
    []
  );

  // Broadcast selection
  const handleSelectNode = useCallback(
    (nodeId: string | null, reason: SelectReason) => {
      /* 'caret' is LOCAL ONLY, and the distinction is the point.

         The therapist is looking at their own screen and wants the balloon they
         are typing into in the middle of it, now — not after the dwell. The
         client is looking at a second screen mid-session, and a map that
         slides on every arrow key is a distraction rather than a help; that is
         what the dwell setting governs, and what 'focus3s' is for.

         So the caret moves the therapist's own view and is never sent. One
         channel and two audiences, told apart by the reason, rather than a
         second callback that would have to be kept in step with this one. */
      setSelectedNodeId(nodeId);
      if (reason === 'caret') return;
      syncService.send({ type: 'select', selection: { nodeId, reason } });
    },
    []
  );

  // Toggle pause (Ctrl+.)
  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      syncService.send({ type: 'pause', paused: next });
      return next;
    });
  }, []);

  // Open Client Window (Window B)
  const openClientWindow = () => {
    const clientUrl = `${window.location.origin}${window.location.pathname}?view=client`;
    const newWin = window.open(
      clientUrl,
      'SessionMapClient',
      'width=1280,height=800,menubar=no,toolbar=no,location=no,status=no,resizable=yes'
    );
    if (newWin) {
      clientWindowRef.current = newWin;
      setIsClientConnected(true);
      if (activeMap) {
        setTimeout(() => {
          syncService.send({ type: 'snapshot', map: activeMap });
        }, 500);
      }
    }
  };

  // Update map root with debounced autosave
  const handleUpdateRoot = (newRoot: MindMapNode, reason: string = 'edit') => {
    if (!activeMap) return;

    // Structural invariant, applied to every update rather than per key press:
    // a blank node never keeps children. See normalizeOutline for why the
    // per-key guards were not enough.
    newRoot = normalizeOutline(newRoot);

    // 'typing' is skipped so a sentence is one undo step rather than one per
    // letter. 'undo' and 'redo' are skipped because they REPLAY a state that is
    // already in the stack: the old code recorded them, so every undo pushed the
    // state it had just stepped back to and the cursor ended up pointing at it
    // again. The stack grew by one entry per undo, the redo branch was filled
    // with duplicates, and the second undo stepped back further than the first.
    if (reason !== 'typing' && reason !== 'undo' && reason !== 'redo') {
      const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
      nextHistory.push(newRoot);
      if (nextHistory.length > 50) nextHistory.shift();
      historyRef.current = nextHistory;
      historyIndexRef.current = nextHistory.length - 1;
    }

    const updated: MindMap = {
      ...activeMap,
      root: newRoot,
      updatedAt: new Date().toISOString(),
    };
    setActiveMap(updated);

    setSaveStatus('salvando');
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(async () => {
      await saveMap(updated);
      await saveSnapshot(updated.id, updated.root);
      setSaveStatus('salvo');
    }, 400);
  };

  // Undo / Redo
  const handleUndo = () => {
    if (historyIndexRef.current > 0 && activeMap) {
      historyIndexRef.current -= 1;
      const prevRoot = historyRef.current[historyIndexRef.current];
      handleUpdateRoot(prevRoot, 'undo');
    }
  };

  const handleRedo = () => {
    if (historyIndexRef.current < historyRef.current.length - 1 && activeMap) {
      historyIndexRef.current += 1;
      const nextRoot = historyRef.current[historyIndexRef.current];
      handleUpdateRoot(nextRoot, 'redo');
    }
  };

  // Read inside the global keydown listener below, which must not be re-bound
  // on every state change just to see which overlays are up.
  const isOverlayOpenRef = React.useRef(false);
  isOverlayOpenRef.current =
    isAdminOpen ||
    isShareGuideOpen ||
    isExportOpen ||
    isSettingsOpen ||
    isMapListOpen;

  // Global Keyboard Shortcuts.
  //
  // Every one of these is suppressed while an overlay is open. The overlay
  // owns the keyboard at that point: Ctrl+E otherwise re-rendered the export
  // dialog underneath whatever was on top, and Ctrl+. / Ctrl+Z acted on the
  // map behind a modal. Each overlay closes on its own Escape.
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isOverlayOpenRef.current) return;

      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        togglePause();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setIsExportOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        // The browser owns undo inside a text field. See isTextEntryTarget.
        if (isTextEntryTarget(e.target)) return;
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [togglePause]);

  /**
   * Widening the outline pane by dragging its right edge.
   *
   * Pointer capture would be the modern way, but the listeners go on `window`
   * to match the drag the outline editor already does, and for the same two
   * reasons that one needed them: a pointerup that lands outside the handle
   * still has to end the drag, and a component that unmounts mid-drag has to
   * take its listeners with it. The second one is why resizeCleanupRef exists
   * and why the effect below runs it — a leaked pointermove keeps resizing a
   * pane that is no longer there.
   */
  const startOutlineResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsResizingOutline(true);

    const container = mainRef.current;
    const onMove = (ev: PointerEvent) => {
      const width = container?.clientWidth ?? 0;
      // A zero width means the pane is not laid out yet, and dividing by it
      // would hand the state a NaN that no comparison can clamp.
      if (width <= 0) return;
      setOutlineWidthPercent(clampOutlineWidth((ev.clientX / width) * 100));
    };
    const onUp = () => cleanup();
    // Escape abandons the drag AND puts the width back, so a mis-grab is one
    // keystroke to undo rather than a drag back to where it started.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      cleanup();
      setOutlineWidthPercent(OUTLINE_MIN_PERCENT);
    };
    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey, true);
      resizeCleanupRef.current = null;
      setIsResizingOutline(false);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true);
    resizeCleanupRef.current = cleanup;
  };

  // A drag in flight must not outlive the pane it is resizing.
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  /**
   * The same handle, by keyboard.
   *
   * A separator you can only drag is a separator some people cannot use, and
   * the arrow keys are the whole gesture: 2% a press, 10% with Shift, clamped
   * to the same bounds the drag uses.
   */
  const nudgeOutlineWidth = (delta: number) => {
    setOutlineWidthPercent((w) => clampOutlineWidth(w + delta));
  };

  // Switch Active Map
  const handleSelectMap = (mapId: string) => {
    const found = maps.find((m) => m.id === mapId);
    if (found) {
      setActiveMap(found);
      setActiveMapId(found.id);
      historyRef.current = [found.root];
      historyIndexRef.current = 0;
      setSelectedNodeId(null);
      setDraft(null);
    }

    // Commit point for the session being left: drop any row that was created
    // but never typed into. The outline cancels these on blur, so this only
    // catches a node whose input was never mounted or lost focus some other
    // way (a tab switch that unmounted it, for instance).
    //
    // Deliberately NOT done in handleUpdateRoot: addChild/Enter create a blank
    // row and immediately push it, so pruning on every update would delete
    // the row before the user could type into it.
    void commitPrunedRoot(mapId);
  };

  const commitPrunedRoot = async (mapId: string) => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const current = (await getMap(mapId)) ?? maps.find((m) => m.id === mapId);
    if (!current) return;
    const pruned = tidyOutline(current.root);
    if (pruned === current.root) return;
    await saveMap({ ...current, root: pruned, updatedAt: new Date().toISOString() });
    await refreshAllData();
  };

  // Create New Map (Quick from Drawer)
  const handleCreateNewMap = async () => {
    // The session must belong to the client currently in context, not to
    // clients[0]. Picking the first client meant every new session landed on
    // the same patient, so the session history in the admin panel was empty
    // for everyone else — the sessions existed, filed under the wrong person.
    const inContext =
      (activeMap &&
        clients.find((c) => c.id === activeMap.clientId && !isArchived(c))) ||
      null;

    // Archived clients are excluded: creating new work for a closed case
    // defeats the point of archiving it.
    const client =
      inContext || clients.find((c) => !isArchived(c)) || clients[0] || null;

    if (!client) return;

    const newId = `m_${Date.now().toString(36)}`;
    // Numbered per client, so two clients each start at "Sessão 1".
    const clientSessionCount = maps.filter(
      (m) => m.clientId === client.id
    ).length;
    const newMap: MindMap = {
      schema: 1,
      id: newId,
      clientId: client.id,
      clientName: client.name,
      sessionDate: formatSessionTimestamp(),
      title: `Sessão ${clientSessionCount + 1}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      root: {
        id: generateNodeId(),
        text: formatSessionTimestamp(),
        // Same as createNewSession: no seeded first child, so the two
        // creation paths produce the same empty session. A placeholder node
        // that has to be replaced is a node that sometimes is not, and then it
        // reaches the canvas and every export as a balloon nobody wrote.
        children: [],
      },
    };

    await saveMap(newMap);
    await refreshAllData();
    handleSelectMap(newMap.id);
  };

  const handleDuplicateMap = async (target: MindMap) => {
    const newMap: MindMap = {
      ...target,
      id: `m_${Date.now().toString(36)}`,
      title: `${target.title} (Cópia)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveMap(newMap);
    await refreshAllData();
    handleSelectMap(newMap.id);
  };

  const handleRenameMap = async (mapId: string, newTitle: string) => {
    const m = maps.find((x) => x.id === mapId);
    if (!m) return;
    const updated = { ...m, title: newTitle };
    await saveMap(updated);
    await refreshAllData();
    if (activeMap?.id === mapId) {
      setActiveMap(updated);
    }
  };

  const handleDeleteMapWithUndo = async (target: MindMap) => {
    await deleteMap(target.id);
    // Mirrored in allMaps too: this handler is also reachable from the archive
    // view, and a stale copy there would let a deleted record reappear.
    setAllMaps((prev) => prev.filter((m) => m.id !== target.id));
    const remaining = maps.filter((m) => m.id !== target.id);
    setMaps(remaining);
    if (activeMap?.id === target.id && remaining.length > 0) {
      handleSelectMap(remaining[0].id);
    }

    setDeletedMapUndo(target);
    if (undoToastTimerRef.current) clearTimeout(undoToastTimerRef.current);
    undoToastTimerRef.current = window.setTimeout(() => {
      setDeletedMapUndo(null);
    }, 10000);
  };

  // Archive toggles a flag; it never removes data. refreshAllData() handles
  // the selection side effect: if the archived session was the active one, the
  // active-only filter leaves it out of the fallback and another session opens.
  const handleArchiveMap = async (target: MindMap, archive: boolean) => {
    if (archive) await archiveMap(target.id);
    else await unarchiveMap(target.id);
    await refreshAllData();
  };

  const handleRestoreDeletedMap = async () => {
    if (!deletedMapUndo) return;
    await saveMap(deletedMapUndo);
    await refreshAllData();
    handleSelectMap(deletedMapUndo.id);
    setDeletedMapUndo(null);
  };

  const handleUpdateSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    // The layout choice travels with the settings, so it survives a reload for
    // the same reason the rest of them do.
    if (newSettings.maximizeOutline !== settings.maximizeOutline) {
      setMaximizeOutline(newSettings.maximizeOutline);
      setIsMaximizedMap(false);
    }
    syncService.send({ type: 'client_font_scale', scale: newSettings.clientFontScale });
    // The client window renders the same map, so it follows the focus-zoom
    // setting live rather than needing a reload.
    syncService.send({ type: 'focus_zoom_mode', enabled: newSettings.focusZoomMode });
  };

  const isDark = settings.theme === 'noite';
  const highlightedPath = activeMap && selectedNodeId ? findPathToNode(activeMap.root, selectedNodeId) : null;

  /**
   * The "what am I editing" mirror above the canvas.
   *
   * It used to be one line — "Adicionando em <pai> › <texto>" — which put the
   * context and the text being typed on the same baseline, in the same weight
   * and the same colour. The two fought for the same horizontal space, and
   * neither read as primary: the eye had no way to tell which half was the
   * live content and which was the location.
   *
   * Stacked instead, one line each, so nothing competes for width:
   *
   *     Novo subitem em  Reunião          <- where, small and quiet
   *     Ligação com a equipe… ▌          <- what, bold and accented
   *
   * Only the DIRECT parent, deliberately. An earlier version walked the whole
   * ancestor chain ("Trabalho › Prazo › Reunião"), on the argument that a bare
   * "Reunião" is ambiguous in a deep map. That traded the thing the user
   * actually needs — a short, instantly readable answer — for a second path
   * hierarchy drawn next to the map that already draws one. The canvas and the
   * outline both show the full position already; the mirror only needs to say
   * which node this text will belong to.
   */
  let draftParentLabel = '';
  let draftVerb = '';
  if (draft && draft.active) {
    // draft.parentText is the label the outline already resolved, so the mirror
    // can never disagree with the row the text is being typed into. Fall back to
    // the tree only when the draft did not carry one.
    draftParentLabel = draft.parentText?.trim() ?? '';
    if (!draftParentLabel && activeMap && draft.parentId) {
      draftParentLabel =
        findNodeById(activeMap.root, draft.parentId)?.text?.trim() ?? '';
    }
    if (!draftParentLabel) draftParentLabel = 'Tópico raiz';
    draftVerb = draft.mode === 'add' ? 'Novo subitem em' : 'Em';
  }

  return (
    <div
      className="flex flex-col w-screen h-screen overflow-hidden bg-surface text-content"
    >
      {/* 1. TOP BAR

          Extracted into its own component. It was 215 lines of JSX inline here,
          which is the component-architecture problem before the design one: a
          view that cannot be read on its own cannot be reviewed on its own, and
          every piece of state it needed was a prop of a thousand-line parent.

          The bar also went from fourteen permanent controls to four plus a
          menu, and the one primary action is now unambiguous — see TopBar for
          why "Janela do Cliente" and "[Abrir]" could not both be it. */}
      <TopBar
        clientName={activeMap?.clientName || 'Cliente'}
        sessionLabel={activeMap?.sessionDate || activeMap?.title || 'Sessão'}
        isClientConnected={isClientConnected}
        isPaused={isPaused}
        focusZoomOn={settings.focusZoomMode}
        isDark={isDark}
        canRestoreSplit={isMaximizedMap && Boolean(activeMap)}
        narrowPane={isNarrow ? narrowPane : null}
        onSwapPane={() => setNarrowPane((p) => (p === 'outline' ? 'map' : 'outline'))}
        onOpenClients={() => setIsAdminOpen(true)}
        onOpenClientWindow={openClientWindow}
        /* Focusing the existing window when there is one, and opening when
           there is not. The ref is null after a reload even if the client
           window is still up, and openClientWindow reuses the named target
           rather than making a second window, so it is a safe fallback. */
        onFocusClientWindow={() => {
          if (clientWindowRef.current && !clientWindowRef.current.closed) {
            clientWindowRef.current.focus();
            return;
          }
          openClientWindow();
        }}
        onTogglePause={togglePause}
        onOpenMapList={() => setIsMapListOpen(true)}
        onToggleFocusZoom={() =>
          handleUpdateSettings({ ...settings, focusZoomMode: !settings.focusZoomMode })
        }
        onOpenShareGuide={() => setIsShareGuideOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onToggleTheme={() =>
          handleUpdateSettings({ ...settings, theme: isDark ? 'papel' : 'noite' })
        }
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRestoreSplit={() => setIsMaximizedMap(false)}
      />

      {/* 2. MAIN SPLIT VIEW */}
      <main ref={mainRef} className="flex-1 flex overflow-hidden relative">
        {/* Left Pane: Outline Editor.

            Full width when the map is dismissed. The pane is WIDTH-controlled,
            so the two maximisations are mutually exclusive: a maximized map
            leaves no outline and a maximized outline leaves no map. Guarding on
            both here means neither toggle can produce a window with neither
            surface — which would be an empty screen mid-session. */}
        {showOutlinePane && activeMap && (
          <section
            aria-label="Tópicos da sessão"
            className="border-r border-line flex flex-col h-full relative"
            style={{ width: outlineFull ? '100%' : `${outlineWidthPercent}%` }}
          >
            {/* ONE editor. The row editor is gone: 1960 lines whose every
                shortcut, affordance and bug report was about focus bookkeeping
                between N inputs, and a textarea already does the parts that
                mattered — cut, copy, paste and selection ACROSS levels are the
                browser's own, with no code at all. What it costs is named in
                the buffer's own footer: Tab is captured to indent, and Esc
                releases it. */}
            <MarkdownOutline
              root={activeMap.root}
              onUpdateRoot={handleUpdateRoot}
              onDraftChange={handleDraftChange}
              onSelectNode={handleSelectNode}
              selectedNodeId={selectedNodeId}
              focusDwellSeconds={settings.focusDwellSeconds}
              theme={settings.theme}
              outlineFontScale={settings.outlineFontScale}
              maximizeOutline={maximizeOutline}
              onToggleMaximize={() => {
                const next = !maximizeOutline;
                // Routed through the settings so the choice is persisted: a
                // therapist who always works this way should not re-press it.
                handleUpdateSettings({ ...settings, maximizeOutline: next });
              }}
              hidden={notesExpanded}
            />

            {/* Free-text notes, scoped to the CLIENT so they survive session
                switches. Sits under the outline rather than in a modal: the
                use is reading them while still typing in the outline, and a
                modal would take the keyboard away from the rows. Expanded, it
                takes the whole pane instead. */}
            <ClientNotesPanel
              clientId={activeMap.clientId}
              clientName={activeMap.clientName || 'Cliente'}
              expanded={notesExpanded}
              onExpandedChange={setNotesExpanded}
            />

            {/* The splitter.

                Absolutely positioned INSIDE the section rather than placed
                between the two panes. A sibling would take width from the map
                on both sides of it, so the map would end up narrower than
                100 - outlineWidth and the handle would sit in space that
                belongs to neither. Overlapping the section's own border costs
                nothing and puts the handle exactly on the line the user sees.

                The 44px hit area is far wider than the 1px line it draws, and
                deliberately so: a handle you have to hit within two pixels is
                a handle nobody finds. The visible rule stays hairline so the
                pane does not look like it is being edited. */}
            {!maximizeOutline && (
              <div
                role="separator"
                aria-label="Largura dos tópicos"
                aria-orientation="vertical"
                aria-valuenow={Math.round(outlineWidthPercent)}
                aria-valuemin={OUTLINE_MIN_PERCENT}
                aria-valuemax={OUTLINE_MAX_PERCENT}
                tabIndex={0}
                onPointerDown={startOutlineResize}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    nudgeOutlineWidth(e.shiftKey ? 10 : 2);
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    nudgeOutlineWidth(e.shiftKey ? -10 : -2);
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    setOutlineWidthPercent(OUTLINE_MIN_PERCENT);
                  }
                }}
                /* w-11 with -mr-11px, NOT w-0. For an absolutely positioned box
                   `right: 0` pins the right MARGIN edge, so a negative
                   margin-right pushes the whole element outward: w-0 left a
                   zero-width band sitting entirely OUTSIDE the pane, which is
                   a handle nobody can hit. 44px wide and pulled 22px out puts
                   the band across the border, 22px inside and 22px outside. */
                className="group absolute right-0 top-0 bottom-0 z-20 w-11 -mr-[22px] cursor-col-resize touch-none select-none focus:outline-none"
              >
                {/* The rule, and the grip, are on inner elements so the 44px hit
                    area can stay invisible. The grip is what says "this is
                    draggable" on hover, and it is driven by `group-focus` rather
                    than a peer: the focused element is this handle, not a
                    sibling of the grip. */}
                <div
                  className={`absolute right-[22px] top-0 bottom-0 w-px transition-colors ${
                    isResizingOutline ? 'bg-accent-text' : 'bg-line group-hover:bg-accent-text'
                  }`}
                  aria-hidden="true"
                />
                <div
                  className="absolute right-[13px] top-1/2 h-10 w-2 -translate-y-1/2 rounded-full bg-accent-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </div>
            )}
          </section>
        )}

        {/* Right Pane: Mindmap Preview.
            Dismissed entirely when the outline takes the screen: some sessions
            the therapist never looks at the map — the client has it on the
            second screen — and a 62% pane of canvas is a large piece of the
            display doing nothing. */}
        {showMap && (
        <section aria-label="Prévia do mapa" className="flex-1 flex flex-col h-full relative overflow-hidden">
          {/* Header Tag / Preview info */}
          <div className="absolute top-3 right-4 z-10 flex items-center gap-2 pointer-events-auto">
            <span className="text-[11px] font-bold text-content bg-surface-raised px-2.5 py-1 rounded-md border border-line shadow-2xs">
              Prévia do Mapa (Espelho da Janela B)
            </span>
            <button
              type="button"
              onClick={() => {
                // Maximizing the map dismisses the outline, so the persisted
                // "outline full screen" preference is switched off too. The two
                // maximisations are mutually exclusive: a window showing
                // neither surface would be blank.
                setIsMaximizedMap(true);
                if (maximizeOutline) {
                  handleUpdateSettings({ ...settings, maximizeOutline: false });
                }
              }}
              title="Maximizar prévia do mapa"
              aria-label="Maximizar prévia do mapa, ocultando os tópicos"
              className="ctl w-9 h-9 !min-h-0 px-0"
            >
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {activeMap ? (
            <MindMapCanvas
              root={activeMap.root}
              draft={draft}
              selectedNodeId={selectedNodeId}
              highlightedPath={highlightedPath}
              theme={settings.theme}
              fontScale={settings.clientFontScale}
              liveTextMode={settings.liveTextMode}
              clientName={activeMap.clientName}
              sessionDate={activeMap.sessionDate || activeMap.title}
              focusZoomMode={settings.focusZoomMode}
              onToggleFocusZoomMode={() =>
                handleUpdateSettings({
                  ...settings,
                  focusZoomMode: !settings.focusZoomMode,
                })
              }
              onNodeClick={(nodeId) => {
                handleSelectNode(nodeId, 'click');
              }}
              onToggleCollapse={(nodeId) => {
                handleUpdateRoot(
                  toggleNodeCollapse(activeMap.root, nodeId),
                  'collapse'
                );
              }}
              svgRef={svgCanvasRef}
            />
          ) : (
            /* Empty is a real state now that deleting the last session sticks:
               previously the sample map was reseeded, so this branch was
               nearly unreachable and said nothing actionable when it was. */
            <div className="flex flex-col items-center justify-center gap-3 h-full p-6 text-center">
              <p className="text-content-muted text-xs font-medium">
                Nenhuma sessão ativa neste navegador.
              </p>
              <button
                type="button"
                onClick={handleCreateNewMap}
                className="ctl ctl-primary"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Nova sessão</span>
              </button>
            </div>
          )}

          {/* The SAME bar the client sees.

              It used to be a second implementation of the same sentence, and
              that is the only way two copies can disagree: the client's keyed
              off an idle timer and sat still, this one keyed off "is the edited
              node on screen" and recomputed that on every keystroke — so it
              appeared and vanished as the balloon grew and shrank around the
              edge of the viewport. Same words, two behaviours.

              One component, so there is nothing left to disagree. The
              visibility rule is the CLIENT's: an idle timeout, so the bar
              appears while something is being typed and settles when the
              therapist stops. The canvas already highlights the node being
              edited, and with focus zoom it centres it, so restating that here
              was the noise — a floating card over the canvas. */}
          <TypingBar
            label={draft && draft.active ? `${draftVerb} ${draftParentLabel} › ` : ''}
            text={draft?.text ?? ''}
            visible={typingBarVisible}
            liveTextMode={settings.liveTextMode}
          />
        </section>
        )}
      </main>

      {/* 3. FOOTER */}
      <footer className="flex items-center justify-between px-5 py-1.5 border-t border-line bg-surface-raised text-content-muted text-[11px] shrink-0 font-medium">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-positive" aria-hidden="true" />
            <span
              role="status"
              aria-live="polite"
              className="font-bold text-content"
            >
              {saveStatus === 'salvando' ? 'Gravando…' : 'Salvo localmente'}
            </span>
          </span>
          <span aria-hidden="true" className="text-content-subtle">·</span>
          <span className="font-medium">100% offline & seguro</span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          <button
            type="button"
            onClick={handleUndo}
            title="Desfazer (Ctrl+Z)"
            aria-label="Desfazer"
            className="flex items-center gap-1 text-content hover:text-content-subtle cursor-pointer font-sans"
          >
            <Undo2 className="w-3 h-3" aria-hidden="true" />
            <span>Desfazer</span>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            title="Refazer (Ctrl+Shift+Z)"
            aria-label="Refazer"
            className="flex items-center gap-1 text-content hover:text-content-subtle cursor-pointer font-sans"
          >
            <Redo2 className="w-3 h-3" aria-hidden="true" />
            <span>Refazer</span>
          </button>
          <span aria-hidden="true" className="text-content-subtle">·</span>
          <span><strong className="text-content font-bold">Ctrl+.</strong> Pausa</span>
          <span aria-hidden="true" className="text-content-subtle">·</span>
          {/* The footer used to advertise Ctrl+Enter and Esc as if they were
              global shortcuts. Both are owned by the outline editor and only
              fire when focus is inside it, so the hint now says where they
              apply instead of promising a shortcut the app does not deliver. */}
          <span><strong className="text-content font-bold">Ctrl+Enter</strong> / <strong className="text-content font-bold">Esc</strong> no outline</span>
        </div>
      </footer>

      {/* 4. MODALS & DRAWERS */}
      <AdminClientManager
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        clients={clients}
        // The admin panel owns its own archive view, so it needs EVERY session,
        // not the active-only subset the working view keeps in state.
        maps={allMaps}
        activeMapId={activeMap?.id || ''}
        activeClientId={activeMap?.clientId || null}
        onSelectSession={(session) => {
          handleSelectMap(session.id);
        }}
        onRefreshData={refreshAllData}
        theme={settings.theme}
      />

      <ShareGuideModal
        isOpen={isShareGuideOpen}
        onClose={() => setIsShareGuideOpen(false)}
        onOpenClientWindow={openClientWindow}
        theme={settings.theme}
      />

      {activeMap && (
        <ExportModal
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          map={activeMap}
          clients={clients}
          maps={allMaps}
          svgRef={svgCanvasRef}
          theme={settings.theme}
          onImportMap={(newMap) => {
            saveMap(newMap).then(async () => {
              await refreshAllData();
              handleSelectMap(newMap.id);
            });
          }}
          onUpdateCurrentMapRoot={(newRoot) => {
            handleUpdateRoot(newRoot, 'import');
          }}
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />

      <MapListDrawer
        isOpen={isMapListOpen}
        onClose={() => setIsMapListOpen(false)}
        maps={maps}
        activeMapId={activeMap?.id || ''}
        onSelectMap={handleSelectMap}
        onCreateNewMap={handleCreateNewMap}
        onDuplicateMap={handleDuplicateMap}
        onRenameMap={handleRenameMap}
        onDeleteMapWithUndo={handleDeleteMapWithUndo}
        onArchiveMap={handleArchiveMap}
        onRefresh={refreshAllData}
        theme={settings.theme}
      />

      {/* 10-Second Undo Delete Toast. It follows the app theme rather than
          being permanently dark, so the "Desfazer" affordance is a token
          pair (5.0:1 / 11.1:1) instead of an unmeasured hard-coded amber. */}
      {deletedMapUndo && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-10 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-raised border border-line text-content shadow-2xl text-xs"
        >
          <span>Sessão "{deletedMapUndo.sessionDate || deletedMapUndo.title}" excluída.</span>
          <button
            type="button"
            onClick={handleRestoreDeletedMap}
            className="font-bold text-accent-text hover:underline"
          >
            Desfazer
          </button>
        </div>
      )}
    </div>
  );
};
