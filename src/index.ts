/**
 * pastewash: clean up HTML pasted from Word, Google Docs, Excel and the web.
 *
 * ```js
 * editor.addEventListener('paste', (event) => {
 *   const html = event.clipboardData?.getData('text/html');
 *   if (!html) return;
 *   event.preventDefault();
 *   insertHtml(wash(html).html);
 * });
 * ```
 *
 * This entry point uses the browser's DOMParser. In Node, import `pastewash/node`.
 */

import { fromDocument, washParsed } from './core.ts';
import type { Options, Result } from './types.ts';

export type { ImageReport, Options, Result, Source } from './types.ts';

export function wash(html: string, options?: Options): Result {
  if (typeof DOMParser === 'undefined') {
    throw new Error("pastewash: there's no DOMParser here; in Node, import 'pastewash/node'");
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return washParsed(fromDocument(doc), html, options);
}
