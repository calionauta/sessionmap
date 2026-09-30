import { useEffect, useState } from 'react';
import { NARROW_VIEWPORT_MAX_PX } from '../utils/layout';

/**
 * True when the window is too narrow to show two panes side by side.
 *
 * At 375px a 38% outline is 142px and the map gets 233px. Neither is a working
 * surface, and the splitter handle is 44px of the 375 — ten percent of the
 * screen spent on a border. Split view is the wrong model below the
 * breakpoint, so below it exactly one pane shows.
 *
 * Initialised synchronously from matchMedia rather than from an effect, because
 * an effect would render the desktop layout first and then snap to the mobile
 * one — a visible reflow of the whole screen on every phone load.
 */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(`(max-width: ${NARROW_VIEWPORT_MAX_PX}px)`).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_MAX_PX}px)`);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(query.matches);
    // addEventListener on the query is the modern form; addListener is only
    // there for engines that predate it, and no browser this app targets.
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return narrow;
}
