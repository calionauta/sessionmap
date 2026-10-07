import React from 'react';

/**
 * The one empty-state pattern, everywhere.
 *
 * A placeholder is NOT a button: no dashed border (dashed reads as
 * dropzone/clickable), no click handler on the box — sunken surface, solid
 * hairline, and when there is a next step it is an inline link with the
 * exact behaviour of the far-away button, so nobody has to go looking for
 * where to create. The box itself never fires.
 */
export const EmptyState: React.FC<{
  children: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionAriaLabel?: string;
  className?: string;
}> = ({ children, actionLabel, onAction, actionAriaLabel, className = '' }) => {
  return (
    <div
      className={`p-4 text-center text-xs font-medium text-content-muted bg-surface-sunken border border-line-muted rounded-panel ${className}`}
    >
      <span>{children}</span>
      {actionLabel && onAction ? (
        <>
          {' '}
          <button
            type="button"
            onClick={onAction}
            aria-label={actionAriaLabel ?? actionLabel}
            className="font-bold text-accent-text underline underline-offset-2 hover:no-underline"
          >
            {actionLabel}
          </button>
        </>
      ) : null}
    </div>
  );
};
