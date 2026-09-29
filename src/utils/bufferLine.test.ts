import { describe, expect, test } from 'bun:test';
import { readLine, lineIndexAt } from './bufferLine';

const DOC = '# 28/09/2026\n- Trabalho\n  - cansaço\n  - chefe cobra\n    - prazos curtos\n- Família';

describe('readLine', () => {
  test('finds each line, not always the first one', () => {
    // The bug this module was born to prevent: a search anchored on the loop
    // counter instead of the previous newline answers "Trabalho" for every
    // line from the second downwards, which is a caret that can never leave
    // the first topic.
    expect(readLine(DOC, 0).text).toBe('28/09/2026');
    expect(readLine(DOC, 1).text).toBe('Trabalho');
    expect(readLine(DOC, 2).text).toBe('cansaço');
    expect(readLine(DOC, 3).text).toBe('chefe cobra');
    expect(readLine(DOC, 4).text).toBe('prazos curtos');
    expect(readLine(DOC, 5).text).toBe('Família');
  });

  test('the offsets it reports actually delimit the line', () => {
    for (let i = 0; i < 6; i++) {
      const line = readLine(DOC, i);
      expect(DOC.slice(line.start, line.end)).toBe(line.raw);
    }
  });

  test('separates indent, marker and text', () => {
    const line = readLine(DOC, 4);
    expect(line.indent).toBe('    ');
    expect(line.marker).toBe('-');
    expect(line.text).toBe('prazos curtos');
    expect(line.isBullet).toBe(true);
    expect(line.isEmptyBullet).toBe(false);
  });

  test('a bullet with nothing after it is an empty bullet, not a continuation', () => {
    // This distinction is the whole fix: the parser drops an empty bullet, so
    // the editor has to recognise it from the text to know a topic is starting.
    const line = readLine('- cansaço\n  - ', 1);
    expect(line.isBullet).toBe(true);
    expect(line.isEmptyBullet).toBe(true);
    expect(line.text).toBe('');
    expect(line.indent).toBe('  ');
  });

  test('the session heading is a heading, never a topic', () => {
    const line = readLine(DOC, 0);
    expect(line.isHeading).toBe(true);
    expect(line.isBullet).toBe(false);
  });

  test('a wrapped paragraph is neither', () => {
    const line = readLine('- cansaço\n  e mais texto', 1);
    expect(line.isContinuation).toBe(true);
    expect(line.isBullet).toBe(false);
    expect(line.text).toBe('e mais texto');
  });

  test('a blank line is a continuation, and empty', () => {
    const line = readLine('- a\n\n- b', 1);
    expect(line.isContinuation).toBe(true);
    expect(line.isBullet).toBe(false);
    expect(line.isEmptyBullet).toBe(false);
    expect(line.raw).toBe('');
  });

  test('a dash glued to the word is a paragraph, as markdown requires', () => {
    // "-cansaço" is not a bullet. Treating it as one would invent a level the
    // parser never saw, and Enter would then insert a bullet where none is.
    const line = readLine('-cansaço', 0);
    expect(line.isBullet).toBe(false);
    expect(line.isContinuation).toBe(true);
  });

  test('a bullet marker needs whitespace after it', () => {
    expect(readLine('*  cansaço', 0).marker).toBe('*');
    expect(readLine('+\tcansaço', 0).marker).toBe('+');
  });

  test('an index past the end lands on the last line', () => {
    expect(readLine(DOC, 99).raw).toBe('- Família');
  });
});

describe('lineIndexAt', () => {
  test('maps an offset to the line it sits on', () => {
    expect(lineIndexAt(DOC, 0)).toBe(0);
    expect(lineIndexAt(DOC, 12)).toBe(0); // still the heading
    expect(lineIndexAt(DOC, 13)).toBe(1);
    expect(lineIndexAt(DOC, DOC.length)).toBe(5);
  });

  test('an offset inside an indent is still that line', () => {
    // The caret in "  - cansaço" often sits between the two spaces, before the
    // bullet. Reading the line from there must not shift it.
    const at = DOC.indexOf('  - cansaço');
    expect(lineIndexAt(DOC, at + 1)).toBe(2);
  });

  test('an offset past the end does not run away', () => {
    expect(lineIndexAt(DOC, DOC.length + 50)).toBe(5);
    expect(lineIndexAt('', 10)).toBe(0);
  });
});
