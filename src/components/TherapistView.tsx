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
  Users,
  Target,
  CheckCircle2,
  Undo2,
  Redo2,
  Layers,
} from 'lucide-react';
import { Client, MindMap, MindMapNode, Settings } from '../types';
import { OutlineEditor } from './outline/OutlineEditor';
import { MindMapCanvas } from './mindmap/MindMapCanvas';
import { ShareGuideModal } from './modals/ShareGuideModal';
import { ExportModal } from './modals/ExportModal';
import { SettingsModal } from './modals/SettingsModal';
import { MapListDrawer } from './modals/MapListDrawer';
import { AdminClientManager } from './admin/AdminClientManager';
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
} from '../services/storage';
import { syncService } from '../services/sync';
import {
  findPathToNode,
  findNodeById,
  generateNodeId,
  toggleNodeCollapse,
} from '../utils/tree';

export const TherapistView: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [maps, setMaps] = useState<MindMap[]>([]);
  const [activeMap, setActiveMap] = useState<MindMap | null>(null);
  const [settings, setSettings] = useState<Settings>(() => getSettings());

  // Split view ratio
  const [outlineWidthPercent, setOutlineWidthPercent] = useState<number>(38);
  const [isMaximizedMap, setIsMaximizedMap] = useState<boolean>(false);

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
    const [loadedClients, loadedMaps] = await Promise.all([
      getAllClients(),
      getAllMaps(),
    ]);
    setClients(loadedClients);
    setMaps(loadedMaps);

    const savedActiveId = getActiveMapId();
    const current = loadedMaps.find((m) => m.id === savedActiveId) || loadedMaps[0];
    if (current) {
      setActiveMap(current);
      historyRef.current = [current.root];
      historyIndexRef.current = 0;
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
      : 'PRIVADO · sessionmap';
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
      'NarratipsClientMap',
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

    if (reason !== 'typing') {
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
  };

  // Create New Map (Quick from Drawer)
  const handleCreateNewMap = async () => {
    const client = clients[0] || { id: 'c_default', name: 'Cliente' };
    const newId = `m_${Date.now().toString(36)}`;
    const newMap: MindMap = {
      schema: 1,
      id: newId,
      clientId: client.id,
      clientName: client.name,
      sessionDate: new Date().toLocaleDateString('pt-BR'),
      title: `Sessão ${maps.length + 1}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      root: {
        id: generateNodeId(),
        text: client.name,
        children: [
          { id: generateNodeId(), text: 'Tópico Principal', children: [] },
        ],
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
    syncService.send({ type: 'client_font_scale', scale: newSettings.clientFontScale });
  };

  const isDark = settings.theme === 'noite';
  const highlightedPath = activeMap && selectedNodeId ? findPathToNode(activeMap.root, selectedNodeId) : null;

  // Thin Bar preview text (properly resolved to target parent, not grandparent!)
  let thinBarPreviewText = '';
  if (draft && draft.active && activeMap) {
    if (draft.mode === 'add') {
      const parentName =
        draft.parentText ||
        (draft.parentId === activeMap.root.id
          ? activeMap.root.text
          : (draft.parentId ? findNodeById(activeMap.root, draft.parentId)?.text : activeMap.root.text));
      thinBarPreviewText = `Adicionando em ${parentName || 'Tópico'} › ${draft.text || ''}`;
    } else {
      thinBarPreviewText = `Editando › ${draft.text || ''}`;
    }
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
              Narratips
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
        {/* Left Pane: Outline Editor */}
        {!isMaximizedMap && activeMap && (
          <section
            aria-label="Tópicos da sessão"
            className="border-r border-line flex flex-col h-full"
            style={{ width: `${outlineWidthPercent}%` }}
          >
            <OutlineEditor
              root={activeMap.root}
              onUpdateRoot={handleUpdateRoot}
              onDraftChange={handleDraftChange}
              onSelectNode={handleSelectNode}
              selectedNodeId={selectedNodeId}
              focusDwellSeconds={settings.focusDwellSeconds}
              theme={settings.theme}
            />
          </section>
        )}

        {/* Right Pane: Mindmap Preview */}
        <section aria-label="Prévia do mapa" className="flex-1 flex flex-col h-full relative overflow-hidden">
          {/* Header Tag / Preview info */}
          <div className="absolute top-3 right-4 z-10 flex items-center gap-2 pointer-events-auto">
            <span className="text-[11px] font-bold text-content bg-surface-raised px-2.5 py-1 rounded-md border border-line shadow-2xs">
              Prévia do Mapa (Espelho da Janela B)
            </span>
            <button
              type="button"
              onClick={() => setIsMaximizedMap(!isMaximizedMap)}
              title={isMaximizedMap ? 'Restaurar divisão' : 'Maximizar prévia'}
              aria-label={isMaximizedMap ? 'Restaurar divisão' : 'Maximizar prévia'}
              className="ctl w-9 h-9 !min-h-0 px-0"
            >
              {isMaximizedMap ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />}
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
            <div className="flex items-center justify-center h-full text-content-muted text-xs font-medium">
              Nenhuma sessão selecionada.
            </div>
          )}

          {/* Mirror of Thin Bar at Bottom. Solid --surface-raised rather than
              a /95 wash: the label and the live caret are both text, and a
              composited background is not a pair that can be measured. */}
          {draft && draft.active && (
            <div
              role="status"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none transition-all duration-300"
            >
              <div className="px-4 py-1.5 rounded-xl shadow-lg border border-line bg-surface-raised text-content max-w-lg flex items-center gap-2">
                <span className="text-xs font-bold text-accent-text shrink-0">
                  {thinBarPreviewText}
                </span>
                {settings.liveTextMode === 'live' && (
                  <span
                    aria-hidden="true"
                    className="animate-ping font-mono text-accent-text text-xs shrink-0"
                  >
                    ▌
                  </span>
                )}
              </div>
            </div>
          )}
        </section>
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
        maps={maps}
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
          maps={maps}
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
