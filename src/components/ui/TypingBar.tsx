import React from 'react';
import { t } from '../../i18n/strings';
import { useLang } from '../../i18n/LanguageContext';

/**
 * The bar that says what the host is typing right now.
 *
 * ONE component, shown in both windows. The host's copy and the client's
 * copy were separate implementations of the same sentence, which is the only
 * way they can disagree — and they did: the host's version keyed off
 * "is the edited node on screen" and flickered on every keystroke, while the
 * client's keyed off an idle timer and sat still. Same words, same bar, two
 * behaviours. There is now one.
 *
 * The label is computed by the caller because the parent is a different thing
 * in each window: on the client it is a name resolved from a mirrored tree, in
 * the host's window it is the same name straight from the caret.
 */

interface TypingBarProps {
  /** "Adicionando em X ›" or "Editando ›". Empty hides the prefix. */
  label: string;
  /** The text being typed. */
  text: string;
  visible: boolean;
  /**
   * 'live' streams the words; 'confirm_only' says only that something is being
   * typed. The setting exists because some clients read the whole sentence off
   * the screen as it is written, which is not what a session is for.
   */
  liveTextMode: 'live' | 'confirm_only';
  className?: string;
}

export const TypingBar: React.FC<TypingBarProps> = ({
  label,
  text,
  visible,
  liveTextMode,
  className = '',
}) => {
  const lang = useLang();
  return (
  /* Edge-anchored band with a 1rem gutter and a centred max-width, so its width
     is min(100% - 2rem, 36rem) at every viewport — fluid, not a breakpoint. It
     was `fixed bottom-6 left-1/2` with a `shrink-0` label, which at 375px could
     be wider than the window with a label that could never shrink, so the two
     spans overlapped. Below `sm` the label and the draft stack instead of
     competing for one 16px-tall line. */
  /* Deliberately NOT aria-hidden when hidden. Toggling aria-hidden on a live
     region makes its announcement behaviour undefined: content that changes
     while the region is hidden is not announced, and the un-hide races the
     announcement. The region stays in the tree and the visual hiding is done
     with opacity/transform, which a screen reader correctly ignores. */
  <div
    role="status"
    aria-live="polite"
    className={`pointer-events-none absolute inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-all duration-300 ${
      visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
    } ${className}`}
  >
    <div className="mx-auto flex max-w-xl flex-col gap-0.5 rounded-panel border border-line bg-surface-raised px-4 py-2.5 text-content shadow-xl backdrop-blur-md sm:flex-row sm:items-center sm:gap-2">
      <span className="min-w-0 shrink truncate text-xs font-bold text-accent-text">
        {label}
      </span>
      {/* The draft wraps to at most two lines when narrow and is clamped back to
          one line from `sm` up. `line-clamp-*` rather than `sm:truncate` so both
          states share the same display (-webkit-box) and the ellipsis actually
          renders. `min-w-0` is what lets the clamp engage inside a flex row. */}
      <div className="flex w-full min-w-0 items-baseline gap-1 sm:w-auto sm:flex-1">
        <span className="min-w-0 line-clamp-2 text-sm font-semibold tracking-tight sm:line-clamp-1">
          {liveTextMode === 'confirm_only' ? t(lang, 'typing.ellipsis') : text || '…'}
        </span>
        {liveTextMode === 'live' && (
          <span aria-hidden="true" className="shrink-0 animate-ping font-mono text-accent-text text-xs">
            ▌
          </span>
        )}
      </div>
    </div>
  </div>
  );
};
