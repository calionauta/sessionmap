import React, { useCallback, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Shared overlay shell.
 *
 * Before this existed, five overlays each reimplemented their own
 * backdrop, header and close button with three different backdrop
 * opacities, five max-widths, two dark surfaces and four close-button
 * variants — and none of them handled Escape, focus trapping, focus
 * restore or the dialog role. Centralising it fixes SC 2.1.2, 2.4.3
 * and 4.1.2 once for all five.
 *
 * Content is passed as children; callers keep full control of layout
 * inside the body and footer slots.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The dialog behaviour every overlay needs: Escape to dismiss, Tab cycled
 * inside the panel, focus moved in on open, background scroll locked, and
 * focus handed back to the trigger on close.
 *
 * Extracted because MapListDrawer — a side panel, so it cannot use Modal's
 * centred layout — had grown its own byte-for-byte copy of this logic. The
 * two copies had already drifted (different selectors, different "no
 * focusable child" behaviour), which is exactly the failure mode of having
 * two sources of truth. Both overlays now call this.
 */
export function useDialogA11y(
  panelRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void
) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Stop here: the app binds Ctrl-key shortcuts globally, and a dialog
        // that let Escape keep travelling would close a panel behind it.
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null);
      if (nodes.length === 0) {
        // Nothing to move to; keep focus on the panel itself.
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose, panelRef]
  );

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog: the panel itself when it holds no focusable
    // child, otherwise the first control.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    });

    // Lock background scroll while the overlay owns the viewport.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      // Focus returns to whatever opened the dialog (SC 2.4.3).
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, panelRef]);

  return onKeyDown;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Secondary line under the title. */
  description?: string;
  /** Decorative leading glyph, hidden from assistive tech. */
  icon?: React.ReactNode;
  maxWidth?: string;
  /** Dismiss on backdrop click. Off for destructive confirmations. */
  dismissOnBackdrop?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  icon,
  maxWidth = 'max-w-lg',
  dismissOnBackdrop = true,
  children,
  footer,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // Escape, focus trap, focus move-in/restore and scroll lock all live in the
  // shared hook so this component holds no copy of them.
  const onKeyDown = useDialogA11y(panelRef, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`w-full ${maxWidth} max-h-[90vh] rounded-panel bg-surface-raised text-content border border-line shadow-2xl overflow-hidden flex flex-col focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-line shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            {icon ? (
              <span className="mt-0.5 text-accent-text" aria-hidden="true">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-extrabold text-content">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="text-xs text-content-muted font-medium">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Fechar ${title}`}
            className="ctl w-9 h-9 !min-h-0 px-0 shrink-0"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">{children}</div>

        {footer ? (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-line bg-surface shrink-0">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
}

/**
 * Replaces window.confirm(). A native confirm cannot be styled, is
 * announced inconsistently, and offers no undo — unacceptable for
 * irreversible deletion of clinical records. The parent is expected
 * to offer an undo window after confirming.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  isDestructive = false,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onCancel}
    title={title}
    maxWidth="max-w-md"
    dismissOnBackdrop={false}
    footer={
      <>
        <button type="button" onClick={onCancel} className="ctl">
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={isDestructive ? 'ctl ctl-danger' : 'ctl ctl-primary'}
        >
          {confirmLabel}
        </button>
      </>
    }
  >
    <div className="text-sm text-content-muted">{description}</div>
  </Modal>
);
