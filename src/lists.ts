import type { Block, Item, List, ListItem } from './model.ts';

/**
 * Gathers runs of list items into lists, nested by level. Every source's lists arrive here the
 * same way, as items with a level: Word's paragraphs, Google Docs' aria-level, Word for the web's
 * one-item lists, and ordinary nested <ul>s.
 */
export function buildLists(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let run: Item[] = [];
  const flush = () => {
    if (run.length) out.push(...nest(run));
    run = [];
  };
  for (const block of blocks) {
    if (block.kind === 'item') {
      run.push(block);
      continue;
    }
    flush();
    out.push(inside(block));
  }
  flush();
  return out;
}

function inside(block: Block): Block {
  switch (block.kind) {
    case 'quote':
      return { ...block, blocks: buildLists(block.blocks) };
    case 'table':
      return {
        ...block,
        rows: block.rows.map((row) => row.map((cell) => ({ ...cell, blocks: buildLists(cell.blocks) }))),
      };
    case 'list':
      return { ...block, items: block.items.map((item) => ({ ...item, blocks: buildLists(item.blocks) })) };
    default:
      return block;
  }
}

function nest(items: Item[]): List[] {
  const lists: List[] = [];
  /** The lists open from the outermost in; `level` is the level of the items that opened each. */
  const open: { list: List; level: number; key: string }[] = [];
  for (const item of items) {
    const level = Math.max(1, item.level);
    while (open.length && open[open.length - 1]!.level > level) open.pop();
    let top = open[open.length - 1];
    // At the same level, a different kind of list (bullets after numbers), or a different list at
    // the outermost level, starts a new list.
    if (
      top &&
      top.level === level &&
      (top.list.ordered !== item.ordered || (open.length === 1 && top.key !== item.key))
    ) {
      open.pop();
      top = open[open.length - 1];
    }
    if (!top || top.level < level) {
      const list: List = { kind: 'list', ordered: item.ordered, items: [] };
      if (item.ordered && item.start !== undefined && item.start !== 1) list.start = item.start;
      if (top) {
        // Nested one deeper than its parent, even when the levels skip, inside the parent's last
        // item (or a new empty one, when a list starts deeper than it should).
        let host = top.list.items[top.list.items.length - 1];
        if (!host) {
          host = { blocks: [] };
          top.list.items.push(host);
        }
        host.blocks.push(list);
      } else {
        lists.push(list);
      }
      open.push({ list, level, key: item.key });
      top = open[open.length - 1]!;
    }
    const entry: ListItem = { blocks: buildLists(item.blocks) };
    if (item.checked !== undefined) entry.checked = item.checked;
    top.list.items.push(entry);
  }
  return lists;
}
