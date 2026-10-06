import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MindMap, SyncMessage } from '../types';
import { MindMapCanvas } from './mindmap/MindMapCanvas';
import { syncService } from '../services/sync';
import { getCachedActiveMap, getSettings } from '../services/storage';
import { Maximize, Minimize } from 'lucide-react';
import { TypingBar } from './ui/TypingBar';
import { findPathToNode, findNodeById } from '../utils/tree';

const CURSOR_IDLE_MS = 2500;
const BAR_IDLE_MS = 4000;

/**
 * Client window.
 *
 * This is the surface a client actually looks at — often while in distress,
 * often projected or on a video call. Two rules therefore hold everywhere
 * below:
 *
 *  1. Contrast. No raw palette colours and no opacity tricks. Every text pair
 *     is a semantic token measured at >= 4.5:1 and every non-text indicator at
 *     >= 3:1, in BOTH themes:
 *       text-content          #1e293b / #e2e8f0  13.5:1 · 15.6:1 on surface
 *       text-content-muted    #475569 / #94a3b8   7.0:1 ·  7.5:1 on surface
 *       text-accent-text      #b45309 / #fbbf24   5.0:1 · 11.1:1 on raised
 *       border-line           #64748b / #64748b   4.8:1 ·  4.0:1 on surface
 *     The old values (text-slate-400, text-stone-400, dark:text-slate-500,
 *     text-amber-600, text-amber-500, border-stone-300, the fullscreen
 *     button at opacity-30) sat at 1.38:1–4.24:1.
 *
 *  2. Never take the pointer away. The cursor auto-hide is opt-out by
 *     construction: it only runs where there is a real fine pointer AND the
 *     user has not asked for reduced motion. On a touchscreen, with a stylus,
 *     on a remote desktop, or with reduced motion set, the cursor is left
 *     alone entirely — a tremor or low vision must not be able to lose the
 *     pointer.
 *
 *  3. Fit the device it is projected from. This window is opened on a
 *     phone, a tablet, a projector and a laptop, so nothing here is sized in
 *     viewport pixels: the shell is `fixed inset-x-0 top-0 h-dvh`, the thin
 *     bar is an edge-anchored band with a 1rem gutter and a centred
 *     max-width, and the two message screens use a capped measure so text
 *     wraps instead of clipping. The only breakpoint used is Tailwind's `sm`
 *     on the thin bar, to stack the label above the draft. No `@media` block
 *     is hand-written and `index.css` is not touched.
 *
 * The two `isDark ? … : …` ternaries that used to paint this window are
 * gone: the `.dark` class on <html> re-points the tokens, so the theme has
 * exactly one source of truth. document.title stays the neutral "Mapa"
 * (RF-40 / RF-42) — no client name ever reaches this window's chrome.
 */
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
  const [fontScale, setFontScale] = useState<number>(1.0);
  const [theme, setTheme] = useState<'papel' | 'noite'>('papel');
  const [liveTextMode, setLiveTextMode] = useState<'live' | 'confirm_only'>('live');
  const [focusZoomMode, setFocusZoomMode] = useState<boolean>(false);
  const [thinBarAlwaysVisible, setThinBarAlwaysVisible] = useState<boolean>(false);

  // Auto-hide bottom bar after 4s idle
  const [barVisible, setBarVisible] = useState<boolean>(false);
  const barTimerRef = useRef<number | null>(null);

  // Auto-hide mouse cursor after 2.5s idle
  const [cursorHidden, setCursorHidden] = useState<boolean>(false);
  const cursorTimerRef = useRef<number | null>(null);
  const cursorAutoHideRef = useRef<boolean>(false);

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
    // The client window is the larger of the two displays — it is projected,
    // and read by someone who does not have the outline in front of them. It
    // therefore follows the host's focus-zoom setting instead of silently
    // using the component's `false` default: the setting exists precisely so
    // the point being discussed is the biggest thing on the shared screen.
    setFocusZoomMode(initialSettings.focusZoomMode);

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
            }, BAR_IDLE_MS);
          }
        } else {
          if (!thinBarAlwaysVisible) {
            setBarVisible(false);
          }
        }
      } else if (msg.type === 'select') {
        setSelectedNodeId(msg.selection.nodeId);
      } else if (msg.type === 'client_font_scale') {
        setFontScale(msg.scale);
      } else if (msg.type === 'focus_zoom_mode') {
        // Live, so toggling the setting while the client window is open takes
        // effect there immediately instead of on the next reload.
        setFocusZoomMode(msg.enabled);
      }
    });

    return () => {
      unsubscribe();
      if (barTimerRef.current) clearTimeout(barTimerRef.current);
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    };
  }, [thinBarAlwaysVisible]);

  // The cursor may only be hidden where hiding it is safe: a real fine
  // pointer, and no reduced-motion preference. Both are live queries — a
  // user can plug in a mouse or turn the OS setting on mid-session.
  const [cursorAutoHide, setCursorAutoHide] = useState<boolean>(false);
  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setCursorAutoHide(fine.matches && !reduceMotion.matches);
    sync();
    fine.addEventListener('change', sync);
    reduceMotion.addEventListener('change', sync);
    return () => {
      fine.removeEventListener('change', sync);
      reduceMotion.removeEventListener('change', sync);
    };
  }, []);

  // When auto-hide is not allowed, the pointer is never taken away.
  useEffect(() => {
    cursorAutoHideRef.current = cursorAutoHide;
    if (cursorAutoHide) return;
    setCursorHidden(false);
    if (cursorTimerRef.current) {
      clearTimeout(cursorTimerRef.current);
      cursorTimerRef.current = null;
    }
  }, [cursorAutoHide]);

  const revealCursor = useCallback(() => {
    setCursorHidden(false);
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    if (!cursorAutoHideRef.current) return;
    cursorTimerRef.current = window.setTimeout(() => {
      setCursorHidden(true);
    }, CURSOR_IDLE_MS);
  }, []);

  // Any interaction at all brings the pointer back — movement is not the
  // only way someone discovers it is gone.
  useEffect(() => {
    if (!cursorAutoHide) return;
    const wake = () => revealCursor();
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('wheel', wake, { passive: true });
    return () => {
      window.removeEventListener('keydown', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('wheel', wake);
    };
  }, [cursorAutoHide, revealCursor]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

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

  const showThinBar = (barVisible || thinBarAlwaysVisible) && !!draft?.active;

  return (
    /* `fixed inset-x-0 top-0 h-dvh`, not `w-screen h-screen`:
       - `w-screen` is 100vw, which counts the classic vertical scrollbar
         and is the one thing that can put a horizontal scrollbar on a
         window that is supposed to be a picture, not a document.
       - `h-screen` is 100vh, which on a phone is the viewport *with the
         browser chrome hidden*, so the bottom of the map sits under the
         URL bar. `h-dvh` tracks the visible viewport.
       Both are viewport-unit fixes, not breakpoints — no media query. */
    <div
      onMouseMove={revealCursor}
      className={`no-select fixed inset-x-0 top-0 h-dvh overflow-hidden transition-colors duration-300 ${
        cursorHidden ? 'cursor-none' : 'cursor-default'
      } bg-surface text-content`}
    >
      {/* Calm Pause Screen (RF-43) */}
      {map ? (
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
            focusZoomMode={focusZoomMode}
          />

          <TypingBar
            label={thinBarLabel}
            text={draft?.text ?? ''}
            visible={showThinBar}
            liveTextMode={liveTextMode}
          />
        </>
      ) : (
        <div
          role="status"
          className="flex h-full flex-col items-center justify-center px-8 text-center text-sm text-content-muted"
        >
          <h1 className="text-balance max-w-xs text-base font-medium tracking-tight">
            Aguardando conexão com a sessão do anfitrião…
          </h1>
        </div>
      )}

      {/* Fullscreen Toggle in Top-Right Corner.
          The only control on this window, so it has to be readable without
          hover: text-content-muted is 7.0:1 / 7.5:1 (was 1.43:1 at
          opacity-30), and it carries an accessible name of its own.
          Hit area is the full 44x44 (`min-w-touch min-h-touch`); the inset
          adds `env(safe-area-inset-*)` so it clears a notch in landscape on
          a phone instead of hiding under it. */}
      <button
        type="button"
        onClick={toggleFullscreen}
        onPointerEnter={revealCursor}
        title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        className="absolute right-[calc(0.75rem+env(safe-area-inset-right))] top-[calc(0.75rem+env(safe-area-inset-top))] grid min-h-touch min-w-touch place-items-center rounded-control text-content-muted transition-colors hover:bg-surface-inset hover:text-content"
      >
        {isFullscreen ? (
          <Minimize className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Maximize className="w-4 h-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
};
