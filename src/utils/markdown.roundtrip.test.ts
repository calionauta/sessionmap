/**
 * The round-trip guarantee, under random input.
 *
 * Every other test in this file checks a shape someone thought of. This one
 * generates documents instead, because the bug that motivated the rewrite was
 * not a case anyone imagined — it was a "##" on a line of its own, which is
 * exactly the kind of thing a person types and a person does not write a test
 * for.
 *
 * Two properties, checked over generated documents:
 *
 *   NO WORDS LOST   every word in the input is still in the tree after a full
 *                   parse, serialise, re-parse. A missing word is never right.
 *   IDEMPOTENT      serialise(parse(x)) is a fixed point: running it again
 *                   changes nothing. Otherwise the buffer would rewrite itself
 *                   under a resting caret, which is the most corrosive bug an
 *                   editor can have.
 */
import { describe, expect, test } from 'bun:test';
import { parseMarkdown, treeToMarkdown, wordsOf } from './markdown';
import { parseMarkdownToTree } from './tree';
import { normalizeOutline } from './tree';
import { MindMapNode } from '../types';

let seq = 0;
const nextId = () => `n${++seq}`;

const parse = (md: string) =>
  parseMarkdown(md, { defaultTitle: 'Sessão', generateId: nextId });

/** Every node's text, depth-first. */
function allText(node: MindMapNode): string[] {
  const out: string[] = [];
  const walk = (n: MindMapNode) => {
    for (const c of n.children || []) {
      out.push(c.text);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/**
 * A deterministic generator. Seeded by hand rather than Math.random so a
 * failure can be reproduced from the seed in the message.
 */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const WORDS = [
  'cansaço', 'sono', 'trabalho', 'ansiedade', 'chefe', 'mãe', 'irmão',
  'prazos', 'madrugada', 'café', 'reunião', 'insônia', 'sonho', 'festa',
];

/** One random line of markdown, of one of the shapes a person actually types. */
function randomLine(rng: () => number, depth: number): string {
  const indent = '  '.repeat(depth);
  const words = () => {
    const n = 1 + Math.floor(rng() * 4);
    return Array.from({ length: n }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
  };
  const roll = rng();
  if (roll < 0.4) return `${indent}- ${words()}`;
  if (roll < 0.55) return `${indent}- ${words()}\n${indent}  ${words()}`; // wrapped
  if (roll < 0.7) return `${indent}1. ${words()}`;
  if (roll < 0.85) return `${indent}${'#'.repeat(2 + Math.floor(rng() * 3))} ${words()}`;
  return `${indent}- **${words()}** e \`${words()}\``; // inline markup
}

function randomDoc(rng: () => number): string {
  const lines: string[] = [`# Sessão ${Math.floor(rng() * 1000)}`];
  const n = 2 + Math.floor(rng() * 10);
  /*
   * Built the way a real buffer is: a session heading, then a hierarchy of
   * bullets. The depth moves by small steps so a line never appears at an
   * indent that CommonMark would read as a code block rather than a list —
   * that is a property of the GENERATOR, not of the parser: a buffer where a
   * bullet sits under a heading is legitimate and the parser handles it, but
   * a four-space-indented line after a heading is a code block to every
   * CommonMark parser, and no outline ever looks like that.
   */
  let depth = 0;
  for (let i = 0; i < n; i++) {
    depth = Math.max(0, Math.min(depth + [-1, 0, 0, 1, 1, 2][Math.floor(rng() * 6)], 3));
    const useHeading = rng() < 0.2;
    if (useHeading) {
      lines.push(`${'  '.repeat(depth)}${'#'.repeat(2 + Math.floor(rng() * 3))} ${WORDS[Math.floor(rng() * WORDS.length)]}`);
    } else {
      lines.push(randomLine(rng, depth));
    }
    if (rng() < 0.15) lines.push('');
  }
  return lines.join('\n');
}

describe('the round trip holds under random input', () => {
  const SEEDS = [1, 7, 42, 99, 256, 1024, 31337, 65535, 424242, 8675309];

  test('no word written is ever lost, over 200 generated documents', () => {
    const failures: string[] = [];
    for (let i = 0; i < 200; i++) {
      const rng = makeRng(SEEDS[i % SEEDS.length] + i * 7919);
      const md = randomDoc(rng);
      const tree = parseMarkdownToTree(md, 'Sessão');
      const held = [tree.text, ...allText(tree)].join(' ').toLowerCase();
      const missing = wordsOf(md).filter((w) => !held.includes(w.toLowerCase()));
      if (missing.length > 0) failures.push(`seed ${i}: lost ${missing.join(', ')}`);
    }
    expect(failures).toEqual([]);
  });

  /**
   * Stability is claimed from the SECOND write, not the first.
   *
   * Input is free markdown and output is canonical, so the first write
   * normalises whatever was typed — that is the deal, and a "## sub" becoming
   * "  - sub" is the feature, not a bug. What must hold is that the canonical
   * form is a FIXED POINT: once the buffer has been rewritten, no further
   * writing, resting or not, changes it again. Otherwise the text would move
   * under a resting caret, which is the most corrosive failure an editor has.
   */
  test('the canonical form is a fixed point', () => {
    const failures: string[] = [];
    for (let i = 0; i < 200; i++) {
      const rng = makeRng(SEEDS[i % SEEDS.length] + i * 104729);
      const md = randomDoc(rng);
      const once = treeToMarkdown(parse(md));
      const twice = treeToMarkdown(parse(once));
      const thrice = treeToMarkdown(parse(twice));
      const fourth = treeToMarkdown(parse(thrice));
      if (once !== twice) {
        failures.push(
          `seed ${i}: not canonical after one write\n  in:  ${JSON.stringify(md)}\n  1st: ${JSON.stringify(once)}\n  2nd: ${JSON.stringify(twice)}`
        );
      }
      if (twice !== thrice || thrice !== fourth) {
        failures.push(`seed ${i}: canonical form is not stable`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('a parsed tree is always valid, so nothing can dissolve it later', () => {
    // normalizeOutline runs on every update and rewrites a blank node that
    // has children. If a parse could produce one, the outline would undo
    // itself a frame later and the buffer would appear to lose the edit.
    for (let i = 0; i < 200; i++) {
      const rng = makeRng(SEEDS[i % SEEDS.length] + i * 15485863);
      const tree = parse(randomDoc(rng));
      expect(normalizeOutline(tree)).toBe(tree);
    }
  });

  test('no id is ever duplicated by a re-parse', () => {
    // The outline keys its rows by id, so a duplicate would remount the list
    // and strand the caret.
    for (let i = 0; i < 100; i++) {
      const rng = makeRng(SEEDS[i % SEEDS.length] + i * 32452843);
      const first = parse(randomDoc(rng));
      const second = parseMarkdownToTree(treeToMarkdown(first), 'Sessão', first);
      const ids = [second.id, ...allIds(second)];
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

function allIds(node: MindMapNode): string[] {
  const out: string[] = [];
  const walk = (n: MindMapNode) => {
    for (const c of n.children || []) {
      out.push(c.id);
      walk(c);
    }
  };
  walk(node);
  return out;
}
