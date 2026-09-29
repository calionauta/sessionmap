/**
 * Small text helpers with no state and no opinion about trees.
 *
 * They were in tree.ts because that is where the outline grew up, not because
 * they belong to it: a search normaliser has nothing to say about a mind map,
 * and the admin panel and the export modal were importing them by way of a
 * tree module to format a date.
 */

export function formatSessionTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  const hr = pad(date.getHours());
  const min = pad(date.getMinutes());
  const sec = pad(date.getSeconds());
  return `${d}/${m}/${y} ${hr}:${min}:${sec}`;
}

/**
 * Accent- and case-insensitive plain-text form, for searching.
 *
 * Portuguese is written with diacritics that speakers routinely omit when
 * typing fast, and this app's users are typing mid-session while a client
 * waits. Stripping combining marks means "saude" finds "saúde" and "familia"
 * finds "família", which a plain toLowerCase() would miss.
 */
export function searchNormalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** True when `haystack` contains `needle`, ignoring case and accents. */
export function matchesQuery(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return searchNormalize(haystack).includes(needle);
}

