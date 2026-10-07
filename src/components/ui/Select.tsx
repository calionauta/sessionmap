import React from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** The visible control; callers keep their own <label htmlFor>. */
  children: React.ReactNode;
  /** Width lane of the wrapper. Full-bleed in forms, shrink-to-fit inline. */
  wrapperClassName?: string;
}

/**
 * The one dropdown in the app.
 *
 * Deliberately a NATIVE select, not a custom listbox: the platform gives us
 * the mobile wheel picker, type-ahead, keyboard operation and screen-reader
 * semantics for free, and a hand-rolled listbox has to re-earn every one of
 * those. What was broken was only the chrome — the OS arrow rendered by
 * `appearance: auto` sat wherever each engine felt like, over our padding.
 * So: `appearance-none` kills the native arrow, a ChevronDown is pinned to
 * the right with `pointer-events-none`, and the caller keeps height/type
 * via className (always with pl-*, never px-*, so nothing fights the
 * arrow's pr-10 lane).
 */
export const Select: React.FC<SelectProps> = ({ children, className = '', wrapperClassName = 'w-full', ...rest }) => {
  return (
    <span className={`relative inline-flex items-center ${wrapperClassName}`}>
      <select
        {...rest}
        className={`w-full appearance-none rounded-control border border-line bg-surface-raised text-content font-medium pr-10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
      >
        {children}
      </select>
      <ChevronDown
        className="w-4 h-4 shrink-0 text-content-muted pointer-events-none absolute right-3"
        aria-hidden="true"
      />
    </span>
  );
};
