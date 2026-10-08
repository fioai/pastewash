import type { Block, Inline, Marks } from './model.ts';

/**
 * Collapses whitespace the way a browser would show it, merges runs with the same formatting, and
 * drops what's left empty: paragraphs (unless they're to be kept), list items, quotes, lists.
 */
export function finish(blocks: Block[], keepEmptyParagraphs: boolean): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'para': {
        const inlines = normalizeInlines(block.inlines);
        if (inlines.length || (keepEmptyParagraphs && block.tag === 'p')) out.push({ ...block, inlines });
        break;
      }
      case 'list': {
        const items = block.items
          .map((item) => ({ ...item, blocks: finish(item.blocks, false) }))
          .filter((item) => item.blocks.length);
        if (items.length) out.push({ ...block, items });
        break;
      }
      case 'quote': {
        const inner = finish(block.blocks, keepEmptyParagraphs);
        if (inner.length) out.push({ ...block, blocks: inner });
        break;
      }
      case 'table':
        out.push({
          ...block,
          rows: block.rows.map((row) => row.map((cell) => ({ ...cell, blocks: finish(cell.blocks, false) }))),
        });
        break;
      case 'item':
        // Gathered into lists before this runs.
        out.push(...finish(block.blocks, keepEmptyParagraphs));
        break;
      default:
        out.push(block);
    }
  }
  return out;
}

const SPACE = /[\t\n\r\f  ]+/g;

export function normalizeInlines(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  // At the start of a block, and after a space or a line break, a space doesn't show.
  let afterSpace = true;
  for (const x of inlines) {
    if (x.kind === 'text') {
      let text = x.text.replace(SPACE, ' ');
      if (afterSpace && text.startsWith(' ')) text = text.slice(1);
      if (!text) continue;
      afterSpace = text.endsWith(' ');
      out.push({ ...x, text });
    } else if (x.kind === 'br') {
      trimEnd(out);
      out.push(x);
      afterSpace = true;
    } else {
      out.push(x);
      afterSpace = false;
    }
  }
  trimEnd(out);
  while (out[0]?.kind === 'br') out.shift();
  while (out[out.length - 1]?.kind === 'br') out.pop();

  // A space between two runs takes only the formatting they share, so that "<b>a</b> <i>b</i>"
  // doesn't put the space in either.
  for (let i = 0; i < out.length; i++) {
    const x = out[i]!;
    if (x.kind !== 'text' || x.text.trim()) continue;
    const before = neighbourMarks(out, i, -1);
    const after = neighbourMarks(out, i, 1);
    out[i] = { ...x, marks: shared(before, after) };
  }

  // Merge neighbouring runs with the same formatting.
  const merged: Inline[] = [];
  for (const x of out) {
    const last = merged[merged.length - 1];
    if (x.kind === 'text' && last?.kind === 'text' && sameMarks(last.marks, x.marks)) {
      merged[merged.length - 1] = { ...last, text: last.text + x.text };
    } else {
      merged.push(x);
    }
  }
  return merged;
}

function trimEnd(out: Inline[]): void {
  for (;;) {
    const last = out[out.length - 1];
    if (last?.kind !== 'text' || !last.text.endsWith(' ')) return;
    const text = last.text.slice(0, -1);
    if (text) {
      out[out.length - 1] = { ...last, text };
      return;
    }
    out.pop();
  }
}

function neighbourMarks(out: Inline[], i: number, step: 1 | -1): Marks {
  const x = out[i + step];
  return x && x.kind !== 'br' ? x.marks : {};
}

const KEYS = ['bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'code'] as const;

function shared(a: Marks, b: Marks): Marks {
  const out: Marks = {};
  for (const k of KEYS) if (a[k] && b[k]) out[k] = true;
  if (a.href && a.href === b.href) out.href = a.href;
  return out;
}

export function sameMarks(a: Marks, b: Marks): boolean {
  return KEYS.every((k) => !a[k] === !b[k]) && (a.href ?? '') === (b.href ?? '');
}
