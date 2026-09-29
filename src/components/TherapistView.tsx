import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Lock,
  Pause,
  Play,
  Share2,
  Download,
  Sliders,
  Sun,
  Moon,
  ExternalLink,
  ChevronDown,
  Maximize2,
  Minimize2,
  PanelLeft,
  Users,
  Target,
  CheckCircle2,
  Undo2,
  Redo2,
  Layers,
  Plus,
  CornerDownRight,
} from 'lucide-react';
import { Client, MindMap, MindMapNode, Settings } from '../types';
import { OutlineEditor } from './outline/OutlineEditor';
import { MindMapCanvas } from './mindmap/MindMapCanvas';
import { ShareGuideModal } from './modals/ShareGuideModal';
import { ExportModal } from './modals/ExportModal';
import { SettingsModal } from './modals/SettingsModal';
import { MapListDrawer } from './modals/MapListDrawer';
import { AdminClientManager } from './admin/AdminClientManager';
import { ClientNotesPanel } from './ui/ClientNotesPanel';
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
import {
  findPathToNode,
  findNodeById,
  generateNodeId,
  toggleNodeCollapse,
  formatSessionTimestamp,
  normalizeOutline,
} from '../utils/tree';

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
  const [editTargetVisible, setEditTargetVisible] = useState(true);
  /** Lifted so the outline can be hidden while the notes take the pane. */
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [activeMap, setActiveMap] = useState<MindMap | null>(null);
  const [settings, setSettings] = useState<Settings>(() => getSettings());

  // Split view ratio
  const [outlineWidthPercent, setOutlineWidthPercent] = useState<number>(38);
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
    (nodeId: string | null, reason: 'focus3s' | 'click' | 'clear' | 'navigate') => {
      setSelectedNodeId(nodeId);
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
      {/* 1. TOP BAR */}
      <header className="h-14 px-5 flex items-center justify-between border-b border-line bg-surface-raised z-20 shrink-0">
        {/* Zone 1: Context (Brand, Privacy, Client & Session) */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-black tracking-tight text-content">
              SessionMap
            </span>
            {/* Decorative brand ornament next to the wordmark — no state, so
                it is exempt from SC 1.4.11 and hidden from AT. */}
            <div className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
          </div>

          <div className="h-4 w-px bg-line mx-0.5" aria-hidden="true" />

          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-inset border border-line text-[10px] font-bold tracking-wider text-content-muted uppercase">
            <Lock className="w-3 h-3" aria-hidden="true" />
            <span>PRIVADO</span>
          </div>

          <div className="h-4 w-px bg-line mx-0.5" aria-hidden="true" />

          {/* Client & Session Switcher Button */}
          <button
            type="button"
            onClick={() => setIsAdminOpen(true)}
            className="ctl !min-h-0 h-9 px-3 !gap-2 text-xs font-semibold"
            title="Gerenciar Clientes e Sessões"
            aria-label="Gerenciar clientes e sessões"
          >
            <Users className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden="true" />
            <span className="font-bold text-content">{activeMap?.clientName || 'Cliente'}</span>
            <span aria-hidden="true" className="text-content-subtle">·</span>
            <span className="font-mono text-[11px] font-medium text-content-muted">
              {activeMap?.sessionDate || activeMap?.title || 'Sessão'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-content-muted ml-0.5 shrink-0" aria-hidden="true" />
          </button>
        </div>

        {/* Zone 2: Stream & Broadcast Status.
            The three pills are identical apart from their state colour and
            their words: the label carries the state for anyone who cannot
            separate amber from red, and the dot is ringed in forced-colors. */}
        <div className="hidden lg:flex items-center gap-2.5">
          {/* Status Badge */}
          {isPaused ? (
            <div
              role="status"
              className="h-9 px-3 flex items-center gap-2 rounded-lg bg-surface-inset border border-line text-xs font-bold text-content animate-pulse"
            >
              <span data-state-dot="" className="w-2 h-2 rounded-full bg-negative" />
              <span>Cliente em Pausa</span>
            </div>
          ) : isClientConnected ? (
            <div
              role="status"
              className="h-9 px-3 flex items-center gap-2 rounded-lg bg-surface-inset border border-line text-xs font-bold text-content"
            >
              <span data-state-dot="" className="w-2 h-2 rounded-full bg-positive animate-pulse" />
              <span>Cliente Conectado</span>
            </div>
          ) : (
            /* The label stays --text in all three states (12.4:1 / 15.6:1) and
               the state colour lives in the dot. --caution as 12px text was
               4.40:1 on --surface-inset, a hair under AA, and the words
               already say what the colour was saying. */
            <div
              role="status"
              className="h-9 px-3 flex items-center gap-2 rounded-lg bg-surface-inset border border-line text-xs font-semibold text-content"
            >
              <span data-state-dot="" className="w-2 h-2 rounded-full bg-caution" />
              <span>Cliente Desconectado</span>
              <button
                type="button"
                onClick={openClientWindow}
                className="underline hover:text-content font-bold ml-1 cursor-pointer"
              >
                [Abrir]
              </button>
            </div>
          )}

          {/* Quick Pause / Resume Button. Resuming is the primary action, so
              the pressed state gets the accent fill rather than a second
              bespoke red one. */}
          <button
            type="button"
            onClick={togglePause}
            title="Pausar ou retomar a tela do cliente (Ctrl+.)"
            className={`ctl !min-h-0 h-9 px-3 text-xs font-bold ${
              isPaused ? 'ctl-primary' : ''
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" /> : <Pause className="w-3.5 h-3.5" aria-hidden="true" />}
            <span>{isPaused ? 'Retomar Tela' : 'Pausar (Ctrl+.)'}</span>
          </button>
        </div>

        {/* Zone 3: Actions & Tools */}
        <div className="flex items-center gap-2">
          {/* Opens MapListDrawer: the session library, and the only
              surface with per-map rename / duplicate / delete + undo. */}
          <button
            type="button"
            onClick={() => setIsMapListOpen(true)}
            title="Mapas e sessões salvos"
            aria-label="Abrir mapas e sessões salvos"
            className="ctl w-9 h-9 !min-h-0 px-0"
          >
            <Layers className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* Focus Zoom Mode Toggle. aria-pressed carries the state, so the
              amber fill is a redundant cue rather than the only one. */}
          <button
            type="button"
            onClick={() =>
              handleUpdateSettings({
                ...settings,
                focusZoomMode: !settings.focusZoomMode,
              })
            }
            aria-pressed={settings.focusZoomMode}
            title={
              settings.focusZoomMode
                ? 'Foco com Zoom ATIVADO (clique para alternar)'
                : 'Foco com Zoom DESATIVADO (clique para ativar)'
            }
            className={`ctl !min-h-0 h-9 px-3 text-xs font-bold ${
              settings.focusZoomMode ? 'ctl-primary' : ''
            }`}
          >
            <Target className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Zoom no Foco</span>
          </button>

          {/* Primary Action Button: Open Client Window */}
          <button
            type="button"
            onClick={openClientWindow}
            className="ctl ctl-primary !min-h-0 h-9 px-3.5 text-xs font-bold"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Janela do Cliente</span>
          </button>

          <div className="h-5 w-px bg-line mx-0.5" aria-hidden="true" />

          {/* Tools Group */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsShareGuideOpen(true)}
              title="Guia de compartilhamento seguro para Zoom/Meet/Teams"
              aria-label="Guia de compartilhamento seguro para Zoom, Meet e Teams"
              className="ctl w-9 h-9 !min-h-0 px-0"
            >
              <Share2 className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setIsExportOpen(true)}
              title="Exportar mapa (Ctrl+E)"
              aria-label="Exportar mapa"
              className="ctl w-9 h-9 !min-h-0 px-0"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* Layout toggle. It lives in the app header, not on a pane,
                because whichever pane is currently maximized is the one whose
                control would be needed to come back — and it is the pane that
                is gone. A control attached to a surface that can dismiss itself
                has no way to undo the dismissal. This button is always present,
                and it is the single control for one boolean: three buttons
                toggling the same layout is what the design audit called out as
                "three competing controls for one boolean". */}
            {activeMap && (
              <button
                type="button"
                onClick={() => {
                  const next = !(isMaximizedMap || maximizeOutline);
                  // Routed through the settings, not set directly, so the
                  // choice is persisted with everything else. Setting local
                  // state alone would reset on reload and the user would
                  // re-press it every session.
                  handleUpdateSettings({ ...settings, maximizeOutline: next });
                  setIsMaximizedMap(false);
                }}
                title={
                  isMaximizedMap || maximizeOutline
                    ? 'Restaurar a divisão com o mapa'
                    : 'Expandir os tópicos para a tela inteira'
                }
                aria-label={
                  isMaximizedMap || maximizeOutline
                    ? 'Restaurar a divisão com o mapa'
                    : 'Expandir os tópicos para a tela inteira, ocultando o mapa'
                }
                className="ctl w-9 h-9 !min-h-0 px-0"
              >
                {isMaximizedMap || maximizeOutline ? (
                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <PanelLeft className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              title="Configurações"
              aria-label="Configurações"
              className="ctl w-9 h-9 !min-h-0 px-0"
            >
              <Sliders className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() =>
                handleUpdateSettings({
                  ...settings,
                  theme: isDark ? 'papel' : 'noite',
                })
              }
              title={isDark ? 'Tema Papel (claro)' : 'Tema Noite (escuro)'}
              aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              className="ctl w-9 h-9 !min-h-0 px-0"
            >
              {isDark ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN SPLIT VIEW */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left Pane: Outline Editor.

            Full width when the map is dismissed. The pane is WIDTH-controlled,
            so the two maximisations are mutually exclusive: a maximized map
            leaves no outline and a maximized outline leaves no map. Guarding on
            both here means neither toggle can produce a window with neither
            surface — which would be an empty screen mid-session. */}
        {!isMaximizedMap && activeMap && (
          <section
            aria-label="Tópicos da sessão"
            className="border-r border-line flex flex-col h-full"
            style={{ width: maximizeOutline ? '100%' : `${outlineWidthPercent}%` }}
          >
            {/* Hidden, not unmounted, while the notes are expanded: unmounting
                would drop the outline's row focus and, with it, whatever the
                therapist had selected on the canvas. */}
            <OutlineEditor
              root={activeMap.root}
              onUpdateRoot={handleUpdateRoot}
              onDraftChange={handleDraftChange}
              onSelectNode={handleSelectNode}
              selectedNodeId={selectedNodeId}
              focusDwellSeconds={settings.focusDwellSeconds}
              theme={settings.theme}
              enableNodeMove={settings.enableNodeMove}
              outlineFontScale={settings.outlineFontScale}
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
          </section>
        )}

        {/* Right Pane: Mindmap Preview.
            Dismissed entirely when the outline takes the screen: some sessions
            the therapist never looks at the map — the client has it on the
            second screen — and a 62% pane of canvas is a large piece of the
            display doing nothing. */}
        {!maximizeOutline && (
        <section aria-label="Prévia do mapa" className="flex-1 flex flex-col h-full relative overflow-hidden">
          {/* Header Tag / Preview info */}
          <div className="absolute top-3 right-4 z-10 flex items-center gap-2 pointer-events-auto">
            <span className="text-[11px] font-bold text-content bg-surface-raised px-2.5 py-1 rounded-md border border-line shadow-2xs">
              Prévia do Mapa (Espelho da Janela B)
            </span>
            <button
              type="button"
              onClick={() => {
                // Expanding the map dismisses the outline and vice versa, so the
                // two controls cannot both be pressed and leave an empty window.
                setIsMaximizedMap(true);
                handleUpdateSettings({ ...settings, maximizeOutline: false });
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
              onEditTargetVisibleChange={setEditTargetVisible}
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

          {/* Mirror of Thin Bar at Bottom. Solid --surface-raised rather than
              a /95 wash: the label and the live caret are both text, and a
              composited background is not a pair that can be measured.

              Two stacked lines, not one. See draftParentLabel for why the
              location and the live text are separated vertically. The whole
              region is one live region so a screen reader hears the location
              and the text as a single announcement rather than two unrelated
              strings.

              Shown ONLY while the node being edited is off-screen, and docked
              bottom-LEFT. Two rules, both about not covering things:

              1. It used to be centred at the bottom, where it sat on top of
                 the canvas control cluster (zoom, fit, reset) in the
                 bottom-right — a transient badge permanently hiding the tools
                 you need mid-session. Overlays are not supposed to cover
                 controls; the layout should reserve a zone for them and keep
                 transient UI out of it. Bottom-right is that reserved zone, so
                 the mirror goes to bottom-left, which is free.

              2. More importantly, the canvas ALREADY shows the target: it
                 highlights the node and, with focus zoom on, centres it. So
                 the mirror mostly restated what was on screen, at the cost of
                 a permanent floating card in the middle of the canvas. It now
                 appears only when the target is off-screen — panned away,
                 zoomed out, or on a collapsed branch — which is the only case
                 where the information is not already visible. That removes
                 the noise instead of relocating it. */}
          {draft && draft.active && !editTargetVisible && (
            <div
              role="status"
              aria-live="polite"
              className="absolute bottom-4 left-4 z-30 pointer-events-none transition-all duration-300 w-[min(26rem,calc(100%-2rem))]"
            >
              <div className="px-4 py-2 rounded-panel shadow-lg border border-line bg-surface-raised text-content">
                {/* Line 1 — where. One short fragment: the direct parent,
                    nothing more. Quiet, small, truncating normally with the
                    full name on the title attribute for hover. */}
                <div className="flex items-baseline gap-1.5 text-[11px] leading-tight text-content-muted">
                  <CornerDownRight
                    className="w-3 h-3 shrink-0 self-center"
                    aria-hidden="true"
                  />
                  <span className="shrink-0 font-semibold">{draftVerb}</span>
                  <span className="min-w-0 truncate" title={draftParentLabel}>
                    {draftParentLabel}
                  </span>
                </div>
                {/* Line 2 — what. The only accented, bold, live element here,
                    so the eye lands on the text and the caret with it. */}
                <div className="mt-0.5 flex items-center gap-1 text-sm font-bold leading-tight text-accent-text">
                  <span className="min-w-0 truncate">
                    {draft.text || <span className="text-content-subtle">digitando…</span>}
                  </span>
                  {settings.liveTextMode === 'live' && (
                    <span aria-hidden="true" className="animate-ping font-mono text-xs shrink-0">
                      ▌
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
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
