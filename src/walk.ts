/**
 * Walks the parsed paste once, producing clean blocks. Formatting is worked out per text run from
 * tags and from CSS (inline styles and <style> rules); block structure from tags, with each source's
 * list dialect turned into flat list items that carry a level (see lists.ts).
 */

import { points, type Declarations, type Stylesheet } from './css.ts';
import type { Block, Cell, Inline, Item, Marks, Para, ParaTag } from './model.ts';
import type { Element, Node } from './tree.ts';
import type { ImageReport, Source } from './types.ts';

export interface Settings {
  keepEmptyParagraphs: boolean;
  images: 'keep' | 'drop';
  code: boolean;
  linkSchemes: ReadonlySet<string>;
  trackChanges: 'accept' | 'reject';
}

interface Context {
  marks: Marks;
}

/** Elements whose content is never wanted. VML (`v:*`) is handled separately. */
const SKIPPED = new Set([
  'applet', 'area', 'audio', 'button', 'canvas', 'col', 'colgroup', 'datalist', 'embed', 'frame',
  'frameset', 'head', 'iframe', 'link', 'map', 'math', 'meta', 'noscript', 'object', 'optgroup',
  'option', 'param', 'script', 'select', 'source', 'style', 'svg', 'template', 'textarea', 'title',
  'track', 'video', 'xml',
]);

/** Elements that end the paragraph before them and start a new one. */
const BLOCKS = new Set([
  'address', 'article', 'aside', 'center', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hgroup', 'legend', 'main', 'nav',
  'p', 'section', 'summary',
]);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const MONOSPACE = new Set([
  'andale mono', 'cascadia code', 'cascadia mono', 'consolas', 'courier', 'courier new',
  'fira code', 'ibm plex mono', 'inconsolata', 'lucida console', 'lucida sans typewriter', 'menlo',
  'monaco', 'monospace', 'sf mono', 'source code pro',
]);

/** Word's elements that hold comments and footnote separators rather than text. */
const WORD_NON_CONTENT = new Set([
  'comment-list', 'comment', 'footnote-separator', 'endnote-separator',
  'footnote-continuation-separator', 'endnote-continuation-separator',
]);

interface ListFrame {
  container: Block[];
  depth: number;
  ordered: boolean;
  key: string;
  start: number | undefined;
  first: boolean;
}

interface WordListInfo {
  level: number;
  key: string;
  ordered: boolean;
  start: number | undefined;
  /** Nodes that make up the marker (bullet or number) in Word's filtered HTML, to leave out. */
  skip: ReadonlySet<Node>;
}

export class Walker {
  readonly images: ImageReport[] = [];
  private readonly sheet: Stylesheet;
  private readonly source: Source;
  private readonly settings: Settings;
  private readonly stack: Block[][] = [[]];
  private para: Para | null = null;
  private lists: ListFrame[] = [];
  private readonly items: Item[] = [];
  private skip: ReadonlySet<Node> = new Set();
  private keys = 0;

  constructor(sheet: Stylesheet, source: Source, settings: Settings) {
    this.sheet = sheet;
    this.source = source;
    this.settings = settings;
  }

  /** The blocks so far, top level. */
  result(): Block[] {
    this.closePara();
    return this.stack[0]!;
  }

  walkChildren(nodes: readonly Node[], ctx: Context): void {
    for (const node of nodes) this.walk(node, ctx);
  }

  // --- The builder ---------------------------------------------------------------------------

  private get container(): Block[] {
    return this.stack[this.stack.length - 1]!;
  }

  private openPara(tag: ParaTag): void {
    this.closePara();
    this.para = { kind: 'para', tag, inlines: [] };
  }

  private closePara(): void {
    if (this.para) {
      this.container.push(this.para);
      this.para = null;
    }
  }

  private push(block: Block): void {
    this.closePara();
    this.container.push(block);
  }

  private enter(container: Block[]): void {
    this.closePara();
    this.stack.push(container);
  }

  private leave(): void {
    this.closePara();
    this.stack.pop();
  }

  private inline(x: Inline): void {
    if (!this.para) {
      // Whitespace between blocks (the source's line breaks and indentation) isn't a paragraph.
      if (x.kind === 'text' && !/[^\t\n\r\f  ]/.test(x.text)) return;
      if (x.kind === 'br') return;
      this.para = { kind: 'para', tag: 'p', inlines: [] };
    }
    this.para.inlines.push(x);
  }

  // --- Walking -------------------------------------------------------------------------------

  private walk(node: Node, ctx: Context): void {
    if (this.skip.has(node)) return;
    if (node.kind === 'text') {
      if (node.text) this.inline({ kind: 'text', text: node.text, marks: ctx.marks });
      return;
    }
    const el = node;
    const tag = el.tag;
    if (SKIPPED.has(tag) || tag.startsWith('v:')) return;
    const d = this.sheet.declared(el);
    if (isHidden(d) || this.isWordNonContent(el, d)) return;
    const change = this.trackedChange(el);
    if (change === 'drop') return;

    const inner: Context = { marks: change === 'keep' ? ctx.marks : this.marksFor(el, d, ctx.marks) };
    switch (tag) {
      case 'br':
        this.br();
        return;
      case 'img':
        this.image(el, inner.marks);
        return;
      case 'hr':
        this.push({ kind: 'hr' });
        return;
      case 'pre':
        this.pre(el);
        return;
      case 'ul':
      case 'ol':
        this.list(el, inner);
        return;
      case 'li':
        this.listItem(el, d, inner);
        return;
      case 'table':
        this.table(el, inner);
        return;
      case 'blockquote':
        this.quote(el, inner);
        return;
      case 'input':
        this.checkbox(el);
        return;
    }
    const heading = headingOf(el);
    if (heading) {
      this.openPara(heading);
      this.walkChildren(el.children, inner);
      this.closePara();
      return;
    }
    if (BLOCKS.has(tag)) {
      const word = this.wordListItem(el, d);
      if (word) {
        this.wordItem(el, word, inner);
        return;
      }
      if (tag === 'p' || tag === 'dt' || tag === 'dd') {
        this.openPara('p');
        this.walkChildren(el.children, inner);
        this.closePara();
      } else {
        this.closePara();
        this.walkChildren(el.children, inner);
        this.closePara();
      }
      return;
    }
    // Anything else (span, font, a, b, o:p, st1:place, …) is inline: only its formatting counts.
    this.walkChildren(el.children, inner);
  }

  private br(): void {
    if (this.para) {
      this.para.inlines.push({ kind: 'br' });
    } else if (this.settings.keepEmptyParagraphs) {
      // Google Docs marks an empty line between blocks with a lone <br>.
      this.push({ kind: 'para', tag: 'p', inlines: [] });
    }
  }

  private image(el: Element, marks: Marks): void {
    // Google Docs draws a checklist's boxes as images.
    if (el.attrs.get('aria-roledescription') === 'checkbox') return;
    const src = (el.attrs.get('src') ?? '').trim();
    if (!src) return;
    const alt = el.attrs.get('alt') ?? '';
    if (!/^(?:https?:|data:image\/)/i.test(src)) {
      this.images.push({ src, alt, kept: false, reason: 'unreachable' });
    } else if (this.settings.images === 'drop') {
      this.images.push({ src, alt, kept: false, reason: 'option' });
    } else {
      this.images.push({ src, alt, kept: true });
      this.inline({ kind: 'img', src, alt, marks });
    }
  }

  private pre(el: Element): void {
    // A parser drops the first newline after <pre>, so a leading one wouldn't survive a re-wash.
    const text = preText(el, this.sheet).replace(/^\n+|\n+$/g, '');
    if (text.trim()) this.push({ kind: 'pre', text });
  }

  private quote(el: Element, ctx: Context): void {
    const quote: Block = { kind: 'quote', blocks: [] };
    this.push(quote);
    this.isolated(quote.blocks, () => this.walkChildren(el.children, ctx));
  }

  /** Walks into a container of its own, where lists start afresh (a table cell, a quote). */
  private isolated(container: Block[], walk: () => void): void {
    const lists = this.lists;
    this.lists = [];
    this.enter(container);
    walk();
    this.leave();
    this.lists = lists;
  }

  private table(el: Element, ctx: Context): void {
    this.closePara();
    const rows: Cell[][] = [];
    const visit = (parent: Element) => {
      for (const child of parent.children) {
        if (child.kind !== 'element') continue;
        if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
          visit(child);
        } else if (child.tag === 'caption') {
          this.walk(child, ctx);
        } else if (child.tag === 'tr' && !isHidden(this.sheet.declared(child))) {
          const row: Cell[] = [];
          for (const c of child.children) {
            if (c.kind !== 'element' || (c.tag !== 'td' && c.tag !== 'th')) continue;
            const cd = this.sheet.declared(c);
            if (isHidden(cd)) continue;
            const cell: Cell = {
              header: c.tag === 'th',
              colspan: span(c.attrs.get('colspan')),
              rowspan: span(c.attrs.get('rowspan')),
              blocks: [],
            };
            const marks = this.marksFor(c, cd, ctx.marks);
            this.isolated(cell.blocks, () => this.walkChildren(c.children, { marks }));
            row.push(cell);
          }
          if (row.length) rows.push(row);
        }
      }
    };
    visit(el);
    if (rows.length) this.push({ kind: 'table', rows });
  }

  // --- Lists ---------------------------------------------------------------------------------

  /**
   * A <ul> or <ol>. Its items, and those of any list nested in it however deep, go into the
   * container the outermost list is in, each with its level; lists.ts nests them afterwards. That
   * way one algorithm handles real nesting, Google Docs' lists nested directly in lists, and Word
   * for the web's one-item lists.
   */
  private list(el: Element, ctx: Context): void {
    const parent = this.lists[this.lists.length - 1];
    const ordered = el.tag === 'ol';
    // Directly inside another list (Google Docs), its items join the outer list's items. Inside an
    // item's content (<li>Intro<ul>…</ul>Outro</li>), they stay there, in order, and are nested
    // from there.
    const flat = parent !== undefined && this.container === parent.container;
    const frame: ListFrame = {
      container: flat ? parent.container : this.container,
      depth: parent ? parent.depth + 1 : 1,
      ordered,
      // Only a list directly inside another is part of it; anywhere else it's a list of its own.
      key: flat ? parent.key : `list:${this.keys++}`,
      start: ordered ? positive(el.attrs.get('start')) : undefined,
      first: true,
    };
    this.lists.push(frame);
    this.enter(frame.container);
    for (const child of el.children) {
      if (child.kind === 'element') this.walk(child, ctx);
      else if (/[^\t\n\r\f  ]/.test(child.text)) this.inline({ kind: 'text', text: child.text, marks: ctx.marks });
    }
    this.leave();
    this.lists.pop();
  }

  private listItem(el: Element, d: Declarations, ctx: Context): void {
    const frame = this.lists[this.lists.length - 1];
    const listId = el.attrs.get('data-listid');
    const item: Item = {
      kind: 'item',
      // Google Docs and Word for the web say the level outright.
      level: positive(el.attrs.get('aria-level') ?? el.attrs.get('data-aria-level')) ?? frame?.depth ?? 1,
      ordered: orderedByStyle(d) ?? frame?.ordered ?? false,
      key: listId ? `listid:${listId}` : (frame?.key ?? `list:${this.keys++}`),
      blocks: [],
    };
    if (frame?.first && frame.start !== undefined) item.start = frame.start;
    if (frame) frame.first = false;
    const checked = checkedOf(el);
    if (checked !== undefined) item.checked = checked;
    this.push(item);
    this.items.push(item);
    this.enter(item.blocks);
    this.walkChildren(el.children, ctx);
    this.leave();
    this.items.pop();
  }

  /** A checkbox in a list item, as GitHub renders task lists. */
  private checkbox(el: Element): void {
    const item = this.items[this.items.length - 1];
    if (item && (el.attrs.get('type') ?? '').toLowerCase() === 'checkbox') {
      item.checked = el.attrs.has('checked');
    }
  }

  /**
   * Word writes list items as paragraphs: `mso-list: l0 level2 lfo1` says which list and how deep,
   * and the bullet or number is text in a span marked `mso-list: Ignore`. Its "filtered" HTML drops
   * the mso-list styles, leaving the paragraph's class and the marker, followed by a spacer span
   * set in 7pt Times New Roman.
   */
  private wordListItem(el: Element, d: Declarations): WordListInfo | null {
    if (this.source !== 'word') return null;
    const mso = d.get('mso-list');
    const m = mso ? /\bl(\d+)\s+level(\d+)/i.exec(mso) : null;
    if (m) {
      const level = Number(m[2]);
      const format = this.sheet.lists.get(`l${m[1]}:level${level}`)?.get('mso-level-number-format');
      const marker = this.wordMarker(el)?.text ?? '';
      const fromMarker = markerKind(marker);
      const ordered = format
        ? !/^(bullet|none|image)$/i.test(format)
        : fromMarker.ordered;
      return { level, key: `word:l${m[1]}`, ordered, start: ordered ? fromMarker.start : undefined, skip: new Set() };
    }
    // Any of Word's paragraph styles can be a list item; the marker and spacer are what tell.
    if (!/(^|\s)Mso/i.test(el.attrs.get('class') ?? '')) return null;
    const marker = this.wordMarker(el);
    if (!marker) return null;
    const indent = points(d.get('margin-left'));
    const level = indent && indent > 0 ? Math.max(1, Math.round(indent / 36)) : 1;
    const kind = markerKind(marker.text);
    return { level, key: 'word:filtered', ordered: kind.ordered, start: kind.start, skip: marker.nodes };
  }

  /** The marker: the text before Word's spacer span, and the nodes it's made of. */
  private wordMarker(el: Element): { text: string; nodes: Set<Node> } | null {
    const nodes = new Set<Node>();
    let text = '';
    let found = false;
    const visit = (node: Node): boolean => {
      if (node.kind === 'text') {
        text += node.text;
        nodes.add(node);
        return text.trim().length > 8; // too long to be a marker: give up
      }
      const d = this.sheet.declared(node);
      if (isSpacer(d)) {
        nodes.add(node);
        found = true;
        return true;
      }
      if (/^ignore$/i.test(d.get('mso-list') ?? '')) {
        // The marker's own span (unfiltered HTML): its text, minus the spacer inside.
        for (const child of node.children) if (visit(child)) return true;
        return false;
      }
      for (const child of node.children) if (visit(child)) return true;
      return false;
    };
    for (const child of el.children) if (visit(child)) break;
    const marker = text.replace(/[\s ]+/g, '');
    return found && marker && marker.length <= 6 ? { text: marker, nodes } : null;
  }

  private wordItem(el: Element, info: WordListInfo, ctx: Context): void {
    const item: Item = { kind: 'item', level: info.level, ordered: info.ordered, key: info.key, blocks: [] };
    if (info.start !== undefined) item.start = info.start;
    this.push(item);
    this.enter(item.blocks);
    const skip = this.skip;
    this.skip = info.skip;
    this.openPara('p');
    this.walkChildren(el.children, ctx);
    this.skip = skip;
    this.leave();
  }

  // --- Formatting ----------------------------------------------------------------------------

  /**
   * Word's tracked changes: `'drop'` leaves the element out, `'keep'` keeps its text without
   * formatting. Elsewhere <del> is just struck-through text.
   */
  private trackedChange(el: Element): 'drop' | 'keep' | null {
    const cls = el.attrs.get('class') ?? '';
    const tracked = this.source === 'word' || el.attrs.has('cite') || el.attrs.has('datetime');
    const deletion = (el.tag === 'del' && tracked) || /(^|\s)msoDel(\s|$)/i.test(cls);
    const insertion = (el.tag === 'ins' && tracked) || /(^|\s)msoIns(\s|$)/i.test(cls);
    if (!deletion && !insertion) return null;
    const accept = this.settings.trackChanges === 'accept';
    return deletion === accept ? 'drop' : 'keep';
  }

  private isWordNonContent(el: Element, d: Declarations): boolean {
    if (/^ignore$/i.test(d.get('mso-list') ?? '')) return true; // a list marker
    const element = (d.get('mso-element') ?? '').toLowerCase();
    if (WORD_NON_CONTENT.has(element)) return true;
    const cls = el.attrs.get('class') ?? '';
    return /(^|\s)(MsoCommentReference|msocomanchor|msocomoff)(\s|$)/i.test(cls);
  }

  private marksFor(el: Element, d: Declarations, parent: Marks): Marks {
    const m: Marks = { ...parent };
    switch (el.tag) {
      case 'b':
      case 'strong':
        m.bold = true;
        break;
      case 'i':
      case 'em':
        m.italic = true;
        break;
      case 'u':
        m.underline = true;
        break;
      case 's':
      case 'strike':
      case 'del':
        m.strike = true;
        break;
      case 'sup':
        m.sup = true;
        m.sub = false;
        break;
      case 'sub':
        m.sub = true;
        m.sup = false;
        break;
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt':
        m.code = true;
        break;
      case 'a': {
        const href = this.link(el.attrs.get('href'));
        if (href) m.href = href;
        break;
      }
    }

    const font = parseFont(d.get('font'));
    const weight = d.get('font-weight') ?? font.weight;
    if (weight) m.bold = isBold(weight);
    // Word for the web marks bold with a class and no style rule for it.
    if (/(^|\s)MacChromeBold(\s|$)/.test(el.attrs.get('class') ?? '')) m.bold = true;
    const style = d.get('font-style') ?? font.style;
    if (style) m.italic = /^(italic|oblique)/i.test(style);
    const decoration = d.get('text-decoration-line') ?? d.get('text-decoration');
    if (decoration !== undefined) {
      // An element's own "none" undoes the underline of <u> or <s> itself; an ancestor's
      // decoration still shows through, as in CSS.
      if (/underline/i.test(decoration)) m.underline = true;
      else if (el.tag === 'u') m.underline = parent.underline ?? false;
      if (/line-through/i.test(decoration)) m.strike = true;
      else if (el.tag === 's' || el.tag === 'strike') m.strike = parent.strike ?? false;
    }
    const valign = (d.get('vertical-align') ?? '').toLowerCase();
    if (valign === 'super') {
      m.sup = true;
      m.sub = false;
    } else if (valign === 'sub') {
      m.sub = true;
      m.sup = false;
    }
    // <font face="…"> is how LibreOffice and older HTML set a font.
    const family = d.get('font-family') ?? font.family ?? (el.tag === 'font' ? el.attrs.get('face') : undefined);
    if (family && el.tag !== 'code') {
      const mono = isMonospace(family);
      if (mono && this.settings.code) m.code = true;
      else if (!mono) m.code = false;
    }
    return m;
  }

  /** A link's URL if it may be kept: redirect wrappers unwrapped, scheme on the allowed list. */
  private link(raw: string | undefined): string | null {
    let href = (raw ?? '').trim();
    if (!href) return null;
    href = unwrapRedirect(href);
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
    // Relative links and #fragments meant something only in the document they came from.
    if (!scheme || !this.settings.linkSchemes.has(scheme)) return null;
    return href;
  }
}

// --- Helpers -----------------------------------------------------------------------------------

function isHidden(d: Declarations): boolean {
  return (
    /^none\b/i.test(d.get('display') ?? '') ||
    /^hidden\b/i.test(d.get('visibility') ?? '') ||
    /^all\b/i.test(d.get('mso-hide') ?? '')
  );
}

/** Word's spacer after a list marker: `font: 7.0pt "Times New Roman"`. */
function isSpacer(d: Declarations): boolean {
  const font = d.get('font') ?? '';
  const size = d.get('font-size') ?? '';
  return /^7(\.0)?pt\b/i.test(font) || /^7(\.0)?pt$/i.test(size);
}

function headingOf(el: Element): ParaTag | null {
  if (HEADINGS.has(el.tag)) return el.tag as ParaTag;
  const cls = el.attrs.get('class') ?? '';
  if (/(^|\s)MsoTitle(\s|$)/i.test(cls)) return 'h1';
  // Word for the web: <p role="heading" aria-level="2">.
  if (el.attrs.get('role') === 'heading') {
    const level = positive(el.attrs.get('aria-level')) ?? 2;
    return `h${Math.min(6, level)}` as ParaTag;
  }
  return null;
}

/** `list-style-type` on an item, as Google Docs writes it. */
function orderedByStyle(d: Declarations): boolean | undefined {
  const type = (d.get('list-style-type') ?? '').toLowerCase();
  if (!type) return undefined;
  if (/^(disc|circle|square|none)$/.test(type)) return false;
  return true;
}

function checkedOf(el: Element): boolean | undefined {
  const data = el.attrs.get('data-checked');
  if (data !== undefined) return data === 'true';
  if (el.attrs.get('role') === 'checkbox') return el.attrs.get('aria-checked') === 'true';
  return undefined;
}

/** Whether a marker is a bullet or a number, and the number. */
function markerKind(marker: string): { ordered: boolean; start: number | undefined } {
  const digits = /^\(?(\d+)[.)]?$/.exec(marker);
  if (digits) return { ordered: true, start: Number(digits[1]) };
  if (/^\(?(?:[a-z]|[ivxlcdm]+)[.)]$/i.test(marker)) return { ordered: true, start: undefined };
  return { ordered: false, start: undefined };
}

function positive(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function span(value: string | undefined): number {
  return Math.min(1000, positive(value) ?? 1);
}

function isBold(weight: string): boolean {
  const w = weight.trim().toLowerCase();
  if (w === 'bold' || w === 'bolder') return true;
  const n = Number.parseInt(w, 10);
  return Number.isFinite(n) && n >= 600;
}

function isMonospace(family: string): boolean {
  const first = family.split(',')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase() ?? '';
  return MONOSPACE.has(first) || /\bmono\b/.test(first);
}

/** The weight, style and family in a `font` shorthand such as `italic bold 12px "Courier New"`. */
function parseFont(font: string | undefined): { weight?: string; style?: string; family?: string } {
  if (!font) return {};
  const out: { weight?: string; style?: string; family?: string } = {};
  const tokens = font.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!.toLowerCase();
    if (/^(italic|oblique)$/.test(t)) out.style = t;
    else if (/^(bold|bolder|lighter|[1-9]00)$/.test(t)) out.weight = t;
    else if (/^[\d.]+(px|pt|em|rem|%|cm|mm|in|pc|ex|ch)(\/.*)?$/.test(t) || /^(xx?-)?(small|large)$|^medium$/.test(t)) {
      const family = tokens.slice(i + 1).join(' ');
      if (family) out.family = family;
      break;
    }
  }
  return out;
}

/** Google Docs and Outlook wrap links in redirects: keep the real address. */
function unwrapRedirect(href: string): string {
  try {
    const url = new URL(href);
    if (/(^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname === '/url') {
      const q = url.searchParams.get('q') ?? url.searchParams.get('url');
      if (q) return q;
    }
    if (/\.safelinks\.protection\.outlook\.com$/i.test(url.hostname)) {
      const target = url.searchParams.get('url');
      if (target) return target;
    }
  } catch {
    // not an absolute URL
  }
  return href;
}

/** The text of a <pre>, keeping its whitespace; <br> and nested blocks become line breaks. */
function preText(el: Element, sheet: Stylesheet): string {
  let out = '';
  const visit = (node: Node) => {
    if (node.kind === 'text') {
      out += node.text;
      return;
    }
    if (SKIPPED.has(node.tag) || isHidden(sheet.declared(node))) return;
    if (node.tag === 'br') {
      out += '\n';
      return;
    }
    const block = BLOCKS.has(node.tag) || HEADINGS.has(node.tag);
    if (block && out && !out.endsWith('\n')) out += '\n';
    for (const child of node.children) visit(child);
    if (block && !out.endsWith('\n')) out += '\n';
  };
  for (const child of el.children) visit(child);
  return out.replace(/ /g, ' ');
}
