import type { Block, Cell, Inline, ListItem, Marks } from './model.ts';

/** The washed blocks as HTML. Only these elements and attributes are ever written. */
export function serialize(blocks: Block[]): string {
  return blocks.map(block).join('\n');
}

function block(b: Block): string {
  switch (b.kind) {
    case 'para':
      return `<${b.tag}>${inlines(b.inlines) || '<br>'}</${b.tag}>`;
    case 'pre':
      return `<pre>${text(b.text)}</pre>`;
    case 'hr':
      return '<hr>';
    case 'quote':
      return `<blockquote>${b.blocks.map(block).join('')}</blockquote>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.start !== undefined ? ` start="${b.start}"` : '';
      return `<${tag}${start}>${b.items.map(item).join('')}</${tag}>`;
    }
    case 'table':
      return `<table><tbody>${b.rows.map((row) => `<tr>${row.map(cell).join('')}</tr>`).join('')}</tbody></table>`;
    case 'item':
      // Gathered into lists before this runs.
      return b.blocks.map(block).join('');
  }
}

function item(i: ListItem): string {
  const checked = i.checked !== undefined ? ` data-checked="${i.checked}"` : '';
  return `<li${checked}>${content(i.blocks, true)}</li>`;
}

function cell(c: Cell): string {
  const tag = c.header ? 'th' : 'td';
  const colspan = c.colspan > 1 ? ` colspan="${c.colspan}"` : '';
  const rowspan = c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : '';
  return `<${tag}${colspan}${rowspan}>${content(c.blocks, false)}</${tag}>`;
}

/**
 * The inside of a list item or table cell. A single paragraph is written without its <p>, and so
 * is a list item's first paragraph when only nested lists follow it: `<li>text<ul>…</ul></li>`.
 */
function content(blocks: Block[], listItem: boolean): string {
  const [first, ...rest] = blocks;
  if (
    first?.kind === 'para' &&
    first.tag === 'p' &&
    (rest.length === 0 || (listItem && rest.every((b) => b.kind === 'list')))
  ) {
    return inlines(first.inlines) + rest.map(block).join('');
  }
  return blocks.map(block).join('');
}

const ORDER = ['href', 'bold', 'italic', 'underline', 'strike', 'code', 'sub', 'sup'] as const;
const TAGS: Record<(typeof ORDER)[number], string> = {
  href: 'a',
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
  sub: 'sub',
  sup: 'sup',
};

interface Open {
  id: string;
  close: string;
}

/** Formatting as properly nested tags, always in the same order, reopened only where it changes. */
function inlines(xs: Inline[]): string {
  let html = '';
  const open: Open[] = [];
  for (const x of xs) {
    if (x.kind !== 'br') {
      const wanted = tagsFor(x.marks);
      let same = 0;
      while (same < open.length && same < wanted.length && open[same]!.id === wanted[same]!.id) same++;
      while (open.length > same) html += open.pop()!.close;
      for (const w of wanted.slice(same)) {
        html += w.open;
        open.push(w);
      }
    }
    if (x.kind === 'text') html += text(x.text);
    else if (x.kind === 'br') html += '<br>';
    else html += `<img src="${attr(x.src)}" alt="${attr(x.alt)}">`;
  }
  while (open.length) html += open.pop()!.close;
  return html;
}

function tagsFor(marks: Marks): (Open & { open: string })[] {
  const out: (Open & { open: string })[] = [];
  for (const key of ORDER) {
    if (key === 'href') {
      if (marks.href) out.push({ id: `a ${marks.href}`, open: `<a href="${attr(marks.href)}">`, close: '</a>' });
    } else if (marks[key] && !(key === 'sub' && marks.sup)) {
      const tag = TAGS[key];
      out.push({ id: tag, open: `<${tag}>`, close: `</${tag}>` });
    }
  }
  return out;
}

function text(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(s: string): string {
  return text(s).replace(/"/g, '&quot;');
}
