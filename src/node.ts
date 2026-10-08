/** pastewash for Node (and anywhere without a DOMParser): parses with parse5. */

import { parse } from 'parse5';
import { fromParse5, type Parse5Node, washParsed } from './core.ts';
import type { Options, Result } from './types.ts';

export type { ImageReport, Options, Result, Source } from './types.ts';

export function wash(html: string, options?: Options): Result {
  return washParsed(fromParse5(parse(html) as unknown as Parse5Node), html, options);
}
