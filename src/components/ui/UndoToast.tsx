import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/** How long an undo toast stays up. */
export const UNDO_TOAST_MS = 8000;

interface UndoToastProps {
  message: React.ReactNode;
  undoLabel: string;
  onUndo: () => void;
  dismissLabel: string;
  onDismiss: () => void;
  durationMs?: number;
  className?: string;
}

/**
 * Delete-undo notice, shared by every surface that deletes.
 *
 * Timing follows the toast consensus (Material / NN/g): a plain notice gets
 * ~4s, one carrying an action gets longer so the action stays reachable —
 * 8s here, down from 10s, which read as furniture. The remaining time is
 * visible as a shrinking bar, the countdown pauses while the pointer or
 * focus is inside (the user is reading or reaching for Desfazer), and an
 * explicit close button plus Escape dismiss early. Entry is a short
 * rise-and-fade; reduced-motion users get none of it (see index.css).
 */
export const UndoToast: React.FC<UndoToastProps> = ({
  message,
  undoLabel,
  onUndo,
  dismissLabel,
  onDismiss,
  durationMs = UNDO_TOAST_MS,
  className = '',
}) => {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(durationMs);
  const deadlineRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    deadlineRef.current = Date.now() + remainingRef.current;
    timerRef.current = window.setTimeout(() => {
      onDismissRef.current();
    }, remainingRef.current);
    return clearTimer;
    // Mount-only: pause/resume is handled below by adjusting the same timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPausedState = (next: boolean) => {
    if (next === paused) return;
    if (next) {
      clearTimer();
      remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
      setPaused(true);
    } else {
      deadlineRef.current = Date.now() + remainingRef.current;
      timerRef.current = window.setTimeout(() => {
        onDismissRef.current();
      }, remainingRef.current);
      setPaused(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPausedState(true)}
      onMouseLeave={() => setPausedState(false)}
      onFocus={() => setPausedState(true)}
      onBlur={() => setPausedState(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDismiss();
        }
      }}
      className={`toast-in overflow-hidden rounded-panel bg-surface-raised text-content border border-line shadow-2xl text-xs max-w-[92vw] ${className}`}
    >
      <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-3">
        <span>{message}</span>
        <button type="button" onClick={onUndo} className="ctl ctl-primary px-4">
          {undoLabel}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          title={dismissLabel}
          className="ctl w-9 h-9 !min-h-0 px-0 shrink-0"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <div
        aria-hidden="true"
        className="h-0.5 bg-accent-text/70 toast-progress"
        style={{
          animationDuration: `${durationMs}ms`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </div>
  );
};
