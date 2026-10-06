/**
 * How the session window is split.
 *
 * Two numbers and one clamp, which is not much — but it was living inside
 * HostView as a bare `useState(38)` with the bounds nowhere, so "can this
 * pane be narrower than it opens at?" had no answer that could be checked
 * without mounting the whole app, storage and sync service included.
 */

/**
 * The outline pane's narrowest width, as a share of the window.
 *
 * Also the width the app has always opened at, which is why the handle treats
 * it as a floor and not as an arbitrary limit: the pane can be widened but not
 * narrowed below where it starts. That is a deliberate reading of "keep the
 * current width as the minimum", and it is defensible — a mind map squeezed
 * into a sliver is not a mind map, so the only direction that reliably produces
 * a worse session is the one the handle refuses. Lower this and the floor
 * stops being a floor.
 */
export const OUTLINE_MIN_PERCENT = 38;

/**
 * The widest it may go, leaving the map enough room to still be a map.
 *
 * Not 100, and not "as far as the pointer goes": at 100 the client screen
 * mirrors a canvas with nothing on it, which is the outcome the pane exists to
 * prevent.
 */
export const OUTLINE_MAX_PERCENT = 75;

/**
 * The widest window that still tries to show two panes.
 *
 * md in Tailwind. Below it the split stops being a split: 38% of 375px is
 * 142px, the map gets 233px, and a 44px splitter is ten percent of the screen
 * spent on a border. Chosen to match the existing Tailwind scale rather than
 * invented, so the CSS breakpoints and this number cannot drift apart.
 */
export const NARROW_VIEWPORT_MAX_PX = 767;

/** Keeps a width inside the range, however it was arrived at. */
export function clampOutlineWidth(percent: number): number {
  if (!Number.isFinite(percent)) return OUTLINE_MIN_PERCENT;
  return Math.min(OUTLINE_MAX_PERCENT, Math.max(OUTLINE_MIN_PERCENT, percent));
}
