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
  /** Full-width with evenly stretched options, for stacked rows. */
  fluid?: boolean;
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  fluid = false,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      /* Wraps instead of overflowing: five percentage options beside a long
         label do not fit a 375px viewport side by side, and a row that
         bleeds past the dialog reads as broken. Wrapped options are still
         one group, one tab stop per option, no behavior change. */
      className={`flex flex-wrap items-center gap-1 p-1 bg-surface-inset rounded-xl border border-line max-w-full ${
        fluid ? 'w-full' : ''
      }`}
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
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer shrink-0 ${
              fluid ? 'flex-1 justify-center' : ''
            } ${
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
      /* 44x24 visible track. The ::before expander grows the hit area to the
         44px touch floor vertically (24 + 2*10) without changing how the switch
         looks, which is the same trick the outline row controls use. */
      className={`relative w-11 h-6 shrink-0 rounded-full transition-colors cursor-pointer
        before:content-[''] before:absolute before:-inset-y-2.5 before:inset-x-0 ${
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

            OFF  knob --surface-raised with a --text edge
                  the dark edge is what makes a light disc readable on a light
                  track; the disc on its own is only ~1.1:1
            ON   knob --text-on-accent, edge matching the fill so the disc
                  reads as one solid shape

          The knob visibly flips light-to-dark on toggle, so the state also
          survives SC 1.4.1 and Windows High Contrast, where the fills are
          replaced wholesale.

          Geometry is identical in both states on purpose. The knob used to
          carry a border only when off, and because sizing is border-box that
          made the visible disc 14px off and 16px on, so the switch appeared to
          change size as well as colour. The border is now always present and
          only its colour differs. The inset is 4px on BOTH sides: left-1 plus
          translate-x-5 rather than -6, because the knob was landing flush
          against the right edge of the 44px track. */}
      <span
        aria-hidden="true"
        className={`absolute left-1 top-1 w-4 h-4 rounded-full border shadow-md transition-transform ${
          checked
            ? 'translate-x-5 bg-content-onaccent border-content-onaccent'
            : 'translate-x-0 bg-surface-raised border-content'
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
 *
 * Stacks below `sm`: a side-by-side label plus a five-option group does
 * not fit a phone, and the squeezed result is what read as "broken".
 * From `sm` up it is the same row as before.
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
      className={`flex flex-col gap-2 sm:flex-row sm:justify-between sm:gap-4 ${
        align === 'center' ? 'sm:items-center' : 'sm:items-start'
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
      <div className="shrink-0 sm:self-auto self-start">{control}</div>
    </div>
  );
}

export function Divider() {
  return <div className="w-full h-px bg-line" role="presentation" />;
}
