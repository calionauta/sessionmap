import { describe, expect, test } from 'bun:test';
import {
  parseMarkdownToTree,
  treeToMarkdown,
  subtreeToMarkdown,
  normalizeOutline,
  flattenTree,
  findNodeById,
  isLiftChord,
} from './tree';
import { MindMapNode } from '../types';

const node = (
  id: string,
  text: string,
  children: MindMapNode[] = [],
  collapsed = false
): MindMapNode => ({ id, text, children, collapsed });

const fixture = (): MindMapNode =>
  node('root', '28/09/2026 14:08', [
    node('trab', 'Trabalho', [
      node('t1', 'cansaço no fim do dia'),
      node('t2', 'chefe cobra prazos curtos', [node('t2a', 'já fez 3 madrugadas')]),
    ]),
    node('fam', 'Família', [node('f1', 'mãe apoia e escuta')]),
  ]);

/** Structure without ids or text — the shape that must survive a round trip. */
function shape(n: MindMapNode): unknown {
  return {
    text: n.text,
    children: (n.children || []).map(shape),
  };
}

describe('markdown round trip', () => {
  test('writes the session row as a heading and topics as bullets', () => {
    const md = treeToMarkdown(fixture());
    expect(md.split('\n')[0]).toBe('# 28/09/2026 14:08');
    expect(md).toContain('- Trabalho');
    expect(md).toContain('  - cansaço no fim do dia');
    expect(md).toContain('    - já fez 3 madrugadas');
  });

  test('parsing the output reproduces the tree exactly', () => {
    const before = fixture();
    const after = parseMarkdownToTree(treeToMarkdown(before), before.text);
    expect(shape(after)).toEqual(shape(before));
  });

  test('a round trip is stable: a second pass changes nothing', () => {
    const once = treeToMarkdown(fixture());
    const twice = treeToMarkdown(parseMarkdownToTree(once));
    expect(twice).toBe(once);
  });

  test('the depth lives in the indent, never in the heading level', () => {
    // A heading is bound to its level, so promoting a topic would rewrite its
    // text. Indented bullets hold the depth in whitespace and the words never
    // change when the level does.
    const md = treeToMarkdown(fixture());
    const topicLines = md.split('\n').slice(1);
    expect(topicLines.every((l) => l.trimStart().startsWith('- '))).toBe(true);
    // Only the session row carries a "#".
    expect(md.split('\n').filter((l) => l.startsWith('#')).length).toBe(1);
  });

  test('a re-indented line changes the depth without changing the words', () => {
    const md = treeToMarkdown(fixture());
    // Promote "cansaço" one level.
    const promoted = md.replace('  - cansaço no fim do dia', '- cansaço no fim do dia');
    const tree = parseMarkdownToTree(promoted, 'x');
    // A parse with no previous tree makes fresh ids, so the topic is found by
    // its text — which is the point: the words are what survive the re-indent.
    const item = flattenTree(tree).find((i) => i.text === 'cansaço no fim do dia');
    expect(item?.level).toBe(1);
  });

  test('text containing markdown punctuation is not mistaken for structure', () => {
    const root = node('root', 'Sessão', [
      node('a', 'usar # e - no texto'),
      node('b', '2 x 4 = 8'),
    ]);
    const tree = parseMarkdownToTree(treeToMarkdown(root), 'Sessão');
    expect(shape(tree)).toEqual(shape(root));
  });

  test('an empty outline round trips', () => {
    const root = node('root', 'Sessão', []);
    const parsed = parseMarkdownToTree(treeToMarkdown(root), 'Sessão');
    expect(parsed.text).toBe('Sessão');
    expect(parsed.children).toHaveLength(0);
  });

  test('a parsed tree never needs normalizeOutline to become valid', () => {
    // The invariant runs on every update. If a parse could produce a blank
    // node with children, the outline would dissolve it a frame later and the
    // text would appear to undo itself.
    for (const md of [
      treeToMarkdown(fixture()),
      '# S\n- a\n   - b\n- c',
      '# S\n- a\n\n\n- b',
    ]) {
      const parsed = parseMarkdownToTree(md, 'S');
      expect(normalizeOutline(parsed)).toBe(parsed);
    }
  });

  test('an odd indent is normalised rather than rejected', () => {
    // Three spaces is not a whole level, but refusing it would lose the
    // user's words. It lands somewhere, and the words are intact.
    const tree = parseMarkdownToTree('# S\n- a\n   - b', 'S');
    expect(flattenTree(tree).find((i) => i.text === 'b')).toBeTruthy();
  });
});

describe('id recycling across a re-parse', () => {
  test('an untouched topic keeps its id', () => {
    // The outline keys its rows by id, so a fresh id per keystroke would
    // remount the list, drop the caret, and leave the client's highlight
    // unable to resolve.
    const before = fixture();
    const after = parseMarkdownToTree(treeToMarkdown(before), before.text, before);
    const beforeIds = flattenTree(before).map((i) => i.id);
    const afterIds = flattenTree(after).map((i) => i.id);
    expect(afterIds).toEqual(beforeIds);
  });

  test('the session row keeps its id too', () => {
    const before = fixture();
    const after = parseMarkdownToTree(treeToMarkdown(before), before.text, before);
    expect(after.id).toBe(before.id);
  });

  test('an edited topic gets a new id, and its neighbours do not', () => {
    const before = fixture();
    const md = treeToMarkdown(before).replace('cansaço no fim do dia', 'cansaço sempre');
    const after = parseMarkdownToTree(md, before.text, before);
    // The edited topic's own id changes, because its content changed. Its
    // neighbours keep theirs, which is what stops the list remounting around
    // the row the therapist is typing in.
    const edited = flattenTree(after).find((i) => i.text === 'cansaço sempre');
    expect(edited).toBeTruthy();
    expect(edited?.id).not.toBe('t1');
    expect(findNodeById(after, 't2')?.id).toBe('t2');
    expect(findNodeById(after, 't2a')?.id).toBe('t2a');
    expect(findNodeById(after, 'fam')?.id).toBe('fam');
    expect(findNodeById(after, 'f1')?.id).toBe('f1');
  });

  test('a collapsed topic stays collapsed, which markdown cannot express', () => {
    const before = node('root', 'Sessão', [
      node('a', 'ramo', [node('a1', 'folha')], true),
      node('b', 'outro'),
    ]);
    const after = parseMarkdownToTree(treeToMarkdown(before), before.text, before);
    expect(findNodeById(after, 'a')?.collapsed).toBe(true);
  });

  test('with no previous tree, ids are fresh and nothing throws', () => {
    const parsed = parseMarkdownToTree('# S\n- a\n  - b');
    expect(parsed.children).toHaveLength(1);
    expect(parsed.children[0].children).toHaveLength(1);
  });
});

describe('subtreeToMarkdown — cutting a branch', () => {
  test('a branch is already a pasteable block', () => {
    // This is what makes copy/move work with no code: selecting a branch in
    // the buffer yields text that parses back to the same branch.
    const md = subtreeToMarkdown(findNodeById(fixture(), 't2')!);
    expect(md).toBe('- chefe cobra prazos curtos\n  - já fez 3 madrugadas');
  });

  test('a copied branch pastes back as the same branch', () => {
    const block = subtreeToMarkdown(findNodeById(fixture(), 't2')!);
    const pasted = parseMarkdownToTree(`# Nova\n- outro\n${block}`, 'Nova');
    // A paste is new text with no previous tree, so ids are fresh; the branch
    // is identified by its content and its shape.
    const moved = pasted.children.find((c) => c.text === 'chefe cobra prazos curtos');
    expect(moved?.children[0].text).toBe('já fez 3 madrugadas');
  });

  test('a leaf is a single line', () => {
    expect(subtreeToMarkdown(findNodeById(fixture(), 'f1')!)).toBe('- mãe apoia e escuta');
  });
});

describe('isLiftChord', () => {
  const chord = (o: Record<string, unknown>) =>
    isLiftChord({
      key: 'm',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...o,
    } as never);

  test('accepts the two-modifier forms', () => {
    expect(chord({ ctrlKey: true, shiftKey: true })).toBe(true);
    expect(chord({ metaKey: true, shiftKey: true })).toBe(true);
    expect(chord({ altKey: true, shiftKey: true })).toBe(true);
  });

  test('rejects the chords macOS claims, and the bare letter', () => {
    expect(chord({ metaKey: true })).toBe(false);
    expect(chord({ altKey: true })).toBe(false);
    expect(chord({})).toBe(false);
  });

  test('rejects three modifiers at once', () => {
    expect(chord({ ctrlKey: true, metaKey: true, shiftKey: true })).toBe(false);
  });
});
