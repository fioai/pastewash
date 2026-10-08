/**
 * The parsed clipboard HTML, reduced to what washing needs. Both parsers (the browser's DOMParser and
 * parse5 in Node) are converted to this, so everything after parsing is the same code.
 */

export interface Element {
  readonly kind: 'element';
  /** Lower case, with any prefix: "p", "o:p", "v:shape". */
  readonly tag: string;
  /** Names in lower case. */
  readonly attrs: ReadonlyMap<string, string>;
  readonly children: readonly Node[];
}

export interface Text {
  readonly kind: 'text';
  readonly text: string;
}

export type Node = Element | Text;

export interface Parsed {
  /** The attributes of <html>, where Word and Excel declare their namespaces. */
  readonly htmlAttrs: ReadonlyMap<string, string>;
  /** <meta name="…" content="…"> pairs, names in lower case. */
  readonly meta: ReadonlyMap<string, string>;
  /** The text of every <style> element, in document order. */
  readonly styles: readonly string[];
  /** The children of <body>. */
  readonly body: readonly Node[];
}

/** Elements whose contents are never content. */
const DROPPED = new Set(['head', 'style', 'script', 'template', 'noscript', 'title']);

function element(tag: string, attrs: Map<string, string>, children: Node[]): Element {
  return { kind: 'element', tag, attrs, children };
}

// --- The browser's DOM -------------------------------------------------------------------------

export function fromDocument(doc: Document): Parsed {
  const htmlAttrs = attrsOf(doc.documentElement);
  const meta = new Map<string, string>();
  for (const m of Array.from(doc.querySelectorAll('meta'))) {
    const name = m.getAttribute('name') ?? m.getAttribute('http-equiv');
    if (name) meta.set(name.toLowerCase(), m.getAttribute('content') ?? '');
  }
  const styles = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent ?? '');
  const body = doc.body ? convertDomChildren(doc.body) : [];
  return { htmlAttrs, meta, styles, body };
}

function attrsOf(el: globalThis.Element): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const a of Array.from(el.attributes)) attrs.set(a.name.toLowerCase(), a.value);
  return attrs;
}

function convertDomChildren(parent: globalThis.Node): Node[] {
  const out: Node[] = [];
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3) {
      out.push({ kind: 'text', text: child.nodeValue ?? '' });
    } else if (child.nodeType === 1) {
      const el = child as globalThis.Element;
      const tag = el.localName.toLowerCase();
      if (DROPPED.has(tag)) continue;
      out.push(element(tag, attrsOf(el), convertDomChildren(el)));
    }
  }
  return out;
}

// --- parse5 ------------------------------------------------------------------------------------

/** The parts of parse5's default tree that are used, so this file doesn't depend on parse5. */
export interface Parse5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Parse5Node[];
}

export function fromParse5(document: Parse5Node): Parsed {
  const html = document.childNodes?.find((n) => n.tagName === 'html');
  const htmlAttrs = new Map<string, string>();
  for (const a of html?.attrs ?? []) htmlAttrs.set(a.name.toLowerCase(), a.value);
  const meta = new Map<string, string>();
  const styles: string[] = [];
  let bodyNode: Parse5Node | undefined;
  const visit = (node: Parse5Node): void => {
    if (node.tagName === 'meta') {
      const get = (n: string) => node.attrs?.find((a) => a.name === n)?.value;
      const name = get('name') ?? get('http-equiv');
      if (name) meta.set(name.toLowerCase(), get('content') ?? '');
    } else if (node.tagName === 'style') {
      styles.push((node.childNodes ?? []).map((c) => c.value ?? '').join(''));
    } else if (node.tagName === 'body') {
      bodyNode ??= node;
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);
  const body = bodyNode ? convertParse5Children(bodyNode) : [];
  return { htmlAttrs, meta, styles, body };
}

function convertParse5Children(parent: Parse5Node): Node[] {
  const out: Node[] = [];
  for (const child of parent.childNodes ?? []) {
    if (child.nodeName === '#text') {
      out.push({ kind: 'text', text: child.value ?? '' });
    } else if (child.tagName) {
      const tag = child.tagName.toLowerCase();
      if (DROPPED.has(tag)) continue;
      const attrs = new Map<string, string>();
      for (const a of child.attrs ?? []) attrs.set(a.name.toLowerCase(), a.value);
      out.push(element(tag, attrs, convertParse5Children(child)));
    }
  }
  return out;
}
