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
  Sparkles,
  CheckCircle2,
  Undo2,
  Redo2,
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
import { findPathToNode, findNodeById, generateNodeId } from '../utils/tree';

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

  // Update document title for Window A: "PRIVADO · Narratips"
  useEffect(() => {
    const title = activeMap
      ? `PRIVADO · ${activeMap.clientName || 'Cliente'} (${activeMap.sessionDate || activeMap.title})`
      : 'PRIVADO · Narratips';
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

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
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
      className={`flex flex-col w-screen h-screen overflow-hidden ${
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-[#F7F6F2] text-stone-900'
      }`}
    >
      {/* 1. TOP BAR */}
      <header
        className={`h-14 px-5 flex items-center justify-between border-b z-20 shrink-0 ${
          isDark
            ? 'bg-[#0B0F19] border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900 shadow-2xs'
        }`}
      >
        {/* Zone 1: Context (Brand, Privacy, Client & Session) */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-black tracking-tight text-slate-950 dark:text-white">
              Narratips
            </span>
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          </div>

          <div className="h-4 w-px bg-slate-300 dark:bg-slate-800 mx-0.5" />

          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-[10px] font-bold tracking-wider text-slate-700 dark:text-slate-300 uppercase">
            <Lock className="w-3 h-3 text-slate-500 dark:text-slate-400" />
            <span>PRIVADO</span>
          </div>

          <div className="h-4 w-px bg-slate-300 dark:bg-slate-800 mx-0.5" />

          {/* Client & Session Switcher Button */}
          <button
            type="button"
            onClick={() => setIsAdminOpen(true)}
            className="h-9 px-3 flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100 shadow-2xs transition-colors cursor-pointer"
            title="Gerenciar Clientes e Sessões"
          >
            <Users className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="font-bold text-slate-950 dark:text-white">
              {activeMap?.clientName || 'Cliente'}
            </span>
            <span className="text-slate-400 dark:text-slate-600">·</span>
            <span className="font-mono text-[11px] font-medium text-slate-700 dark:text-slate-300">
              {activeMap?.sessionDate || activeMap?.title || 'Sessão'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5 shrink-0" />
          </button>
        </div>

        {/* Zone 2: Stream & Broadcast Status */}
        <div className="hidden lg:flex items-center gap-2.5">
          {/* Status Badge */}
          {isPaused ? (
            <div className="h-9 px-3 flex items-center gap-2 rounded-lg bg-rose-50 dark:bg-rose-950/80 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-800 text-xs font-bold animate-pulse">
              <span className="w-2 h-2 rounded-full bg-rose-600" />
              <span>Cliente em Pausa</span>
            </div>
          ) : isClientConnected ? (
            <div className="h-9 px-3 flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Cliente Conectado</span>
            </div>
          ) : (
            <div className="h-9 px-3 flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Cliente Desconectado</span>
              <button
                type="button"
                onClick={openClientWindow}
                className="underline hover:text-amber-950 dark:hover:text-white font-bold ml-1 cursor-pointer"
              >
                [Abrir]
              </button>
            </div>
          )}

          {/* Quick Pause / Resume Button */}
          <button
            type="button"
            onClick={togglePause}
            title="Pausar ou retomar a tela do cliente (Ctrl+.)"
            className={`h-9 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
              isPaused
                ? 'bg-rose-600 text-white border-rose-700 shadow-sm'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{isPaused ? 'Retomar Tela' : 'Pausar (Ctrl+.)'}</span>
          </button>
        </div>

        {/* Zone 3: Actions & Tools */}
        <div className="flex items-center gap-2">
          {/* Focus Zoom Mode Toggle */}
          <button
            type="button"
            onClick={() =>
              handleUpdateSettings({
                ...settings,
                focusZoomMode: !settings.focusZoomMode,
              })
            }
            title={
              settings.focusZoomMode
                ? 'Foco com Zoom ATIVADO (clique para alternar)'
                : 'Foco com Zoom DESATIVADO (clique para ativar)'
            }
            className={`h-9 px-3 flex items-center gap-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
              settings.focusZoomMode
                ? 'bg-amber-400 text-slate-950 border-amber-500 shadow-2xs ring-1 ring-amber-500/20'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Target className="w-3.5 h-3.5 text-slate-950 dark:text-amber-400" />
            <span className="hidden sm:inline">Zoom no Foco</span>
          </button>

          {/* Primary Action Button: Open Client Window */}
          <button
            type="button"
            onClick={openClientWindow}
            className="h-9 px-3.5 flex items-center gap-2 text-xs font-bold text-white bg-slate-950 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 rounded-lg transition-colors shadow-xs cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Janela do Cliente</span>
          </button>

          <div className="h-5 w-px bg-slate-300 dark:bg-slate-800 mx-0.5" />

          {/* Tools Group */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsShareGuideOpen(true)}
              title="Guia de compartilhamento seguro para Zoom/Meet/Teams"
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsExportOpen(true)}
              title="Exportar mapa (Ctrl+E)"
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              title="Configurações"
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Sliders className="w-4 h-4" />
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
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN SPLIT VIEW */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Pane: Outline Editor */}
        {!isMaximizedMap && activeMap && (
          <div
            className="border-r border-stone-200 dark:border-stone-800 flex flex-col h-full bg-white dark:bg-stone-900/60"
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
          </div>
        )}

        {/* Right Pane: Mindmap Preview */}
        <div className="flex-1 flex flex-col h-full relative overflow-hidden">
          {/* Header Tag / Preview info */}
          <div className="absolute top-3 right-4 z-10 flex items-center gap-2 pointer-events-auto">
            <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 shadow-2xs">
              Prévia do Mapa (Espelho da Janela B)
            </span>
            <button
              type="button"
              onClick={() => setIsMaximizedMap(!isMaximizedMap)}
              title={isMaximizedMap ? 'Restaurar divisão' : 'Maximizar prévia'}
              className="p-1 text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white bg-white/95 dark:bg-slate-900/95 rounded-md border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer"
            >
              {isMaximizedMap ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
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
                const newRoot = { ...activeMap.root };
                handleUpdateRoot(newRoot, 'collapse');
              }}
              svgRef={svgCanvasRef}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-600 dark:text-slate-400 text-xs font-medium">
              Nenhuma sessão selecionada.
            </div>
          )}

          {/* Mirror of Thin Bar at Bottom */}
          {draft && draft.active && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none transition-all duration-300">
              <div
                className={`px-4 py-1.5 rounded-xl shadow-lg border backdrop-blur-md max-w-lg flex items-center gap-2 ${
                  isDark
                    ? 'bg-slate-900/95 border-slate-700 text-slate-100'
                    : 'bg-white/95 border-slate-300 text-slate-950'
                }`}
              >
                <span className="text-xs font-bold text-amber-700 dark:text-amber-400 shrink-0">
                  {thinBarPreviewText}
                </span>
                {settings.liveTextMode === 'live' && (
                  <span className="animate-ping font-mono text-amber-600 dark:text-amber-400 text-xs shrink-0">
                    ▌
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. FOOTER */}
      <footer
        className={`flex items-center justify-between px-5 py-1.5 border-t text-[11px] shrink-0 font-medium ${
          isDark
            ? 'bg-[#0B0F19] border-slate-800 text-slate-300'
            : 'bg-white border-slate-200 text-slate-700'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-bold text-slate-900 dark:text-white">
              {saveStatus === 'salvando' ? 'Gravando…' : 'Salvo localmente'}
            </span>
          </span>
          <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">·</span>
          <span className="font-medium text-slate-600 dark:text-slate-400">100% offline & seguro</span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          <button
            type="button"
            onClick={handleUndo}
            title="Desfazer (Ctrl+Z)"
            className="flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white cursor-pointer font-sans"
          >
            <Undo2 className="w-3 h-3" />
            <span>Desfazer</span>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            title="Refazer (Ctrl+Shift+Z)"
            className="flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white cursor-pointer font-sans"
          >
            <Redo2 className="w-3 h-3" />
            <span>Refazer</span>
          </button>
          <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">·</span>
          <span><strong className="text-slate-900 dark:text-slate-200 font-bold">Ctrl+.</strong> Pausa</span>
          <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">·</span>
          <span><strong className="text-slate-900 dark:text-slate-200 font-bold">Ctrl+Enter</strong> Cria Filho</span>
          <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">·</span>
          <span><strong className="text-slate-900 dark:text-slate-200 font-bold">Esc</strong> Limpa foco</span>
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

      {/* 10-Second Undo Delete Toast */}
      {deletedMapUndo && (
        <div className="fixed bottom-10 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-stone-900 text-white shadow-2xl text-xs">
          <span>Sessão "{deletedMapUndo.sessionDate || deletedMapUndo.title}" excluída.</span>
          <button
            type="button"
            onClick={handleRestoreDeletedMap}
            className="font-bold text-amber-400 hover:text-amber-300 underline"
          >
            Desfazer
          </button>
        </div>
      )}
    </div>
  );
};
