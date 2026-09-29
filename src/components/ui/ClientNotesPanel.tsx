import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NotebookPen, ChevronUp, ChevronDown, Check, Loader2 } from 'lucide-react';
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
}

type SaveState = 'idle' | 'saving' | 'saved';

export const ClientNotesPanel: React.FC<ClientNotesPanelProps> = ({
  clientId,
  clientName,
}) => {
  const [open, setOpen] = useState(false);
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
    <div className="shrink-0 border-t border-line bg-surface-raised flex flex-col">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="client-notes-textarea"
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-[11px] font-semibold text-content-muted hover:text-content transition-colors cursor-pointer"
        >
          {open ? (
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
      </div>

      {open && (
        <div className="px-3 pb-3">
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
            className="w-full resize-y rounded-control border border-line bg-surface px-2.5 py-2 text-xs leading-relaxed text-content placeholder:text-content-subtle"
          />
          <p className="mt-1 text-[10px] text-content-subtle">
            Visível só para você. Não é compartilhado com a janela do cliente.
          </p>
        </div>
      )}
    </div>
  );
};
