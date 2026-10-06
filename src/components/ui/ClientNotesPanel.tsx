import React, { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/strings';
import { useLang } from '../../i18n/LanguageContext';
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
 * The host's private free-text notes for ONE client.
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
 * host's private notes to the patient.
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
  const lang = useLang();
  /**
   * Three states, because one boolean could not express what the notes are
   * for.
   *
   * 'collapsed' — just the title strip, outline keeps full height.
   * 'panel'     — takes HALF the pane; the outline keeps the other half.
   *              This is the reading-while-typing mode, and half is what makes
   *              it one: a strip five rows tall is a peep, not a read.
   * 'expanded'  — takes the whole outline pane.
   *
   * The expanded state exists because these notes get read at length: a
   * host referring back to context has to re-read it while the session is
   * running, and five rows at the bottom is not enough for that. Resizing the
   * outline pane was the tempting answer and the wrong one — that handle is
   * sized for the tree, and dragging it to read a note is a side effect on
   * something unrelated.
   */
  const [modeState, setModeState] = useState<'collapsed' | 'panel' | 'expanded'>(
    'collapsed'
  );
  const mode = modeState;

  /**
   * Whether this panel is the full-height one.
   *
   * Read from `mode`, never from the `expanded` PROP. The prop exists only to
   * tell the parent to hide the outline; the panel's own size is `mode`'s
   * business. Branching the layout on both meant a state and a prop that could
   * disagree, and when they did the panel rendered the collapsed sizing while
   * the parent had already hidden the outline — a strip of textarea under an
   * empty pane. Two sources of truth for one thing is the bug; this makes the
   * prop mean only what it says.
   */
  const isExpanded = mode === 'expanded';

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
    // Dropping it instead would lose up to a second of the host's
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
      /* 'panel' takes HALF the pane's height and the outline keeps the other
         half. It used to be `shrink-0` around a rows={5} textarea, so "open"
         meant a fixed five lines — about a fifth of a laptop screen, whatever
         the window was. Half is the point of the middle state: the notes are
         read at length and written between thoughts, and a strip you have to
         drag to resize is a second, conflicting way to size the same thing.
         `shrink-0` with `basis-1/2` is what holds the half against the
         outline's `flex-1` above it. */
      className={`border-line bg-surface-raised flex flex-col border-t ${
        isExpanded
          ? 'flex-1 min-h-0'
          : mode === 'panel'
            ? 'basis-1/2 min-h-0 shrink-0'
            : 'shrink-0'
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
          <span className="shrink-0">{t(lang, 'notes.title')}</span>
          <span className="min-w-0 truncate text-content-subtle">
            {clientName}
          </span>
        </button>

        {/* Save state is shown, not assumed: these notes are the host's
            only copy and there is no server to fall back on. */}
        <span
          role="status"
          aria-live="polite"
          className="shrink-0 flex items-center gap-1 text-[11px] text-content-muted"
        >
          {state === 'saving' ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              <span className="sr-only">{t(lang, 'notes.saving')}</span>
            </>
          ) : state === 'saved' ? (
            <>
              <Check className="w-3 h-3 text-positive" aria-hidden="true" />
              <span className="sr-only">{t(lang, 'notes.saved')}</span>
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
            aria-label={isExpanded ? t(lang, 'notes.collapse') : t(lang, 'notes.expand')}
            title={isExpanded ? t(lang, 'notes.collapseShort') : t(lang, 'notes.expandShort')}
            className="ctl w-7 h-7 !min-h-0 px-0 shrink-0"
          >
            {isExpanded ? (
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
            isExpanded || mode === 'panel'
              ? 'flex-1 min-h-0 flex flex-col'
              : 'shrink-0'
          }`}
        >
          <label htmlFor="client-notes-textarea" className="sr-only">
            {t(lang, 'notes.label').replace('{name}', clientName)}
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
            rows={3}
            disabled={!clientId || loading}
            placeholder={
              clientId
                ? t(lang, 'notes.placeholderClient')
                : t(lang, 'notes.placeholderNone')
            }
            /* Both open states fill the box they are given, so resize-none: a
               manual drag on top of a flex-fill box fights the layout and
               leaves a second, conflicting way to size the same thing. rows is
               only a floor for the collapsed state, which sizes to content. */
            className={`w-full rounded-control border border-line bg-surface px-2.5 py-2 text-xs leading-relaxed text-content placeholder:text-content-subtle ${
              isExpanded || mode === 'panel' ? 'flex-1 min-h-0 resize-none' : 'resize-y'
            }`}
          />
          <p className="mt-1 shrink-0 text-[10px] text-content-subtle">
            {t(lang, 'notes.footnote')}
          </p>
        </div>
      )}
    </div>
  );
};
