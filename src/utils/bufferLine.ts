/**
 * Reading a line of the markdown buffer.
 *
 * A plain textarea has no notion of a topic, so every decision the editor makes
 * about the caret — which topic it is in, what Enter should type, whether the
 * dwell should re-arm — starts by asking what the line under the caret actually
 * says. That question is pure text, so it lives here with no React and no DOM,
 * and the tests for it are tests of text rather than of a rendered component.
 */

/** One line of the buffer, taken apart. */
export interface BufferLine {
  /** Zero-based position in the buffer. */
  index: number;
  /** Character offset where the line starts. */
  start: number;
  /** Character offset just past the line's last character. */
  end: number;
  /** The line as typed, marker included. */
  raw: string;
  /** Leading whitespace. Decides the hierarchy level. */
  indent: string;
  /** The bullet character, or null when the line is not a bullet. */
  marker: '-' | '*' | '+' | null;
  /** The bullet's own trailing space, so it can be reproduced exactly. */
  gap: string;
  /** Everything after the bullet, trimmed. */
  text: string;
  /** The session line, `# …`. Never a topic. */
  isHeading: boolean;
  /** A bullet of any kind, empty or not. */
  isBullet: boolean;
  /** A bullet with nothing after it: a topic that exists only as a caret. */
  isEmptyBullet: boolean;
  /** Not a heading and not a bullet: blank, or a wrapped paragraph. */
  isContinuation: boolean;
}

const BULLET = /^(\s*)([-*+])(\s*)(.*)$/;
const HEADING = /^(\s*)#\s*(.*)$/;

/**
 * Takes apart the line at `index`.
 *
 * A bullet needs whitespace after the marker to count as one, which is what
 * markdown itself requires: a line reading "-cansaço" is a paragraph, not a
 * topic, and treating it as a topic would invent a level the parser never saw.
 */
export function readLine(value: string, index: number): BufferLine {
  // Walk forward from the previous line's end, NOT from the previous index: a
  // search anchored on the loop counter re-finds the first newline every time
  // and silently answers with line 1 for every line below it.
  let start = 0;
  for (let i = 0; i < index; i++) {
    const nl = value.indexOf('\n', start);
    // Past the last newline: stay on the last line rather than jumping to the
    // end, so an out-of-range index still describes something real.
    if (nl === -1) break;
    start = nl + 1;
  }
  const nl = value.indexOf('\n', start);
  const end = nl === -1 ? value.length : nl;
  const raw = value.slice(start, end);

  const heading = HEADING.exec(raw);
  if (heading) {
    return {
      index,
      start,
      end,
      raw,
      indent: heading[1],
      marker: null,
      gap: '',
      text: heading[2].trim(),
      isHeading: true,
      isBullet: false,
      isEmptyBullet: false,
      isContinuation: false,
    };
  }

  const bullet = BULLET.exec(raw);
  if (bullet && bullet[3].length > 0) {
    const text = bullet[4].trim();
    return {
      index,
      start,
      end,
      raw,
      indent: bullet[1],
      marker: bullet[2] as '-' | '*' | '+',
      gap: bullet[3],
      text,
      isHeading: false,
      isBullet: true,
      isEmptyBullet: text === '',
      isContinuation: false,
    };
  }

  return {
    index,
    start,
    end,
    raw,
    indent: '',
    marker: null,
    gap: '',
    text: raw.trim(),
    isHeading: false,
    isBullet: false,
    isEmptyBullet: false,
    isContinuation: true,
  };
}

/** The zero-based line index the offset `offset` sits on. */
export function lineIndexAt(value: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < value.length; i++) {
    if (value[i] === '\n') line++;
  }
  return line;
}

/**
 * The line index of every line that STARTS a topic, in document order.
 *
 * A line starts a topic when it is a bullet with something after it. Blank
 * lines and wrapped paragraphs start none, which is what makes the result
 * comparable with a flattened tree: index N here is the Nth topic there.
 *
 * This exists because matching a line to a topic BY TEXT is wrong the moment
 * two topics say the same thing, and "ansiedade" twice in a session is
 * ordinary rather than exotic. Every outliner I know of hits this eventually.
 */
export function topicLines(value: string): number[] {
  const found: number[] = [];
  let index = 0;
  let at = 0;
  while (at <= value.length) {
    const nl = value.indexOf('\n', at);
    const end = nl === -1 ? value.length : nl;
    const line = readLine(value, index);
    if (line.start === at && line.isBullet && !line.isEmptyBullet) found.push(index);
    at = end + 1;
    index++;
    if (nl === -1) break;
  }
  return found;
}

/**
 * The line index of the topic an empty bullet at `indent` hangs from, or -1.
 *
 * The nearest line above that starts a topic at a SHALLOWER indent, which is
 * how the parser nests. A bullet at column zero finds nothing and returns -1,
 * which the caller reads as the session root.
 *
 * By indentation and position, never by text: the text of the line above is
 * not consulted, so two topics saying the same thing cannot send the new one
 * to the wrong branch.
 */
export function parentTopicLine(value: string, lineIndex: number, indent: string): number {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = readLine(value, i);
    if (line.isHeading) return -1;
    if (!line.isBullet || line.text === '') continue;
    if (line.indent.length >= indent.length) continue;
    return i;
  }
  return -1;
}
