import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * The "everything else" menu.
 *
 * The top bar had fourteen controls in it and every one of them was permanent,
 * which is a bar that can only get worse: the next feature adds a fifteenth
 * button rather than an entry here, and the ones already there compete for
 * attention they did not ask for. A menu gives the bar a floor.
 *
 * What earns a place OUTSIDE it is decided by the caller, not here. The rule
 * this component can enforce is the accessible one, which is that a control
 * which only opens a menu says so: `aria-haspopup` and `aria-expanded` on the
 * trigger, `role="menu"` on the panel, and arrow keys that actually move
 * between the items. A `role="menu"` that only responds to Tab promises
 * something it does not deliver, and screen readers then announce a widget
 * that behaves unlike every other menu on the platform.
 */

export interface MenuEntry {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  /** Rendered as a checkbox item when present, so a preference reads as a state. */
  checked?: boolean;
  /** A preference that is currently on; shown as a hint next to the label. */
  hint?: string;
}

interface OverflowMenuProps {
  entries: MenuEntry[];
  /** The accessible name of the trigger, e.g. "Mais ferramentas". */
  label: string;
}

export const OverflowMenu: React.FC<OverflowMenuProps> = ({ entries, label }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** Where the keyboard is, as an index into `entries`. -1 means nowhere yet. */
  const [cursor, setCursor] = useState(-1);
  const panelId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setCursor(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Escape closes, and only from inside the menu. Bound on the panel rather
  // than on window so it does not fight the app's own global shortcuts, and so
  // Escape with the menu closed does nothing at all — the session outline keeps
  // its Escape.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };
    const panel = panelRef.current;
    panel?.addEventListener('keydown', onKeyDown);
    return () => panel?.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // A pointerdown anywhere else closes. Capture phase, because a click that
  // lands on another control fires that control's own handler first, and
  // without capture the menu would still be open underneath the new dialog.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, close]);

  /**
   * Roving focus, with the index computed in exactly ONE place.
   *
   * The first version computed the next index twice — once in the key handler
   * to move focus, once in the reducer to track state — and the two disagreed,
   * so ArrowDown moved the highlight without moving the focus. React state is
   * the record of where the cursor is; the effect below is the only thing that
   * touches the DOM.
   */
  const stepCursor = (delta: number) => {
    setCursor((c) => {
      const from = c < 0 ? (delta > 0 ? 0 : entries.length - 1) : c;
      return (from + delta + entries.length) % entries.length;
    });
  };

  useEffect(() => {
    if (!open || cursor < 0) return;
    const items = panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    items?.[cursor]?.focus();
  }, [open, cursor]);

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepCursor(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepCursor(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setCursor(entries.length - 1);
    } else if (e.key === 'Tab') {
      // Tabbing out of a menu is how people leave menus. Trapping it would make
      // the bar unreachable by keyboard, which is a worse bug than the crowding
      // this component exists to fix.
      close(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        title={label}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="ctl w-9 h-9 !min-h-0 px-0"
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKeyDown}
          className="absolute right-0 top-full mt-1 z-50 min-w-[15rem] rounded-panel border border-line bg-surface-raised p-1 shadow-lg"
        >
          {entries.map((entry, i) => (
            <button
              key={entry.key}
              type="button"
              role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={entry.checked}
              tabIndex={i === cursor || (cursor === -1 && i === 0) ? 0 : -1}
              onClick={() => {
                close(true);
                entry.onSelect();
              }}
              className="w-full flex items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-xs font-medium text-content hover:bg-surface-inset focus:bg-surface-inset focus:outline-none cursor-pointer"
            >
              {entry.icon && (
                <span className="shrink-0 text-content-muted" aria-hidden="true">
                  {entry.icon}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.hint && (
                <span className="shrink-0 text-[10px] text-content-subtle font-mono">
                  {entry.hint}
                </span>
              )}
              {entry.checked && (
                <span className="shrink-0 text-accent-text font-bold" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
