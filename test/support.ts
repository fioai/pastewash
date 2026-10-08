import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'parse5';
import type { Options, Source } from '../src/types.ts';

export interface Fixture {
  /** "word/lists" */
  id: string;
  source: Source;
  input: string;
  expected: string;
  options: Options;
}

const root = join(import.meta.dirname, 'fixtures');

/** Every fixture: `<dir>/<name>.html`, `<name>.expected.html`, and optionally `<name>.options.json`. */
export function fixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(root, dir.name))) {
      if (!file.endsWith('.html') || file.endsWith('.expected.html')) continue;
      const name = file.slice(0, -'.html'.length);
      const base = join(root, dir.name, name);
      const options = existsSync(`${base}.options.json`)
        ? (JSON.parse(readFileSync(`${base}.options.json`, 'utf8')) as Options)
        : {};
      out.push({
        id: `${dir.name}/${name}`,
        source: (dir.name === 'security' ? 'web' : dir.name) as Source,
        input: readFileSync(`${base}.html`, 'utf8'),
        expected: readFileSync(`${base}.expected.html`, 'utf8').trimEnd(),
        options,
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

interface P5 {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5[];
  content?: P5;
}

/** The elements and attributes washed output may contain. */
export const ALLOWED: Record<string, readonly string[]> = {
  p: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], ul: [], ol: ['start'], li: ['data-checked'],
  table: [], tbody: [], tr: [], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
  blockquote: [], pre: [], hr: [], br: [], strong: [], em: [], u: [], s: [], code: [], sub: [],
  sup: [], a: ['href'], img: ['src', 'alt'],
};

/** Problems with washed output: anything outside the vocabulary, or a link or image that isn't safe. */
export function vocabularyProblems(html: string, schemes = ['http', 'https', 'mailto', 'tel']): string[] {
  const problems: string[] = [];
  const visit = (node: P5, inBody: boolean) => {
    if (node.tagName && inBody) {
      const allowed = ALLOWED[node.tagName];
      if (!allowed) problems.push(`element <${node.tagName}>`);
      for (const a of node.attrs ?? []) {
        if (!allowed?.includes(a.name)) problems.push(`attribute ${a.name} on <${node.tagName}>`);
        if (node.tagName === 'a' && a.name === 'href') {
          const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(a.value)?.[1]?.toLowerCase();
          if (!scheme || !schemes.includes(scheme)) problems.push(`href ${a.value}`);
        }
        if (node.tagName === 'img' && a.name === 'src' && !/^(https?:|data:image\/)/i.test(a.value)) {
          problems.push(`src ${a.value}`);
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child, inBody || node.tagName === 'body');
  };
  visit(parse(html) as unknown as P5, false);
  return problems;
}

/** All the text in some HTML, without any whitespace, for checking that nothing was made up. */
export function letters(html: string): string {
  let out = '';
  const visit = (node: P5) => {
    if (node.nodeName === '#text') out += node.value ?? '';
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(html) as unknown as P5);
  return out.replace(/[\s\u00a0]+/g, '');
}

/** A small seeded random number generator (mulberry32), so failures can be replayed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAGS = [
  'p', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'table', 'tr', 'td',
  'th', 'h1', 'h3', 'br', 'img', 'blockquote', 'pre', 'code', 'font', 'sup', 'sub', 'o:p', 'del',
  'ins', 'section', 'tbody', 'hr', 'script', 'style', 'svg', 'input',
];
const STYLES = [
  'font-weight:700', 'font-weight:400', 'font-weight:normal', 'font-style:italic', 'font-style:normal',
  'text-decoration:underline', 'text-decoration:line-through', 'text-decoration:none', 'display:none',
  'vertical-align:super', 'vertical-align:sub', 'font-family:"Courier New"', 'font-family:Arial',
  'mso-list:l0 level1 lfo1', 'mso-list:l0 level2 lfo1', 'mso-list:Ignore', 'mso-hide:all',
  'font:7.0pt "Times New Roman"', 'margin-left:72pt', 'list-style-type:decimal', 'white-space:pre',
];
const ATTRS: [string, string[]][] = [
  ['href', ['https://example.com/a', 'javascript:alert(1)', '/relative', '#frag', 'mailto:a@b.c', 'https://www.google.com/url?q=https://x.example/&sa=D']],
  ['src', ['https://example.com/i.png', 'file:///C:/x.png', 'data:image/png;base64,AAAA', 'cid:abc']],
  ['class', ['MsoNormal', 'MsoListParagraph', 'MsoTitle', 'MacChromeBold', 'xl65']],
  ['aria-level', ['1', '2', '3']],
  ['data-checked', ['true', 'false']],
  ['role', ['checkbox', 'heading']],
  ['aria-checked', ['true', 'false']],
  ['colspan', ['2', '0', 'x']],
  ['start', ['3', '-1']],
  ['onclick', ['alert(1)']],
  ['type', ['checkbox']],
  ['checked', ['']],
];
const WORDS = ['alpha', 'beta', 'gamma', 'delta', '&nbsp;', '&amp;', '&lt;b&gt;', ' ', '\n', '  ', '·', '1.', 'o', 'é', '日本'];

/** A random, often ill-formed, HTML document in the style of the sources pastewash handles. */
export function randomHtml(random: () => number): string {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const node = (depth: number): string => {
    if (depth > 5 || random() < 0.3) return pick(WORDS);
    const tag = pick(TAGS);
    let attrs = '';
    if (random() < 0.5) {
      const n = 1 + Math.floor(random() * 3);
      attrs += ` style="${Array.from({ length: n }, () => pick(STYLES)).join(';')}"`;
    }
    for (let i = 0, n = Math.floor(random() * 3); i < n; i++) {
      const [name, values] = pick(ATTRS);
      attrs += ` ${name}="${pick(values)}"`;
    }
    const children = Array.from({ length: Math.floor(random() * 4) }, () => node(depth + 1)).join('');
    return `<${tag}${attrs}>${children}</${tag}>`;
  };
  const head = random() < 0.3
    ? '<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>@list l0:level1 {mso-level-number-format:bullet;} .xl65 {font-weight:700}</style></head><body>'
    : random() < 0.2
      ? '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">'
      : '';
  return head + Array.from({ length: 1 + Math.floor(random() * 5) }, () => node(0)).join('');
}
