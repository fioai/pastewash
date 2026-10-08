/** Where the pasted HTML came from, as far as can be told from its markup. */
export type Source =
  | 'word'
  | 'word-online'
  | 'google-docs'
  | 'google-sheets'
  | 'excel'
  | 'libreoffice'
  | 'apple'
  | 'web';

export interface Options {
  /**
   * Keep paragraphs with nothing in them (Word's way of adding space), as `<p><br></p>`.
   * Default: false.
   */
  keepEmptyParagraphs?: boolean;
  /**
   * `'keep'` keeps images whose source is a `data:` URI or an http(s) URL. `'drop'` drops all of
   * them. Images whose address can't be loaded where the paste lands (`file:`, `cid:`, `blob:`,
   * relative URLs) are always dropped.
   * Every image is listed in {@link Result.images} either way. Default: `'keep'`.
   */
  images?: 'keep' | 'drop';
  /** Mark text set in a monospace font (Courier, Consolas, …) as `<code>`. Default: true. */
  code?: boolean;
  /** URL schemes a link may have; other links become plain text. Default: http, https, mailto, tel. */
  linkSchemes?: readonly string[];
  /**
   * Word's tracked changes: `'accept'` keeps insertions and drops deletions, `'reject'` the
   * opposite. Default: `'accept'`.
   */
  trackChanges?: 'accept' | 'reject';
}

export interface ImageReport {
  src: string;
  alt: string;
  /** Whether it's in the output. */
  kept: boolean;
  /**
   * Why it was dropped: `'unreachable'` when its address can't be loaded where the paste lands
   * (the copier's disk with `file:`, an email attachment with `cid:`, the source page with a
   * relative or `blob:` URL); `'option'` when `images: 'drop'` was given.
   */
  reason?: 'unreachable' | 'option';
}

export interface Result {
  /** Clean HTML, using only the elements and attributes listed in the README. */
  html: string;
  source: Source;
  /** Every image in the paste, in order. */
  images: ImageReport[];
}
