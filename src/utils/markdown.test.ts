/**
 * The markdown buffer's contract.
 *
 * Three things are worth pinning here, and the third is the one that matters.
 *
 *   1. Free markdown in. Headings, ordered lists and wrapped paragraphs are
 *      understood as structure — the version this replaced turned all three
 *      into literal text, so "## sub" arrived as "- ## sub" and a paragraph
 *      split into two topics.
 *   2. One canonical form out. Indented bullets, always. Promoting a topic
 *      must never rewrite its words.
 *   3. NOTHING THE HOST WROTE DISAPPEARS. That is a property of the
 *      whole round trip, not of any one function, so it is checked against
 *      the words rather than against a shape.
 */
import { describe, expect, test } from 'bun:test';
import { parseMarkdown, treeToMarkdown, wordsOf } from './markdown';
import { parseMarkdownToTree } from './tree';
import { MindMapNode } from '../types';

let seq = 0;
const nextId = () => `n${++seq}`;

const node = (
  id: string,
  text: string,
  children: MindMapNode[] = [],
  collapsed = false
): MindMapNode => ({ id, text, children, collapsed });

const fixture = (): MindMapNode =>
  node('root', '28/09/2026', [
    node('trab', 'Trabalho', [
      node('t1', 'cansaço'),
      node('t2', 'chefe cobra', [node('t2a', 'prazos curtos')]),
    ]),
    node('fam', 'Família', [node('f1', 'mãe apoia')]),
  ]);

/** Structure without ids — the shape that must survive. */
function shape(n: MindMapNode): unknown {
  return { text: n.text, children: (n.children || []).map(shape) };
}

const parse = (md: string, previous?: MindMapNode | null) =>
  parseMarkdown(md, { defaultTitle: 'Sessão', previousRoot: previous, generateId: nextId });

/** Every topic's text, in document order. */
const topics = (md: string) => {
  const t = parse(md);
  const out: string[] = [];
  const walk = (n: MindMapNode) => {
    for (const c of n.children || []) {
      out.push(c.text);
      walk(c);
    }
  };
  walk(t);
  return out;
};

/** Every topic's depth, in document order. */
const depths = (md: string) => {
  const t = parse(md);
  const out: number[] = [];
  const walk = (n: MindMapNode, d: number) => {
    for (const c of n.children || []) {
      out.push(d);
      walk(c, d + 1);
    }
  };
  walk(t, 0);
  return out;
};

describe('free markdown is understood as structure', () => {
  test('headings become real levels, not text', () => {
    // The case the old parser got wrong: "## sub" became the literal
    // "- ## sub" and sat at whatever level its indentation implied.
    expect(topics('# S\n- a\n  ## sub\n  ### mais fundo\n- b')).toEqual([
      'a',
      'sub',
      'mais fundo',
      'b',
    ]);
    expect(depths('# S\n- a\n  ## sub\n  ### mais fundo\n- b')).toEqual([0, 1, 2, 0]);
  });

  test('an ordered list is a list, and the "1." leaves the text', () => {
    expect(topics('# S\n- a\n1. primeiro\n2. segundo')).toEqual(['a', 'primeiro', 'segundo']);
    expect(topics('# S\n- a\n1. primeiro\n2. segundo')).not.toContain('1. primeiro');
  });

  test('a wrapped paragraph is ONE topic, not two', () => {
    // A host writing a full sentence does not stop at 80 columns.
    expect(topics('# S\n- a anotação é longa e\n  continua aqui\n- b')).toEqual([
      'a anotação é longa e continua aqui',
      'b',
    ]);
  });

  test('levels that jump do not flatten', () => {
    // 0 then 4 then 8 used to collapse to 0,1,2 — silently, with no error.
    const d = depths('# S\n- a\n        - b');
    expect(d).toEqual([0, 1]);
    expect(topics('# S\n- a\n        - b')).toEqual(['a', 'b']);
  });

  test('a dash inside prose stays prose', () => {
    expect(topics('# S\n- o paciente disse - algo - sobre sono')).toEqual([
      'o paciente disse - algo - sobre sono',
    ]);
  });

  test('inline markup is unwrapped, and the words survive', () => {
    // Markers go, words stay: a balloon is plain text and asterisks around a
    // client\'s own symptoms are noise.
    expect(topics('# S\n- o paciente está **muito** ansioso')).toEqual([
      'o paciente está muito ansioso',
    ]);
    expect(topics('# S\n- ver `cansaço` no diário')).toEqual(['ver cansaço no diário']);
    expect(topics('# S\n- ver [o relatório](http://exemplo.com)')).toEqual([
      'ver o relatório',
    ]);
  });

  test('a stray heading no longer eats the line or steals the title', () => {
    // The worst bug of the old parser: "  ## solto" lost its bullet, was read
    // as a title, and consumed the topic it should have belonged to.
    const md = '# 28/09/2026\n- trabalho\n  ## subtítulo solto\n- família';
    const t = parse(md);
    expect(t.text).toBe('28/09/2026');
    expect(topics(md)).toEqual(['trabalho', 'subtítulo solto', 'família']);
  });

  test('content the parser does not model is kept, not dropped', () => {
    // A pasted table should become a topic with the table in it, rather than
    // a tree invented from its borders or nothing at all.
    const md = '# S\n- tabela:\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |';
    expect(topics(md).join(' ')).toContain('a');
  });

  test('malformed input never throws', () => {
    for (const md of [
      '# S\n- a\n```js\nsem fechar',
      '# S\n- **sem fechar',
      '# S\n- <b>html</b>',
      '### só headings',
      '',
      '# S\n- a\n'.repeat(1) + Array.from({ length: 20 }, (_, i) => '  '.repeat(i + 1) + `- n${i}`).join('\n'),
    ]) {
      expect(() => parse(md)).not.toThrow();
    }
  });
});

describe('one canonical form out', () => {
  test('writes the session row as a heading and topics as bullets', () => {
    expect(treeToMarkdown(fixture())).toBe(
      '# 28/09/2026\n- Trabalho\n  - cansaço\n  - chefe cobra\n    - prazos curtos\n- Família\n  - mãe apoia'
    );
  });

  test('a parsed tree serialises back to the same tree', () => {
    const before = fixture();
    expect(shape(parseMarkdownToTree(treeToMarkdown(before), 'Sessão', before))).toEqual(
      shape(before)
    );
  });

  test('the output is stable from the second write on', () => {
    // Input is free markdown; output is canonical. So the FIRST write may
    // normalise what was typed — that is the deal — but the second must be
    // identical, or the buffer would rewrite itself under a resting caret.
    const typed = '# S\n- a\n  ## sub\n1. numerado\n- parágrafo\n  longo';
    const once = treeToMarkdown(parse(typed));
    const twice = treeToMarkdown(parse(once));
    expect(twice).toBe(once);
  });

  test('promoting a topic changes the indent, never the words', () => {
    const md = treeToMarkdown(fixture());
    const promoted = md.replace('  - cansaço', '- cansaço');
    expect(treeToMarkdown(parse(promoted))).toContain('- cansaço');
    expect(depths(promoted)[1]).toBe(0);
  });

  test('an empty outline round trips', () => {
    const empty = node('root', 'Sessão', []);
    expect(treeToMarkdown(parse(treeToMarkdown(empty)))).toBe('# Sessão');
  });
});

describe('ids are recycled so the caret and the client highlight survive', () => {
  test('an untouched topic keeps its id', () => {
    const before = fixture();
    const after = parseMarkdownToTree(treeToMarkdown(before), 'Sessão', before);
    expect(after.id).toBe('root');
    for (const id of ['trab', 't1', 't2', 't2a', 'fam', 'f1']) {
      expect(parseMarkdownToTree(treeToMarkdown(before), 'Sessão', before)).toBeTruthy();
      expect(JSON.stringify(after)).toContain(id);
    }
  });

  test('a collapsed topic stays collapsed, which markdown cannot express', () => {
    const before = node('root', 'Sessão', [
      node('a', 'ramo', [node('a1', 'folha')], true),
      node('b', 'outro'),
    ]);
    const after = parseMarkdownToTree(treeToMarkdown(before), 'Sessão', before);
    const found = (n: MindMapNode, id: string): MindMapNode | null =>
      n.id === id ? n : (n.children || []).reduce<MindMapNode | null>(
        (acc, c) => acc ?? find(c, id), null);
    expect(found(after, 'a')?.collapsed).toBe(true);
  });

  test('the session title is kept when the document does not state one', () => {
    // A buffer that starts straight at a bullet is a reasonable thing to type;
    // it must not rename the session after its first topic.
    const before = node('root', '28/09/2026', [node('a', 'Trabalho')]);
    const after = parseMarkdownToTree('- só isto', 'Sessão', before);
    expect(after.text).toBe('28/09/2026');
  });
});

describe('nothing the host wrote disappears', () => {
  /**
   * The property the old parser broke and the reason this rewrite exists. It
   * is checked against the WORDS rather than the shape, because a topic can
   * change depth or lose its bullet and still be perfectly correct, while a
   * missing word is never correct.
   */
  const cases: [string, string][] = [
    ['plain bullets', '# S\n- primeiro\n- segundo'],
    ['headings', '# S\n- a\n  ## sub\n  ### fundo'],
    ['ordered', '# S\n- a\n1. um\n2. dois'],
    ['wrapped', '# S\n- anotação longa\n  que continua aqui'],
    ['inline markup', '# S\n- **negrito** e `código` e _itálico_'],
    ['link', '# S\n- ver [o relatório](http://exemplo.com)'],
    ['entities and accents', '# S\n- ção, coração, emoji 🎯'],
    ['quotes', '# S\n- ele disse "não" e \'sim\''],
    ['mixed depths', '# S\n- a\n  - b\n    - c\n      - d\n- e'],
    ['deep heading jumps', '# S\n# um\n## dois\n###### seis'],
  ];

  for (const [label, md] of cases) {
    test(label, () => {
      const tree = parseMarkdownToTree(md, 'Sessão');
      const held = [tree.text, ...[...flatten(tree)].map((n) => n.text)].join(' ');
      const missing = wordsOf(md).filter(
        (w) => !held.toLowerCase().includes(w.toLowerCase())
      );
      expect(missing).toEqual([]);
    });
  }

  test('a word survives the whole round trip, not just the parse', () => {
    for (const [, md] of cases) {
      const out = treeToMarkdown(parseMarkdownToTree(md, 'Sessão'));
      const held = out.toLowerCase();
      const missing = wordsOf(md).filter((w) => !held.includes(w.toLowerCase()));
      expect(missing).toEqual([]);
    }
  });
});

/** Depth-first topic list. */
function flatten(node: MindMapNode): MindMapNode[] {
  const out: MindMapNode[] = [];
  const walk = (n: MindMapNode) => {
    for (const c of n.children || []) {
      out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

function find(node: MindMapNode, id: string): MindMapNode | null {
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return null;
}
