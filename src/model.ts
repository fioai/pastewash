/** The washed document, before it's written out as HTML. */

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  code?: boolean;
  href?: string;
}

export type Inline =
  | { kind: 'text'; text: string; marks: Marks }
  | { kind: 'br' }
  | { kind: 'img'; src: string; alt: string; marks: Marks };

export type ParaTag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface Para {
  kind: 'para';
  tag: ParaTag;
  inlines: Inline[];
}

/** A list item as found, before items are gathered into (nested) lists by their level. */
export interface Item {
  kind: 'item';
  /** 1 for the outermost list. */
  level: number;
  ordered: boolean;
  /** Items with different keys at the outermost level belong to different lists. */
  key: string;
  start?: number;
  checked?: boolean;
  blocks: Block[];
}

export interface ListItem {
  blocks: Block[];
  checked?: boolean;
}

export interface List {
  kind: 'list';
  ordered: boolean;
  start?: number;
  items: ListItem[];
}

export interface Cell {
  header: boolean;
  colspan: number;
  rowspan: number;
  blocks: Block[];
}

export type Block =
  | Para
  | Item
  | List
  | { kind: 'pre'; text: string }
  | { kind: 'hr' }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; rows: Cell[][] };
