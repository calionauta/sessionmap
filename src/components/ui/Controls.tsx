import React from 'react';

/**
 * Accessible control primitives shared across the app.
 *
 * Each segmented control group was previously a bare pair of <button>
 * with no programmatic state, so a screen reader announced five
 * identical buttons with no indication of which was selected (SC 4.1.2
 * / 1.4.1). These wrap the same visual treatment in real radiogroup and
 * switch semantics.
 */

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string | number> {
  /** Names the group for assistive tech. */
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center p-1 bg-surface-inset rounded-xl border border-line shrink-0"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              selected
                ? 'bg-accent text-content-onaccent shadow-xs'
                : 'text-content-muted hover:text-content'
            }`}
          >
            {opt.icon ? (
              <span aria-hidden="true" className="inline-flex">
                {opt.icon}
              </span>
            ) : null}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 shrink-0 rounded-full transition-colors cursor-pointer ${
        checked ? 'bg-accent' : 'bg-surface-inset border border-line'
      }`}
    >
      {/* The knob is a shape, so SC 1.4.11 applies to its edge against the
          track it sits on. The old plain white disc measured 1.14:1 on the
          off track (invisible) and 2.15:1 on the amber on-track.

          No single ring colour can fix both ends: --text-on-accent is 8.31:1
          on amber but 1.09:1 on the noite off-track, and --text is 15.2:1 on
          that track but 2.11:1 on amber. So the knob inverts with the track
          instead, which is both measurable and a stronger state cue than a
          tint change:

            OFF  knob --surface-raised + a 1px --text ring
                 13.11:1 / 15.22:1 against --surface-inset
            ON   knob --text-on-accent, no ring needed
                  8.31:1 / 12.44:1 against --accent

          The knob visibly flips light-to-dark on toggle, so the state also
          survives SC 1.4.1 and Windows High Contrast, where the fills are
          replaced wholesale. */}
      <span
        aria-hidden="true"
        className={`absolute top-1 w-4 h-4 rounded-full shadow-md transition-transform ${
          checked
            ? 'translate-x-6 bg-content-onaccent'
            : 'translate-x-1 bg-surface-raised border border-content'
        }`}
      />
    </button>
  );
}

interface SettingRowProps {
  /** Ties the visible label to the control that follows it. */
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  /** Ragged rows (multi-paragraph help text) align to the top. */
  align?: 'center' | 'start';
}

/**
 * One row of the settings dialog: label, help text, control. Labels
 * previously used bare <label> with no `for` and no wrapping control,
 * so they contributed nothing to any accessible name.
 */
export function SettingRow({
  id,
  label,
  description,
  control,
  align = 'center',
}: SettingRowProps) {
  return (
    <div
      className={`flex justify-between gap-4 ${
        align === 'center' ? 'items-center' : 'items-start'
      }`}
    >
      <div className="min-w-0">
        <div
          id={`${id}-label`}
          className="font-bold text-xs text-content flex items-center gap-1.5"
        >
          {label}
        </div>
        {description ? (
          <div className="text-xs text-content-muted font-medium leading-relaxed mt-0.5">
            {description}
          </div>
        ) : null}
      </div>
      {control}
    </div>
  );
}

export function Divider() {
  return <div className="w-full h-px bg-line" role="presentation" />;
}
