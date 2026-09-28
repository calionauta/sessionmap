import React, { useState, useEffect, useRef } from 'react';
import { MindMap, SyncMessage } from '../types';
import { MindMapCanvas } from './mindmap/MindMapCanvas';
import { syncService } from '../services/sync';
import { getCachedActiveMap, getSettings } from '../services/storage';
import { Maximize, Minimize } from 'lucide-react';
import { findPathToNode, findNodeById } from '../utils/tree';

export const ClientView: React.FC = () => {
  const [map, setMap] = useState<MindMap | null>(() => getCachedActiveMap());
  const [draft, setDraft] = useState<{
    mode: 'add' | 'edit';
    parentId: string | null;
    targetId?: string | null;
    parentText?: string;
    text: string;
    active: boolean;
  } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [fontScale, setFontScale] = useState<number>(1.0);
  const [theme, setTheme] = useState<'papel' | 'noite'>('papel');
  const [liveTextMode, setLiveTextMode] = useState<'live' | 'confirm_only'>('live');
  const [thinBarAlwaysVisible, setThinBarAlwaysVisible] = useState<boolean>(false);

  // Auto-hide bottom bar after 4s idle
  const [barVisible, setBarVisible] = useState<boolean>(false);
  const barTimerRef = useRef<number | null>(null);

  // Auto-hide mouse cursor after 2.5s idle
  const [cursorHidden, setCursorHidden] = useState<boolean>(false);
  const cursorTimerRef = useRef<number | null>(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Strictly set document title to neutral "Mapa" (RF-40 & RF-42)
  useEffect(() => {
    document.title = 'Mapa';
  }, []);

  // Sync theme class to document.documentElement
  useEffect(() => {
    if (theme === 'noite') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Sync service init & subscriptions
  useEffect(() => {
    syncService.initAsClient();

    const initialSettings = getSettings();
    setTheme(initialSettings.theme);
    setLiveTextMode(initialSettings.liveTextMode);
    setThinBarAlwaysVisible(initialSettings.thinBarAlwaysVisible);
    setFontScale(initialSettings.clientFontScale || 1.0);

    const unsubscribe = syncService.subscribe((msg: SyncMessage) => {
      if (msg.type === 'snapshot') {
        setMap(msg.map);
      } else if (msg.type === 'draft') {
        setDraft(msg.draft.active ? msg.draft : null);
        if (msg.draft.active) {
          setBarVisible(true);
          if (barTimerRef.current) clearTimeout(barTimerRef.current);
          if (!thinBarAlwaysVisible) {
            barTimerRef.current = window.setTimeout(() => {
              setBarVisible(false);
            }, 4000);
          }
        } else {
          if (!thinBarAlwaysVisible) {
            setBarVisible(false);
          }
        }
      } else if (msg.type === 'select') {
        setSelectedNodeId(msg.selection.nodeId);
      } else if (msg.type === 'pause') {
        setIsPaused(msg.paused);
      } else if (msg.type === 'client_font_scale') {
        setFontScale(msg.scale);
      }
    });

    return () => {
      unsubscribe();
      if (barTimerRef.current) clearTimeout(barTimerRef.current);
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    };
  }, [thinBarAlwaysVisible]);

  // Cursor auto-hide logic
  const handleMouseMove = () => {
    setCursorHidden(false);
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    cursorTimerRef.current = window.setTimeout(() => {
      setCursorHidden(true);
    }, 2500);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const isDark = theme === 'noite';

  // Find highlighted path for 3s focus
  const highlightedPath = map && selectedNodeId ? findPathToNode(map.root, selectedNodeId) : null;

  // Compute thin bar label correctly (pointing to actual parent, not grandparent!)
  let thinBarLabel = '';
  if (draft && draft.active && map) {
    if (draft.mode === 'add') {
      const parentName =
        draft.parentText ||
        (draft.parentId === map.root.id
          ? map.root.text
          : (draft.parentId ? findNodeById(map.root, draft.parentId)?.text : map.root.text));
      thinBarLabel = `Adicionando em ${parentName || 'Tópico'} › `;
    } else {
      thinBarLabel = 'Editando › ';
    }
  }

  return (
    <div
      onMouseMove={handleMouseMove}
      className={`relative w-screen h-screen overflow-hidden select-none transition-colors duration-300 ${
        cursorHidden ? 'cursor-none' : 'cursor-default'
      } ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-[#F7F6F2] text-stone-900'}`}
    >
      {/* Calm Pause Screen (RF-43) */}
      {isPaused ? (
        <div
          className={`absolute inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-300 ${
            isDark ? 'bg-slate-950 text-slate-300' : 'bg-[#F7F6F2] text-stone-700'
          }`}
        >
          <div className="relative mb-6">
            <div className="w-16 h-16 rounded-full border-2 border-stone-300 dark:border-slate-700 animate-ping opacity-25" />
            <div className="absolute inset-0 w-16 h-16 rounded-full bg-stone-200 dark:bg-slate-800 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-stone-400 dark:bg-slate-600 animate-pulse" />
            </div>
          </div>
          <h2 className="text-xl font-light tracking-wide mb-1">Um momento</h2>
          <p className="text-xs text-stone-400 dark:text-slate-500">
            A visualização continuará em instantes…
          </p>
        </div>
      ) : map ? (
        <>
          {/* Main SVG MindMap */}
          <MindMapCanvas
            root={map.root}
            draft={draft}
            selectedNodeId={selectedNodeId}
            highlightedPath={highlightedPath}
            theme={theme}
            fontScale={fontScale}
            liveTextMode={liveTextMode}
            readOnly={true}
            clientName={map.clientName}
            sessionDate={map.sessionDate || map.title}
          />

          {/* Floating Bottom Thin Bar (RF-20, RF-21, RF-23) */}
          <div
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 transition-all duration-300 pointer-events-none ${
              (barVisible || thinBarAlwaysVisible) && draft && draft.active
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-4'
            }`}
          >
            <div
              className={`px-5 py-2.5 rounded-2xl shadow-xl border backdrop-blur-md max-w-xl flex items-center gap-2 ${
                isDark
                  ? 'bg-slate-900 border-slate-700 text-slate-100 shadow-slate-950/60'
                  : 'bg-white border-stone-300 text-stone-900 shadow-stone-400/30'
              }`}
            >
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400 shrink-0">
                {thinBarLabel}
              </span>
              <span className="text-sm font-semibold tracking-tight truncate">
                {liveTextMode === 'confirm_only'
                  ? 'digitando…'
                  : (draft?.text || '…')}
              </span>
              {liveTextMode === 'live' && (
                <span className="animate-ping font-mono text-amber-500 text-xs shrink-0">
                  ▌
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
          <span>Aguardando conexão com a sessão do terapeuta…</span>
        </div>
      )}

      {/* Quiet Fullscreen Toggle in Top-Right Corner */}
      <button
        type="button"
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        className="absolute top-3 right-3 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 opacity-30 hover:opacity-100 transition-opacity"
      >
        {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
      </button>
    </div>
  );
};
