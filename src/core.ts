import { Stylesheet } from './css.ts';
import { finish } from './finish.ts';
import { buildLists } from './lists.ts';
import { serialize } from './serialize.ts';
import { detectSource } from './source.ts';
import type { Parsed } from './tree.ts';
import type { Options, Result } from './types.ts';
import { Walker } from './walk.ts';

export type { Element, Node, Parse5Node, Parsed, Text } from './tree.ts';
export { fromDocument, fromParse5 } from './tree.ts';
export type { ImageReport, Options, Result, Source } from './types.ts';

/**
 * Washes an already-parsed paste. `raw` is the HTML it was parsed from, which some sources are
 * recognised by. The entry points `pastewash` (browser) and `pastewash/node` call this.
 */
export function washParsed(parsed: Parsed, raw: string, options: Options = {}): Result {
  const settings = {
    keepEmptyParagraphs: options.keepEmptyParagraphs ?? false,
    images: options.images ?? 'keep',
    code: options.code ?? true,
    linkSchemes: new Set((options.linkSchemes ?? ['http', 'https', 'mailto', 'tel']).map((s) => s.toLowerCase())),
    trackChanges: options.trackChanges ?? 'accept',
  } as const;
  const source = detectSource(parsed, raw);
  const walker = new Walker(new Stylesheet(parsed.styles), source, settings);
  walker.walkChildren(parsed.body, { marks: {} });
  const blocks = finish(buildLists(walker.result()), settings.keepEmptyParagraphs);
  return { html: serialize(blocks), source, images: walker.images };
}
