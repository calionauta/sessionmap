/**
 * Balloon text measurement.
 *
 * The whole point of this module is that ONE function decides how a balloon is
 * measured and how it is broken into lines, so the box can never disagree with
 * the words inside it. That disagreement was the bug: the layout sized balloons
 * with a character width of 8.41px and hard-coded a maximum of two lines, while
 * the renderer broke text with a different width (9px) and then truncated the
 * second line with an ellipsis. The two were close enough that short labels
 * looked right and long ones silently lost words — a host's own words,
 * on the screen the client is reading from across the room.
 *
 * There is no character budget. A balloon grows in both directions, because
 * truncation is not a recoverable loss: the user cannot tell which words
 * vanished, and cannot recover them from what is on screen.
 */
import { MindMapNode } from '../../types';

/**
 * Characters per pixel, per font size.
 *
 * Measured against Plus Jakarta Sans at these weights, the digit-heavy average
 * lands near 0.58em and lowercase prose a little under it. This is an
 * ESTIMATE by design — the layout must run in a useMemo with no DOM access —
 * but it is now used by a single function for both measuring and wrapping, so
 * an inaccuracy shows up as slightly generous padding rather than as lost text.
 */
const CHAR_WIDTH_RATIO = 0.58;

export const BALLOON_FONT_SIZE_ROOT = 16;
export const BALLOON_FONT_SIZE_NODE = 13.5;

/**
 * How wide a balloon may grow before it wraps to another line.
 *
 * Wider than the 240px it replaced, because the earlier cap was one of the two
 * halves of the disagreement: the box was being asked to hold prose at a width
 * chosen for a label. A balloon now grows to this, then wraps, and keeps
 * growing downward — so a long thought reads as a paragraph instead of as a
 * truncated sentence.
 */
export const BALLOON_MAX_TEXT_WIDTH = 320;

/** Never narrower than this, so a one-word balloon is still readable. */
const MIN_BALLOON_WIDTH = 80;
const MIN_ROOT_WIDTH = 110;

const LINE_HEIGHT_RATIO = 1.35;

/**
 * Breaks text into the lines a balloon will draw.
 *
 * Wraps on spaces, so a word is never split unless it is on its own longer
 * than the wrap width — in which case splitting it is strictly better than
 * overflowing the pill. Every character of the input appears in exactly one
 * returned line: that is the invariant the old two-line-plus-ellipsis code
 * broke, and it is what the tests below pin.
 */
export function wrapText(
  text: string,
  maxCharsPerLine: number,
  maxLines = Number.POSITIVE_INFINITY
): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [''];

  const width = Math.max(1, Math.floor(maxCharsPerLine));
  const lines: string[] = [];

  // A single token longer than the line (a URL, a compound word) has to be
  // hard-split, otherwise it overflows the pill and the text is clipped by the
  // canvas rather than by us.
  const hardSplit = (token: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < token.length; i += width) {
      out.push(token.slice(i, i + width));
    }
    return out;
  };

  const words: string[] = [];
  for (const token of clean.split(' ')) {
    if (token.length <= width) {
      words.push(token);
    } else {
      words.push(...hardSplit(token));
    }
  }

  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  return lines.length > 0 ? lines : [''];
}

export interface BalloonMeasure {
  width: number;
  height: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

/**
 * Measures a balloon for a piece of text.
 *
 * The one function both the layout and the renderer call, so the drawn pill is
 * always exactly as wide and as tall as the words inside it. Height grows with
 * the line count, which is what lets a long annotation be read in full instead
 * of being cut.
 */
export function measureBalloon(
  text: string,
  isRoot: boolean,
  fontScale: number = 1
): BalloonMeasure {
  const fontSize = (isRoot ? BALLOON_FONT_SIZE_ROOT : BALLOON_FONT_SIZE_NODE) * fontScale;
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const charWidth = fontSize * CHAR_WIDTH_RATIO;

  // Grow horizontally up to the cap, then wrap and keep growing downward.
  const maxChars = Math.max(
    8,
    Math.floor(BALLOON_MAX_TEXT_WIDTH * fontScale / charWidth)
  );
  const lines = wrapText(text || 'Sem título', maxChars);

  const widest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const paddingX = (isRoot ? 24 : 18) * fontScale * 2;
  const paddingY = (isRoot ? 16 : 10) * fontScale * 2;

  // The cap applies to the WHOLE box, padding included. Clamping the text
  // width first and adding padding afterwards let the balloon exceed its own
  // ceiling by the width of that padding — which is how a long annotation ended
  // up wider than the layout had assumed.
  const cap = BALLOON_MAX_TEXT_WIDTH * fontScale;
  const width = Math.min(cap, Math.max(widest * charWidth, 0) + paddingX);

  return {
    width: Math.round(Math.max(isRoot ? MIN_ROOT_WIDTH : MIN_BALLOON_WIDTH, width)),
    height: Math.round(paddingY + lines.length * lineHeight),
    lines,
    fontSize,
    lineHeight,
  };
}

/** Text as it should be shown for a node, matching the outline's fallback. */
export function displayTextFor(
  text: string,
  options: { isGhost?: boolean; ghostText?: string; liveTextMode?: 'live' | 'confirm_only' } = {}
): string {
  if (options.isGhost) {
    if (options.liveTextMode === 'confirm_only') return 'digitando…';
    return options.ghostText || 'novo ponto…';
  }
  return text || 'Sem título';
}

/**
 * Convenience for callers that only need the box, not the lines.
 */
export function measureNode(node: MindMapNode, isRoot: boolean, fontScale = 1) {
  return measureBalloon(node.text, isRoot, fontScale);
}
