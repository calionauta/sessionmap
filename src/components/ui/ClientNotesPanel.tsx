import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  NotebookPen,
  ChevronUp,
  ChevronDown,
  Check,
  Loader2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { getClientNotes, saveClientNotes } from '../../services/storage';

/**
 * The therapist's private free-text notes for ONE client.
 *
 * Scope is the client, not the session, which is the whole point: these are
 * observations about the person that carry across sessions, so starting a new
 * session must not clear them and archiving the client must not lose them.
 *
 * Placement is deliberate. It sits at the bottom of the outline pane, not in a
 * modal and not in a separate screen, because the use is "glance at what I
 * wrote about this client while my hands keep typing in the outline". A modal
 * would steal focus from the outline; a second pane would steal the width the
 * outline needs. Bottom-of-pane keeps both readable at once, and it collapses
 * so the rows above keep their height.
 *
 * NEVER sent to the client window. The sync channel carries the MindMap and a
 * handful of control messages; the client record — and therefore these notes —
 * is never part of it. Sharing a window must not be able to project the
 * therapist's private notes to the patient.
 */
interface ClientNotesPanelProps {
  /** null when no session is open, so there is no client to scope notes to. */
  clientId: string | null;
  clientName: string;
  /** Lifted to the parent, which hides the outline while this fills the pane. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

type SaveState = 'idle' | 'saving' | 'saved';

export const ClientNotesPanel: React.FC<ClientNotesPanelProps> = ({
  clientId,
  clientName,
  expanded,
  onExpandedChange,
}) => {
  /**
   * Three states, because one boolean could not express what the notes are
   * for.
   *
   * 'collapsed' — just the title strip, outline keeps full height.
   * 'panel'     — textarea docked at the bottom, outline still usable above.
   *              This is the reading-while-typing mode.
   * 'expanded'  — takes the whole outline pane.
   *
   * The expanded state exists because these notes get read at length: a
   * therapist referring back to context has to re-read it while the session is
   * running, and five rows at the bottom is not enough for that. Resizing the
   * outline pane was the tempting answer and the wrong one — that handle is
   * sized for the tree, and dragging it to read a note is a side effect on
   * something unrelated.
   */
  const [modeState, setModeState] = useState<'collapsed' | 'panel' | 'expanded'>(
    'collapsed'
  );
  const mode = modeState;

  // The expanded flag is owned by the parent, which is what hides the outline,
  // so every mode change has to go through it. Accepts a value or an updater
  // so the toggles can read as "flip it" rather than restating the logic.
  const setMode = (
    next:
      | 'collapsed'
      | 'panel'
      | 'expanded'
      | ((prev: 'collapsed' | 'panel' | 'expanded') => 'collapsed' | 'panel' | 'expanded')
  ) => {
    const resolved = typeof next === 'function' ? next(modeState) : next;
    setModeState(resolved);
    onExpandedChange(resolved === 'expanded');
  };
  const [notes, setNotes] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const timerRef = useRef<number | null>(null);
  /** The value a pending debounced write is going to save, per client. */
  const pendingRef = useRef<{ clientId: string; value: string } | null>(null);

  const flush = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await saveClientNotes(pending.clientId, pending.value);
    setState('saved');
  }, []);

  // Load on client change. Keyed on clientId rather than mount-only, or
  // switching clients would show the previous client's private notes under
  // the new client's name.
  useEffect(() => {
    let cancelled = false;

    // Anything typed into the previous client is flushed before switching.
    // Dropping it instead would lose up to a second of the therapist's
    // writing, and there is no server copy to recover it from.
    void flush();

    if (!clientId) {
      setNotes('');
      setLoadedFor(null);
      return;
    }
    setState('idle');
    getClientNotes(clientId).then((loaded) => {
      if (cancelled) return;
      setNotes(loaded);
      setLoadedFor(clientId);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, flush]);

  // Debounced autosave. 600ms turns a sentence into one write instead of one
  // per keystroke, and is short enough that a closed tab loses very little.
  const scheduleSave = useCallback(
    (value: string) => {
      if (!clientId) return;
      pendingRef.current = { clientId, value };
      setState('saving');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, 600);
    },
    [clientId, flush]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const loading = clientId !== null && loadedFor !== clientId;

  return (
    <div
      className={`border-line bg-surface-raised flex flex-col ${
        expanded ? 'flex-1 min-h-0 border-t' : 'shrink-0 border-t'
      }`}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 shrink-0">
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'collapsed' ? 'panel' : 'collapsed'))}
          aria-expanded={mode !== 'collapsed'}
          aria-controls="client-notes-textarea"
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-[11px] font-semibold text-content-muted hover:text-content transition-colors cursor-pointer"
        >
          {mode !== 'collapsed' ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          )}
          <NotebookPen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="shrink-0">Anotações</span>
          <span className="min-w-0 truncate text-content-subtle">
            {clientName}
          </span>
        </button>

        {/* Save state is shown, not assumed: these notes are the therapist's
            only copy and there is no server to fall back on. */}
        <span
          role="status"
          aria-live="polite"
          className="shrink-0 flex items-center gap-1 text-[11px] text-content-muted"
        >
          {state === 'saving' ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              <span className="sr-only">Salvando anotações</span>
            </>
          ) : state === 'saved' ? (
            <>
              <Check className="w-3 h-3 text-positive" aria-hidden="true" />
              <span className="sr-only">Anotações salvas</span>
            </>
          ) : null}
        </span>

        {/* Expand / reduce. Present in both open states: the notes are often
            read at length mid-session, and resizing the outline pane is the
            wrong tool for that — it is a drag handle sized for the tree. */}
        {mode !== 'collapsed' && (
          <button
            type="button"
            onClick={() => setMode((m) => (m === 'expanded' ? 'panel' : 'expanded'))}
            aria-label={expanded ? 'Reduzir anotações' : 'Expandir anotações para todo o espaço'}
            title={expanded ? 'Reduzir' : 'Expandir para todo o espaço'}
            className="ctl w-7 h-7 !min-h-0 px-0 shrink-0"
          >
            {expanded ? (
              <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {mode !== 'collapsed' && (
        /* flex-COL, not bare flex. As a row the textarea and the footnote sat
           side by side, so the textarea took whatever width was left after the
           note and came out squeezed. This was the bug reported on the first
           try at the expanded state. */
        <div
          className={`px-3 pb-3 ${
            expanded ? 'flex-1 min-h-0 flex flex-col' : 'shrink-0'
          }`}
        >
          <label htmlFor="client-notes-textarea" className="sr-only">
            Anotações livres sobre {clientName}. Não aparecem para o cliente.
          </label>
          <textarea
            id="client-notes-textarea"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              scheduleSave(e.target.value);
            }}
            onBlur={() => {
              // Flush immediately: blur is the one moment the user has
              // declared they are done with this text, so it should not race
              // the debounce.
              void flush();
            }}
            rows={5}
            disabled={!clientId || loading}
            placeholder={
              clientId
                ? 'Observações sobre este cliente: contexto, histórico, pontos de atenção. Salvo por cliente, some com as sessões. Não aparece para o cliente.'
                : 'Abra uma sessão para ter um cliente associado.'
            }
            /* Expanded it fills the pane, so resize-none: a manual drag on top
               of a flex-fill box fights the layout and leaves a second,
               conflicting way to size the same thing. */
            className={`w-full rounded-control border border-line bg-surface px-2.5 py-2 text-xs leading-relaxed text-content placeholder:text-content-subtle ${
              expanded ? 'flex-1 min-h-0 resize-none' : 'resize-y'
            }`}
          />
          <p className="mt-1 shrink-0 text-[10px] text-content-subtle">
            Visível só para você. Não é compartilhado com a janela do cliente.
          </p>
        </div>
      )}
    </div>
  );
};
