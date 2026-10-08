/**
 * Just enough CSS: the declarations in style attributes, and the rules in <style> blocks with
 * simple selectors (`p`, `.x`, `p.x`), which is how Word, Excel and Apple's apps mark text bold or
 * a paragraph as a list item. Also Word's `@list` rules, which say whether a list is numbered.
 */

import type { Element } from './tree.ts';

export type Declarations = ReadonlyMap<string, string>;

/** Parses `a: b; c: "d;e"` into a map, keys in lower case, `!important` dropped. */
export function parseDeclarations(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of splitOutside(text, ';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!\s*important\s*$/i, '')
      .trim();
    if (name) out.set(name, value);
  }
  return out;
}

/** Splits on `sep` where it isn't inside quotes or parentheses. */
function splitOutside(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
    } else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

interface Rule {
  tag: string | null;
  classes: string[];
  specificity: number;
  order: number;
  decls: Map<string, string>;
}

export class Stylesheet {
  private readonly rules: Rule[] = [];
  /** Word's list definitions: "l0:level1" → declarations such as mso-level-number-format. */
  readonly lists = new Map<string, Map<string, string>>();
  private readonly cache = new WeakMap<Element, Declarations>();

  constructor(texts: readonly string[]) {
    let order = 0;
    for (const raw of texts) {
      // Word and Excel wrap their styles in an HTML comment.
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '');
      for (const { prelude, body } of blocks(text)) {
        const list = /^@list\s+(l\d+:level\d+)$/i.exec(prelude);
        if (list) {
          this.lists.set(list[1]!.toLowerCase(), parseDeclarations(body));
          continue;
        }
        if (prelude.startsWith('@')) continue; // @page, @font-face, @media
        const decls = parseDeclarations(body);
        for (const selector of prelude.split(',')) {
          const m = /^\s*([a-z][a-z0-9]*|\*)?((?:\.[\w-]+)*)\s*$/i.exec(selector);
          if (!m || (!m[1] && !m[2])) continue; // anything fancier isn't used by these apps
          const tag = m[1] && m[1] !== '*' ? m[1].toLowerCase() : null;
          const classes = (m[2] ?? '')
            .split('.')
            .filter(Boolean)
            .map((c) => c.toLowerCase());
          this.rules.push({
            tag,
            classes,
            specificity: classes.length * 10 + (tag ? 1 : 0),
            order: order++,
            decls,
          });
        }
      }
    }
    this.rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  }

  /** The declarations that apply to `el`: matching rules by specificity, then its style attribute. */
  declared(el: Element): Declarations {
    const cached = this.cache.get(el);
    if (cached) return cached;
    const out = new Map<string, string>();
    if (this.rules.length) {
      const classes = new Set(
        (el.attrs.get('class') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((c) => c.toLowerCase()),
      );
      for (const rule of this.rules) {
        if (rule.tag && rule.tag !== el.tag) continue;
        if (!rule.classes.every((c) => classes.has(c))) continue;
        for (const [k, v] of rule.decls) out.set(k, v);
      }
    }
    const style = el.attrs.get('style');
    if (style) for (const [k, v] of parseDeclarations(style)) out.set(k, v);
    this.cache.set(el, out);
    return out;
  }
}

/** Top-level `prelude { body }` blocks, skipping the insides of nested blocks such as @media. */
function* blocks(text: string): Generator<{ prelude: string; body: string }> {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) return;
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    yield { prelude, body: text.slice(open + 1, j - 1) };
    i = j;
  }
}

/** A CSS length in points, for Word's indentation; `null` if it isn't one. */
export function points(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(-?[\d.]+)\s*(pt|px|in|cm|mm|pc)?$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  switch ((m[2] ?? 'px').toLowerCase()) {
    case 'pt':
      return n;
    case 'px':
      return n * 0.75;
    case 'in':
      return n * 72;
    case 'cm':
      return (n * 72) / 2.54;
    case 'mm':
      return (n * 72) / 25.4;
    case 'pc':
      return n * 12;
    default:
      return null;
  }
}
