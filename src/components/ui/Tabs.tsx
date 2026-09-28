import React, { useRef } from 'react';

/**
 * Tab list with real tab semantics.
 *
 * The platform tabs (and the seven export-format tabs) were previously
 * plain buttons: no role, no selection state, no arrow-key movement and
 * no tabpanel association (SC 1.3.1 / 4.1.2).
 */

const KEY_ORDER = ['ArrowRight', 'ArrowLeft', 'Home', 'End'] as const;

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string> {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Extra classes for the list container. */
  className?: string;
  /** Stretch options evenly across the width. */
  stretch?: boolean;
  idPrefix: string;
  /**
   * False when the caller renders TabPanel only for the active tab, which is
   * what both dialogs do. aria-controls MUST NOT point at an id that is not in
   * the DOM: a dangling reference is an axe aria-valid-attr-value failure, and
   * it is a worse outcome than the plain buttons this component replaced.
   */
  panelsAlwaysMounted?: boolean;
}

export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  className = '',
  stretch = false,
  idPrefix,
  panelsAlwaysMounted = false,
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!KEY_ORDER.includes(e.key as (typeof KEY_ORDER)[number])) return;
    e.preventDefault();

    const current = items.findIndex((i) => i.value === value);
    let next = current;
    if (e.key === 'ArrowRight') next = (current + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;

    onChange(items[next].value);
    // Move focus with the selection, per the WAI-ARIA tabs pattern.
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        [next]?.focus();
    });
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex items-center gap-1 p-1 bg-surface-inset rounded-xl ${className}`}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            id={`${idPrefix}-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={
              panelsAlwaysMounted ? `${idPrefix}-panel-${item.value}` : undefined
            }
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={`${
              stretch ? 'flex-1' : ''
            } py-1.5 px-3 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              selected
                ? 'bg-surface-raised text-content shadow-xs'
                : 'text-content-muted hover:text-content'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

interface TabPanelProps {
  id: string;
  labelledBy: string;
  children: React.ReactNode;
  className?: string;
}

export function TabPanel({ id, labelledBy, children, className = '' }: TabPanelProps) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex={0}
      className={`focus:outline-none ${className}`}
    >
      {children}
    </div>
  );
}
