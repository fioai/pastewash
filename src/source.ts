import type { Parsed } from './tree.ts';
import type { Source } from './types.ts';

/** Tells where a paste came from by the marks each application leaves in its HTML. */
export function detectSource(parsed: Parsed, raw: string): Source {
  const ns = (prefix: string) => parsed.htmlAttrs.get(`xmlns:${prefix}`) ?? '';
  const generator = (parsed.meta.get('generator') ?? '').toLowerCase();
  const progId = (parsed.meta.get('progid') ?? '').toLowerCase();

  if (raw.includes('id="docs-internal-guid-') || raw.includes("id='docs-internal-guid-")) {
    return 'google-docs';
  }
  if (raw.includes('google-sheets-html-origin') || raw.includes('data-sheets-root')) {
    return 'google-sheets';
  }
  if (ns('x').includes('office:excel') || progId.startsWith('excel')) return 'excel';
  if (
    ns('w').includes('office:word') ||
    progId.startsWith('word') ||
    generator.includes('microsoft word') ||
    /class="?Mso/.test(raw)
  ) {
    return 'word';
  }
  // Word for the web: its own class names, and paragraph ids.
  if (/class="[^"]*\b(?:OutlineElement|NormalTextRun|TextRun)\b/.test(raw) || raw.includes('paraid=')) {
    return 'word-online';
  }
  if (generator.includes('libreoffice') || generator.includes('openoffice')) return 'libreoffice';
  if (generator.includes('cocoa html writer')) return 'apple';
  return 'web';
}
