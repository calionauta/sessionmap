import React from 'react';
import {
  ChevronDown,
  Cloud,
  Download,
  ExternalLink,
  Layers,
  ListTree,
  Lock,
  Map,
  MonitorUp,
  Minimize2,
  Pause,
  Play,
  Share2,
  Sliders,
  Sun,
  Moon,
  Target,
  Users,
} from 'lucide-react';
import { OverflowMenu, MenuEntry } from './ui/OverflowMenu';

/**
 * The session bar.
 *
 * It was 215 lines of JSX inline in TherapistView, which is the component
 * architecture problem before it is a design one: a view that cannot be read
 * on its own cannot be reviewed on its own, and every piece of state it needed
 * arrived as a prop of a thousand-line parent. It is its own component now, and
 * the bar is three groups with different weights instead of fourteen controls
 * with the same one.
 *
 * THE RULE THE LAYOUT FOLLOWS: one primary action, and it is never ambiguous
 * which one that is. Before, "Janela do Cliente" and the "[Abrir]" link inside
 * the "Cliente Desconectado" pill were the same function wearing two different
 * costumes — a filled primary button on the right and a bracketed text link in
 * the middle — so the thing the app exists to do appeared twice, in two visual
 * languages, at once. The action button now BECOMES the connect action when
 * there is nothing to connect to, and the status beside it is only a status.
 */

export interface TopBarProps {
  clientName: string;
  sessionLabel: string;
  isClientConnected: boolean;
  isPaused: boolean;
  focusZoomOn: boolean;
  isDark: boolean;
  /** The outline is off screen, so the split has to be restorable from here. */
  canRestoreSplit: boolean;
  /**
   * Set only on a narrow window, where two panes cannot both be usable and
   * this button is the whole navigation between them.
   *
   * It lives in the bar rather than in either pane because whichever pane is
   * NOT showing is the one that needs a way back, and a control inside a hidden
   * pane cannot be pressed. The bar is the one surface that is always there.
   */
  narrowPane: 'outline' | 'map' | null;
  /**
   * Cloud backup status. Null while the feature is off — the default
   * offline product shows nothing new. A status pill, never an action
   * disguised as one: it reports, and its click goes to Settings.
   */
  cloud?: {
    label: string;
    hint: string;
    /** 'disabled' never reaches here (the pill is null then); kept so the
        caller passes the status kind straight through without casting. */
    kind: 'ok' | 'locked' | 'error' | 'never' | 'disabled';
  } | null;

  onOpenClients: () => void;
  onOpenClientWindow: () => void;
  /**
   * Bring the client's window to the front.
   *
   * Separate from opening it on purpose. "Janela do Cliente" used to do both,
   * because `window.open` with a named target reuses an existing window — which
   * meant the bar could not stop offering it without quietly taking away the
   * ability to un-minimise a client's screen mid-session. In a therapy session
   * that is a real thing that happens, so the capability is kept; it just does
   * not deserve a permanent control.
   */
  onFocusClientWindow: () => void;
  onTogglePause: () => void;
  onOpenMapList: () => void;
  onToggleFocusZoom: () => void;
  onOpenShareGuide: () => void;
  onOpenExport: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onRestoreSplit: () => void;
  onSwapPane: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  clientName,
  sessionLabel,
  isClientConnected,
  isPaused,
  focusZoomOn,
  isDark,
  canRestoreSplit,
  onOpenClients,
  onOpenClientWindow,
  onFocusClientWindow,
  onTogglePause,
  onOpenMapList,
  onToggleFocusZoom,
  onOpenShareGuide,
  onOpenExport,
  onToggleTheme,
  onOpenSettings,
  onRestoreSplit,
  narrowPane,
  onSwapPane,
  cloud = null,
}) => {
  /**
   * The one control that both reports the connection and acts on it.
   *
   * Disconnected, the action the therapist needs every single session is
   * "conectar", so that is what the button says and the only primary fill in
   * the bar. Connected, the same button becomes the pause toggle. Connection
   * and pause stay two separate pieces of state — merging them into one control
   * would have meant a button whose label changed meaning, which is worse than
   * two controls.
   */
  const disconnected = !isClientConnected;
  const actionLabel = disconnected
    ? 'Conectar cliente'
    : isPaused
      ? 'Retomar tela'
      : 'Pausar tela';
  const ActionIcon = disconnected ? ExternalLink : isPaused ? Play : Pause;

  // Preferences are states, so they are checkbox items. A toggle that looks
  // like a button in a menu is a toggle the reader has to guess at.
  const entries: MenuEntry[] = [];

  /* Focing the client's window only means something while there is one. It sits
     in the menu rather than in the bar because it is a recovery action, not a
     mode — and losing it is exactly what happened when the connect button took
     over the primary slot. */
  if (isClientConnected) {
    entries.push({
      key: 'focusClient',
      label: 'Trazer a tela do cliente para a frente',
      icon: <MonitorUp className="w-3.5 h-3.5" />,
      onSelect: onFocusClientWindow,
    });
  }

  entries.push(
    {
      key: 'maps',
      label: 'Mapas e sessões',
      icon: <Layers className="w-3.5 h-3.5" />,
      onSelect: onOpenMapList,
    },
    {
      key: 'zoom',
      label: 'Zoom no foco',
      icon: <Target className="w-3.5 h-3.5" />,
      onSelect: onToggleFocusZoom,
      checked: focusZoomOn,
    },
    {
      key: 'share',
      label: 'Guia de compartilhamento',
      icon: <Share2 className="w-3.5 h-3.5" />,
      onSelect: onOpenShareGuide,
    },
    {
      key: 'settings',
      label: 'Configurações',
      icon: <Sliders className="w-3.5 h-3.5" />,
      onSelect: onOpenSettings,
    },
    {
      key: 'theme',
      label: isDark ? 'Tema claro' : 'Tema escuro',
      icon: isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />,
      onSelect: onToggleTheme,
    }
  );

  /* Restoring the split lives in the menu rather than in the bar, and the
     condition is unchanged: the outline's own expand button cannot bring back a
     pane that is not on screen. One condition, one control — just a quieter
     one. */
  if (canRestoreSplit) {
    entries.push({
      key: 'split',
      label: 'Restaurar a divisão com os tópicos',
      icon: <Minimize2 className="w-3.5 h-3.5" />,
      onSelect: onRestoreSplit,
    });
  }

  return (
    <header className="h-14 px-4 sm:px-5 flex items-center justify-between gap-3 border-b border-line bg-surface-raised z-20 shrink-0">
      {/* IDENTITY — who and what. Left, and the only group that grows. */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-base font-black tracking-tight text-content">SessionMap</span>
          <div className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
          {/* The privacy note was a 90px badge that said the same thing on every
              screen, forever. It is a fact about the app, not a state, so it
              belongs on the wordmark — and the claim is true: the two windows
              talk over a BroadcastChannel and localStorage, and nothing here
              opens a socket.

              role="img" with a label, not a bare aria-label on the svg. The
              badge had visible text, so dropping it for an unlabelled glyph
              would have taken the fact away from anyone not looking at the
              mouse. */}
          <span
            role="img"
            aria-label="Privado: nada é enviado para fora deste navegador"
            title="Tudo fica neste navegador. Nada é enviado para lugar nenhum."
            className="shrink-0"
          >
            <Lock className="w-3 h-3 text-content-subtle" aria-hidden="true" />
          </span>
        </div>

        <div className="h-4 w-px bg-line shrink-0" aria-hidden="true" />

        {/* The one control that says where you are. It was styled like the other
            thirteen; it is the app's home, so it is the one that truncates and
            the one that keeps its label when space runs short. */}
        <button
          type="button"
          onClick={onOpenClients}
          title="Gerenciar clientes e sessões"
          aria-label="Gerenciar clientes e sessões"
          className="ctl !min-h-0 h-9 px-2.5 sm:px-3 !gap-2 text-xs font-semibold min-w-0"
        >
          <Users className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden="true" />
          <span className="font-bold text-content truncate">{clientName}</span>
          <span aria-hidden="true" className="text-content-subtle shrink-0">
            ·
          </span>
          <span className="font-mono text-[11px] font-medium text-content-muted truncate hidden sm:inline">
            {sessionLabel}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-content-muted shrink-0" aria-hidden="true" />
        </button>
      </div>

      {/* SESSION — the loop the therapist is actually in. Right, fixed width,
          so it never drifts away from the actions it belongs with. */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Cloud backup status. Hidden below md: the client pill already
            hides below lg, and two pills plus actions do not fit a phone.
            The footer badge stays reachable everywhere regardless. */}
        {cloud && (
          <button
            type="button"
            onClick={onOpenSettings}
            title={cloud.hint}
            aria-label={`Backup em nuvem: ${cloud.label}. Abrir configurações.`}
            className="hidden md:flex items-center gap-2 h-9 px-3 rounded-lg bg-surface-inset border border-line text-xs font-semibold text-content hover:border-line-muted cursor-pointer"
          >
            <Cloud className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden="true" />
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                cloud.kind === 'ok'
                  ? 'bg-positive'
                  : cloud.kind === 'error'
                    ? 'bg-negative'
                    : cloud.kind === 'locked'
                      ? 'bg-caution'
                      : 'bg-content-subtle'
              }`}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap">{cloud.label}</span>
          </button>
        )}
        {/* Status only. It was on `hidden lg:flex`, which meant that below 1024px
            the therapist could not pause the client's screen at all except by
            remembering Ctrl+.. The pill may still hide — it is supplementary —
            but the ACTION below never does. */}
        <div
          role="status"
          className="hidden lg:flex items-center gap-2 h-9 px-3 rounded-lg bg-surface-inset border border-line text-xs font-semibold text-content"
        >
          <span
            data-state-dot=""
            className={`w-2 h-2 rounded-full ${
              isPaused ? 'bg-negative' : isClientConnected ? 'bg-positive animate-pulse' : 'bg-caution'
            }`}
          />
          <span>
            {isPaused ? 'Cliente em pausa' : isClientConnected ? 'Cliente conectado' : 'Cliente desconectado'}
          </span>
        </div>

        {/* The narrow-window pane switch. Before it: a 375px screen showed a
            142px outline beside a 233px map, and a 44px splitter across the
            middle of it. The bar is the only surface that is on screen in both
            states, which is why the switch lives here and not in a pane. */}
        {narrowPane && (
          <button
            type="button"
            onClick={onSwapPane}
            title={narrowPane === 'outline' ? 'Ver o mapa' : 'Ver os tópicos'}
            aria-label={narrowPane === 'outline' ? 'Ver o mapa da sessão' : 'Ver os tópicos da sessão'}
            className="ctl w-9 h-9 !min-h-0 px-0"
          >
            {narrowPane === 'outline' ? (
              <Map className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ListTree className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={disconnected ? onOpenClientWindow : onTogglePause}
          title={
            disconnected
              ? 'Abrir a janela do cliente (Conexão)'
              : isPaused
                ? 'Retomar a tela do cliente (Ctrl+.)'
                : 'Pausar a tela do cliente (Ctrl+.)'
          }
          className={`ctl !min-h-0 h-9 px-2.5 sm:px-3 text-xs font-bold ${
            disconnected ? 'ctl-primary' : ''
          }`}
        >
          <ActionIcon
            className={`w-3.5 h-3.5 shrink-0 ${disconnected ? '' : 'fill-current'}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">{actionLabel}</span>
          <span className="sr-only sm:hidden">{actionLabel}</span>
        </button>

        <div className="h-5 w-px bg-line hidden sm:block" aria-hidden="true" />

        {/* Export stayed in the bar and everything else moved. It is the one
            secondary action a therapist reaches for every session, it already has
            a shortcut, and hiding it would have been a downgrade dressed as a
            tidy-up. */}
        <button
          type="button"
          onClick={onOpenExport}
          title="Exportar mapa (Ctrl+E)"
          aria-label="Exportar mapa"
          className="ctl w-9 h-9 !min-h-0 px-0"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
        </button>

        <OverflowMenu entries={entries} label="Mais ferramentas" />
      </div>
    </header>
  );
};
