/**
 * Small text helpers with no state and no opinion about trees.
 *
 * They were in tree.ts because that is where the outline grew up, not because
 * they belong to it: a timestamp formatter has nothing to say about a mind
 * map, and the admin panel and the export modal were importing it by way of a
 * tree module to format a date.
 */

export function formatSessionTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = pad(date.getFullYear());
  const hr = pad(date.getHours());
  const min = pad(date.getMinutes());
  const sec = pad(date.getSeconds());
  return `${d}/${m}/${y} ${hr}:${min}:${sec}`;
}

/* An accent- and case-insensitive form, for search, used to live here too
 * alongside matchesQuery. Both went when the row editor and its search field
 * went, and a scan found no caller for either. Recorded rather than deleted
 * silently: the folding is the useful part — "saude" has to find "saúde" and
 * "familia" has to find "família", which a plain toLowerCase() misses, because
 * people type mid-session with a client waiting — and it is three lines to
 * restore when there is a search to restore it for. */
