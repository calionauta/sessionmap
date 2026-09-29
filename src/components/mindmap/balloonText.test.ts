import { describe, expect, test } from 'bun:test';
import {
  BALLOON_MAX_TEXT_WIDTH,
  measureBalloon,
  wrapText,
  displayTextFor,
} from './balloonText';

/** Every character of the input must survive the wrap, in order. */
function reconstruct(lines: string[]): string {
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

describe('wrapText — nothing is ever lost', () => {
  test('short text is one line, unchanged', () => {
    expect(wrapText('cansaço', 40)).toEqual(['cansaço']);
  });

  test('wraps on spaces, preserving every word', () => {
    const text = 'ansiedade em relação ao trabalho e ao sono';
    const lines = wrapText(text, 16);
    expect(reconstruct(lines)).toBe(text);
    expect(lines.every((l) => l.length <= 16)).toBe(true);
  });

  test('a long text keeps all of it, across as many lines as it needs', () => {
    const text =
      'a cliente relata que desde a mudança de cargo tem-peakstone acordado três ou quatro vezes por noite, disrupting o descanso e aumentando a irritabilidade durante o dia';
    const lines = wrapText(text, 20);
    expect(reconstruct(lines)).toBe(text);
    expect(lines.length).toBeGreaterThan(4);
  });

  test('a 400-character annotation is not truncated at any width', () => {
    const text = 'palavra '.repeat(50).trim();
    for (const width of [8, 16, 26, 40, 60]) {
      expect(reconstruct(wrapText(text, width))).toBe(text);
    }
  });

  test('hard-splits a single token longer than the line rather than overflowing', () => {
    const url = 'a'.repeat(50);
    const lines = wrapText(url, 20);
    expect(lines.every((l) => l.length <= 20)).toBe(true);
    expect(lines.join('')).toBe(url);
  });

  test('collapses runaway whitespace instead of emitting empty lines', () => {
    expect(wrapText('  a   b \n\n c  ', 40)).toEqual(['a b c']);
  });

  test('empty and blank input produce one empty line, not zero lines', () => {
    // Zero lines would make the balloon height padding-only and the text
    // element have nothing to draw.
    expect(wrapText('', 20)).toEqual(['']);
    expect(wrapText('   ', 20)).toEqual(['']);
  });

  test('an explicit line cap is honoured', () => {
    const text = 'palavra '.repeat(30).trim();
    const lines = wrapText(text, 16, 2);
    expect(lines).toHaveLength(2);
  });
});

describe('measureBalloon — the box always fits the words', () => {
  test('a short label is one line and small', () => {
    const m = measureBalloon('cansaço', false);
    expect(m.lines).toHaveLength(1);
    expect(m.width).toBeLessThan(BALLOON_MAX_TEXT_WIDTH);
    expect(m.height).toBeLessThan(60);
  });

  test('height grows with the line count', () => {
    const short = measureBalloon('cansaço', false);
    const long = measureBalloon(
      'a cliente relata que desde a mudança de cargo tem acordado três ou quatro vezes por noite e isso está disrupting o descanso de forma clara',
      false
    );
    expect(long.lines.length).toBeGreaterThan(short.lines.length);
    expect(long.height).toBeGreaterThan(short.height);
  });

  test('the box is never narrower than the longest line it draws', () => {
    // The invariant the two old implementations violated: the pill was sized
    // from a different metric than the text was wrapped with, so long lines
    // were cut off at the edge.
    for (const text of [
      'cansaço',
      'ansiedade em relação ao trabalho e ao sono',
      'uma reflexão bem mais longa que ocupa várias linhas dentro do balão para verificar o dimensionamento',
      'x'.repeat(300),
    ]) {
      const m = measureBalloon(text, false);
      const longest = m.lines.reduce((a, l) => Math.max(a, l.length), 0);
      // Enough width for the longest line, using the same ratio that wrapped it.
      const needed = longest * m.fontSize * 0.58;
      expect(m.width).toBeGreaterThanOrEqual(needed - 1);
    }
  });

  test('width is capped, so a long text wraps instead of stretching forever', () => {
    const m = measureBalloon('palavra '.repeat(200).trim(), false);
    expect(m.width).toBeLessThanOrEqual(BALLOON_MAX_TEXT_WIDTH + 1);
  });

  test('fontScale scales the text, the box and the cap together', () => {
    const a = measureBalloon('ansiedade em relação ao trabalho e ao sono', false, 1);
    const b = measureBalloon('ans.ietf em relação ao trabalho e ao sono', false, 1.3);
    expect(b.fontSize).toBeGreaterThan(a.fontSize);
    expect(b.width).toBeGreaterThan(a.width);
    expect(b.height).toBeGreaterThan(a.height);
  });

  test('the root balloon is the larger shape', () => {
    const node = measureBalloon('28/09/2026 14:08:17', false);
    const root = measureBalloon('28/09/2026 14:08:17', true);
    expect(root.fontSize).toBeGreaterThan(node.fontSize);
  });

  test('no character budget: a very long text is fully present', () => {
    const text = 'palavra '.repeat(80).trim();
    const m = measureBalloon(text, false);
    expect(reconstruct(m.lines)).toBe(text);
  });
});

describe('displayTextFor', () => {
  test('a real node falls back to "Sem título" when blank', () => {
    expect(displayTextFor('')).toBe('Sem título');
    expect(displayTextFor('cansaço')).toBe('cansaço');
  });

  test('the ghost shows the draft, or a placeholder', () => {
    expect(displayTextFor('', { isGhost: true, ghostText: 'digitand' })).toBe('digitand');
    expect(displayTextFor('', { isGhost: true })).toBe('novo ponto…');
  });

  test('confirm_only shows the typing notice instead of the draft', () => {
    expect(
      displayTextFor('', { isGhost: true, ghostText: 'abc', liveTextMode: 'confirm_only' })
    ).toBe('digitando…');
  });
});
