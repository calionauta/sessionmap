/**
 * Markdown in, outline tree out.
 *
 * The parsing is marked's — a complete CommonMark implementation, 13KB
 * gzipped and dependency-free — because the version this file replaced was a
 * hand-rolled subset that read only "-", indentation, and a "#" on the first
 * line. It silently degraded everything else: a "##" became the literal text
 * "- ## sub", "1." became "- 1. first", a wrapped paragraph became two
 * topics, and a heading on a line of its own could take the session title
 * with it. That last one lost content, which is the only kind of bug worth
 * building a whole replacement for.
 *
 * What stays here is the part marked cannot do: mapping its tokens onto this
 * app's tree, and the guarantee that the buffer round-trips without
 * corrupting what was typed.
 *
 * THE CANONICAL FORM. Input is free markdown — bullets, ordered lists,
 * headings, a paragraph wrapped over two lines. Output is always indented
 * bullets. So "## sub" is accepted and understood, and then written back as
 * "  - sub": promoting a topic never rewrites its words, and the buffer is
 * stable from the second write onward, which is the property that matters.
 * Re-emitting the heading a user happened to type would mean editing the line
 * to change the depth, which is the one thing an outliner must not do.
 */
import { marked } from 'marked';
import { MindMapNode } from '../types';

export interface ParseOptions {
  /** Shown when the document has no heading of its own. */
  defaultTitle?: string;
  /**
   * The tree as it was, used to recycle ids.
   *
   * Without it every node gets a fresh id on every parse, and since the
   * outline keys its rows by id that remounts the list, drops the caret, and
   * leaves the highlight the client window is following unable to resolve.
   */
  previousRoot?: MindMapNode | null;
  /** Supplied by the caller so node ids stay unique across the app. */
  generateId: () => string;
}

/** A topic found in the document, before it is attached to a parent. */
interface FlatTopic {
  text: string;
  level: number;
}

const MAX_HEADING_LEVEL = 6;

/**
 * The text of an inline run, with the markup taken out.
 *
 * `**bold**` becomes "bold" and `[label](url)` becomes "label". The words
 * survive; only the markers go, because a balloon is plain text and showing a
 * client asterisks around their own symptoms is noise.
 *
 * A leaf token contributes its own `text` and nothing below it. Recursing
 * unconditionally as well is what duplicated a link into "relatórioo
 * relatório": a link's `text` is already its label, and its child tokens hold
 * the label again. The URL is deliberately not included — a balloon is not a
 * place to read a URL, and it would only be re-serialised as noise.
 */
function inlineText(tokens: unknown): string {
  if (!Array.isArray(tokens)) return '';
  let out = '';
  for (const t of tokens as { text?: string; tokens?: unknown; type?: string }[]) {
    if (t.type === 'link' || t.type === 'image') {
      // A link's own text IS the label; its children repeat it.
      if (typeof t.text === 'string') out += t.text;
      continue;
    }
    if (typeof t.text === 'string') out += t.text;
    else if (t.tokens) out += inlineText(t.tokens);
  }
  return out;
}

/** Whitespace in the text is the balloon's business, not the parser's. */
function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Strips inline markers from a run marked did not tokenise.
 *
 * Used only on the fallback path, where a blank line or a heading further down
 * an item made marked treat the whole thing as opaque text. The words are
 * untouched — only the markers go, exactly as inlineText does — so the result
 * is the same as if the inline tokens had been available.
 */
function unwrapInline(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/**
 * Flattens marked's token tree into topics at absolute depths.
 *
 * Walks the document, tracking the depth a heading sets and the depth a list
 * nests at, so a "##" inside a bullet lands where the user meant it — under
 * the bullet, not at the top of the document. That mixing is the whole reason
 * a real parser is used: a heading's level is relative to the list it sits
 * in, and a line-based reader cannot know that.
 */
/**
 * True for a line that begins a nested bullet inside a paragraph's text.
 *
 * marked folds a deeply-indented "- x" back into the parent item's TEXT (it
 * needs two spaces of marker width, and a 2-space indent is not enough), so
 * "- a" followed by "        - b" arrives as one paragraph reading "a\n  - b".
 * Reading that back as a single topic would be wrong and, worse, would swallow
 * the second line — this is the shape that lost a topic in the version before
 * marked, so it is split back out here.
 */
const NESTED_BULLET = /^\s*[-*+]\s+(?=\S)/;

/**
 * The same, for a heading that marked folded into the item's text.
 *
 * A "#### x" sitting inside a list item is separated into its own token only
 * at the item's leading edge; further in, it stays in the text. Left alone the
 * hashes are stored as literal content, and the NEXT parse strips them — so
 * the buffer changes a second time under a resting caret, which is the one
 * thing the fixed-point guarantee exists to prevent.
 */
const NESTED_HEADING = /^\s*(#{1,6})\s+(?=\S)/;

function collect(
  tokens: unknown[],
  base: number,
  out: FlatTopic[],
  state: { skippedTitle: boolean }
): void {
  if (!Array.isArray(tokens)) return;

  for (const token of tokens as {
    type: string;
    depth?: number;
    text?: string;
    raw?: string;
    ordered?: boolean;
    items?: unknown[];
    tokens?: unknown[];
  }[]) {
    switch (token.type) {
      case 'space':
        break;

      case 'heading': {
        const depth = Math.min(token.depth ?? 1, MAX_HEADING_LEVEL);
        // The document's own title, taken by the caller, is not a topic.
        if (depth <= 1) {
          if (!state.skippedTitle) {
            state.skippedTitle = true;
            break;
          }
          if (tidy(token.text ?? '')) {
            out.push({ text: tidy(token.text ?? ''), level: base });
          }
        } else {
          out.push({ text: tidy(token.text ?? ''), level: base + depth - 1 });
        }
        break;
      }

      case 'list': {
        for (const item of token.items ?? []) {
          collect([item], base + 1, out, state);
        }
        break;
      }

      case 'list_item': {
        /*
         * A list item is one topic, and everything else in it is BELOW it.
         *
         * The item's tokens are a sequence: its own text first as a "text"
         * token, then any heading or nested list as SIBLINGS of that text,
         * already carrying their own heading level. So the item is walked as
         * an ordered stream — the leading text is the topic, and each block
         * after it recurses one level deeper.
         *
         * One wrinkle marked does not separate: a deeply indented "- b" that
         * lacks the two spaces of marker width gets folded back into the
         * PARENT's text as "a\n  - b". Left alone that reads as one topic and
         * the second line disappears, which is the loss this whole parser
         * exists to prevent, so the folded bullets are split back out here.
         */
        const kids = (token.tokens ?? []) as {
          type: string;
          text?: string;
          tokens?: unknown[];
        }[];

        // The topic's own words, gathered from its leading text runs.
        const parts: string[] = [];
        // Any folded blocks found in those runs, recovered as children.
        const folded: { text: string; level: number }[] = [];
        let i = 0;

        /*
         * "text" in a tight item, "paragraph" in a loose one — a list with a
         * blank line between its items. They carry the item's own words, and
         * the difference is invisible to a reader, so both are read as the
         * topic's text here. Only the loose form was being missed, and the
         * symptom was a topic whose stored text still had "**bold**" in it,
         * stripped only by the next parse — the buffer changing twice.
         */
        const isOwnText = (t: string) => t === 'text' || t === 'paragraph';

        for (; i < kids.length && isOwnText(kids[i].type); i++) {
          const raw = String(kids[i].text ?? '');
          const lines = raw.split('\n');
          // The first line that carries structure of its own — a bullet or a
          // heading — ends this topic and begins its children.
          const firstBlock = lines.findIndex(
            (l) => NESTED_BULLET.test(l) || NESTED_HEADING.test(l)
          );

          if (firstBlock === -1) {
            // A wrapped paragraph: every line belongs to this one topic.
            //
            // Falls back to the RAW text when there are no inline tokens,
            // which happens when a heading or a blank line further down
            // made marked treat the whole item as one opaque block. The raw
            // still carries "**bold**", and storing that would mean the next
            // parse strips it — the buffer changing twice under a resting
            // caret.
            const inlined = inlineText(kids[i].tokens ?? []);
            const value = tidy(inlined || unwrapInline(raw));
            if (value) parts.push(value);
            continue;
          }

          // Everything before the first block is this topic.
          const head = tidy(unwrapInline(lines.slice(0, firstBlock).join(' ')));
          if (head) parts.push(head);
          for (const line of lines.slice(firstBlock)) {
            const heading = line.match(NESTED_HEADING);
            if (heading) {
              const text = tidy(line.replace(NESTED_HEADING, ''));
              if (text) folded.push({ text, level: base + heading[1].length - 1 });
              continue;
            }
            const text = tidy(
              unwrapInline(line.replace(NESTED_BULLET, '').replace(/^\s*\d+\.\s+/, ''))
            );
            if (text) folded.push({ text, level: base + 1 });
          }
          // Stop reading text runs: a sibling "text" token would repeat what
          // has already been read, since marked emits one per inline source.
          break;
        }

        if (parts.length > 0) {
          out.push({ text: parts.join(' '), level: base });
        }
        for (const block of folded) {
          out.push({ text: block.text, level: block.level });
        }

        // Blocks after the topic — a heading or a real nested list. Reached
        // whenever a text run ended the loop early, so the item's own content
        // is never skipped just because one of its lines looked like a bullet.
        for (; i < kids.length; i++) {
          if (isOwnText(kids[i].type)) continue;
          collect([kids[i]], base + 1, out, state);
        }
        break;
      }

      case 'paragraph': {
        // A paragraph outside any list is a topic at the level in force.
        const value = tidy(token.text ?? '');
        if (value) out.push({ text: value, level: base });
        break;
      }

      default: {
        /*
         * An indented block is CODE to any CommonMark parser, even when what
         * it holds is a list. A buffer where every line sits under the session
         * heading — which is what a deep outline looks like — would therefore
         * arrive as one opaque code blob, and its topics would become the blob.
         * So a code block whose lines carry bullets is read as the list it
         * obviously is, at the depth in force.
         */
        if (token.type === 'code' || token.type === 'fences') {
          const raw = String(token.raw ?? token.text ?? '');
          const lines = raw.split('\n').filter((l) => l.trim() !== '');
          // A block that carries EITHER bullets or headings is a list or a
          // heading that CommonMark read as code, because it sits four or more
          // spaces in. Both are structure the user meant; only real code —
          // a block with neither — stays literal.
          const structured = lines.some(
            (l) => NESTED_BULLET.test(l) || NESTED_HEADING.test(l) || /^\s*\d+\.\s+/.test(l)
          );
          if (structured) {
            let inner = Number.POSITIVE_INFINITY;
            for (const line of lines) {
              inner = Math.min(inner, line.match(/^\s*/)?.[0].length ?? 0);
            }
            if (!Number.isFinite(inner)) inner = 0;
            for (const line of lines) {
              const body = line.slice(inner);
              /*
               * A heading inside the block is a heading, not a topic whose
               * text happens to start with "#". Leaving the hashes in would
               * store them as literal text and the NEXT pass would strip
               * them — the buffer changing twice under a resting caret,
               * which is the failure the fixed-point test exists to catch.
               */
              const heading = body.match(/^\s*(#{1,6})\s+(?=\S)/);
              if (heading) {
                const text = tidy(body.replace(/^\s*#{1,6}\s+/, ''));
                if (text) {
                  // The heading's own level, plus how far into the block it
                  // sits — a "####" under a bullet is a child, not a root.
                  const indentLevels = Math.floor(
                    ((body.match(/^\s*/)?.[0].length ?? 0) - inner) / 2
                  );
                  out.push({ text, level: base + heading[1].length - 1 + indentLevels });
                }
                continue;
              }
              // Unwrap inline markup here too: a code block is opaque to the
              // inline tokenizer, so its "**bold**" would otherwise be stored
              // WITH the markers.
              const stripped = tidy(
                unwrapInline(
                  body.replace(NESTED_BULLET, '').replace(/^\s*\d+\.\s+/, '')
                )
              );
              if (stripped) out.push({ text: stripped, level: base + Math.floor(inner / 2) });
            }
            break;
          }
        }
        /*
         * Everything else — tables, blockquotes, raw HTML, genuine code — is
         * kept as its literal source instead of being dropped or promoted to
         * structure. A therapist pasting a table should get a topic with the
         * table in it, not a tree invented out of its borders, and never
         * nothing at all.
         */
        const raw = tidy(token.text ?? token.raw ?? '');
        if (raw) out.push({ text: raw, level: base });
        break;
      }
    }
  }
}

/**
 * The previous tree in document order — the same order the markdown is
 * written in, so index i on both sides is the same topic. Index 0 is the
 * session row, which the caller owns, so the topics start at 1.
 */
function inDocumentOrder(root: MindMapNode): { id: string; text: string; collapsed: boolean }[] {
  const out: { id: string; text: string; collapsed: boolean }[] = [];
  const walk = (n: MindMapNode) => {
    out.push({ id: n.id, text: n.text, collapsed: Boolean(n.collapsed) });
    for (const child of n.children || []) walk(child);
  };
  walk(root);
  return out;
}

/**
 * Parses markdown into a tree.
 *
 * The session title is the first "# heading" in the document, the way a
 * document reads. Failing that — a buffer that starts straight at a bullet,
 * which is a perfectly reasonable thing to type — the previous title is kept
 * rather than replaced by the first topic's words, which is what the old
 * parser did and why a stray "## x" could rename the whole session.
 */
export function parseMarkdown(
  text: string,
  options: ParseOptions
): MindMapNode {
  const { defaultTitle = 'Sessão', previousRoot, generateId } = options;

  const source = (text ?? '').replace(/\r\n?/g, '\n');
  const tokens = marked.lexer(source);

  let title = '';
  // The document's own title is the first heading, and only a heading of
  // level 1. Anything before it is ignored for naming purposes.
  for (const token of tokens as { type: string; depth?: number; text?: string }[]) {
    if (token.type === 'heading' && (token.depth ?? 1) === 1) {
      title = tidy(token.text ?? '');
      break;
    }
  }

  const topics: FlatTopic[] = [];
  collect(tokens, 0, topics, { skippedTitle: false });

  const previous = previousRoot ? inDocumentOrder(previousRoot) : [];
  const root: MindMapNode = {
    id: previousRoot?.id ?? generateId(),
    // Keep the current title when the document does not state one.
    text: title || previousRoot?.text || defaultTitle,
    children: [],
  };

  // Build with a stack, so a heading or a bullet that jumps several levels
  // deep lands under the nearest shallower ancestor instead of flattening.
  // "0 then 4 then 8" used to collapse to 0,1,2 — silently, with no error.
  const stack: { node: MindMapNode; level: number }[] = [{ node: root, level: -1 }];
  let position = 0;

  for (const topic of topics) {
    if (!topic.text) continue;
    position += 1;
    const prior = previous[position];
    // Same slot, same words: this topic was not edited, so keep its identity
    // AND its collapsed state, which the markdown cannot express.
    const unchanged = prior !== undefined && prior.text === topic.text;

    const node: MindMapNode = {
      id: unchanged ? prior.id : generateId(),
      text: topic.text,
      collapsed: unchanged ? prior.collapsed : false,
      children: [],
    };

    while (stack.length > 1 && stack[stack.length - 1].level >= topic.level) {
      stack.pop();
    }
    stack[stack.length - 1].node.children.push(node);
    stack.push({ node, level: topic.level });
  }

  return root;
}

/**
 * The outline as markdown: the session row as a heading, every topic as an
 * indented bullet.
 *
 * This is the only writer, and it is deliberately boring — two spaces per
 * level. It is also the thing the round-trip test checks, so any change here
 * that makes the buffer rewrite itself is a bug by definition.
 */
export function treeToMarkdown(root: MindMapNode): string {
  const lines: string[] = [`# ${root.text || 'Sessão'}`];
  const walk = (node: MindMapNode, depth: number) => {
    for (const child of node.children || []) {
      lines.push(`${'  '.repeat(depth)}- ${child.text}`);
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join('\n');
}

/**
 * Every word the user typed, with markdown markers removed.
 *
 * The safety net for the buffer: compared against what the tree holds, it
 * answers "did anything the therapist wrote disappear?". It is deliberately
 * not used to BUILD the tree — marked does that — only to fail a test when
 * the two disagree.
 *
 * A link TARGET is not content. "[o relatório](http://exemplo.com)" carries
 * one word worth keeping and a URL that the outline intentionally drops, so
 * the URL is stripped before counting; otherwise every link in a document
 * would look like lost text.
 */
export function wordsOf(markdown: string): string[] {
  return (markdown ?? '')
    // Link targets first, keeping the label: [label](target) -> label.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`~>\[\]()|-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}
