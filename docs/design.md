# How pastewash washes, and why

The knowledge behind the code: what each application puts on the clipboard, and what pastewash does with it.

## The pipeline

1. **Parse** (`tree.ts`). The browser entry uses `DOMParser`, the Node entry parse5; both implement the HTML standard's parsing algorithm, and both are reduced to one small tree.
   - Comments go. So do `<head>`, `<style>`, `<script>` and `<template>`, but the text of every `<style>` is kept, and so are `<meta>` names and the `<html>` element's attributes.
   - Word's conditional comments need no special handling. `<!--[if !supportLists]-->` is a comment, and so is the downlevel form `<![if !vml]>`, so the markup between them is ordinary markup.
2. **Recognise the source** (`source.ts`). Each application leaves a mark:
   - Google Docs: `id="docs-internal-guid-…"`;
   - Google Sheets: `<google-sheets-html-origin>`;
   - Word and Excel: Office namespaces on `<html>`, `ProgId` meta and `Mso` classes;
   - Word for the web: `OutlineElement`/`TextRun` classes and `paraid`;
   - LibreOffice and Apple: a `generator` meta.
3. **Read the CSS** (`css.ts`). Inline `style` attributes, and `<style>` rules whose selectors are a tag, classes, or both, which is all these applications use. Specificity orders the rules; the style attribute comes last.
   - Matching ignores case. Word's HTML has no doctype, so browsers render it in quirks mode, where class names match without regard to case.
   - Word's `@list l0:level1 { … }` rules are kept separately: they say whether a list level is numbered.
4. **Walk** (`walk.ts`). Once through the tree:
   - Formatting is carried down as *marks*: bold, italic, underline, strike, sub, sup, code, link.
   - Blocks become paragraphs, headings, list items, tables, quotes, code blocks and rules.
   - Inline content outside any block gets a paragraph of its own; whitespace between blocks doesn't.
5. **Nest lists** (`lists.ts`). Every source's list items arrive as flat items with a level, and one algorithm nests them (below).
6. **Finish** (`finish.ts`):
   - Collapse whitespace as a browser shows it.
   - Give a space between two runs only the marks they share.
   - Merge runs with the same marks.
   - Drop what's left empty.
7. **Write** (`serialize.ts`). From a closed vocabulary only.
   - Marks are nested in one fixed order: link, strong, em, u, s, code, sub/sup. They're reopened only where they change, so the same text always comes out the same way.
   - A table cell holding one paragraph loses the `<p>`, and so does a list item's first paragraph when only nested lists follow it.

## Marks

- **Tags:**
  - `b strong` → bold; `i em` → italic; `u` → underline;
  - `s strike` → strike, and `del` too outside Word;
  - `sup`/`sub`; `code kbd samp tt` → code;
  - `a[href]` → link, when its address is allowed.
- **CSS:**
  - `font-weight` 600 and above, or `bold`, is bold. Below 600, or `normal`, *undoes* bold, which is how Google Docs' `<b style="font-weight:normal">` wrapper stops being bold.
  - `font-style` likewise sets or undoes italic.
  - `text-decoration` adds underline and line-through. `none` on an element only undoes its own `<u>` or `<s>`, as in CSS, where a parent's decoration still shows through.
  - `vertical-align: super/sub`.
  - The `font` shorthand is read for weight, style and family; Word and Apple write `font: 7.0pt "Times New Roman"`.
- **Monospace becomes code:** a first font family of Courier, Consolas, Menlo, Monaco and the like, or anything with "Mono" in the name. Any other family undoes it, since `font-family` is inherited. `<font face>` counts, as LibreOffice uses it.
- **Headings aren't marked bold.** Word and Google Docs style them through their tag, and `<strong>` inside every heading would be noise.

## Lists, every source the same way

Each list item becomes an `Item` with a level (1 = outermost), numbered or not, a key saying which list it belongs to, and optionally a start number and a checked state. Runs of consecutive items are nested by level:
- a deeper item opens a list inside the previous item;
- a shallower one closes lists;
- at the same level, a change from bullets to numbers, or a different key at the outermost level, starts a new list;
- levels that skip (1 then 3) nest one deeper, not two.

Where the level and key come from:

| Source | Level | Key | Numbered |
|---|---|---|---|
| Plain nested `<ul>`/`<ol>` | nesting depth | each list element | its tag |
| Google Docs | `aria-level` | the outermost list | its tag, or `list-style-type` |
| Word for the web | `data-aria-level` | `data-listid` | its tag |
| Word | `mso-list: lN levelM` | `lN` | the `@list lN:levelM` rule's `mso-level-number-format`, or the marker |
| Word, filtered HTML | `margin-left` ÷ 36pt | one for all | the marker |

Two places are subtle:

- **A list directly inside another** (`<ul><li>a</li><ul><li>b</li></ul></ul>`, which is how Google Docs nests) puts its items among the outer list's items, a level deeper. **A list inside an item's own content** (`<li>Intro<ul>…</ul>Outro</li>`) stays there, in order, as a list of its own. Treating the second like the first moved "Outro" before the nested list. Random testing found it: the invariant that the output's text appears in the input in order caught it.
- **Word's markers.** Unfiltered HTML puts the bullet or number in a span styled `mso-list: Ignore`, which is skipped. "Filtered" HTML (Save as Web Page, Filtered) has no `mso-list` styles at all, so a list item is a paragraph whose text starts with a short marker followed by Word's spacer, a span in `font: 7.0pt "Times New Roman"`. The spacer appears in both kinds, which is what makes it reliable. Bullets are `·` in Symbol, `o` in Courier New, or `§` in Wingdings. Numbers like `3.` also give the list's start. Decimal lists have no `mso-level-number-format` at all, since it's the default, so the marker decides.

Task lists: `role="checkbox"` with `aria-checked` (Google Docs, whose checkbox images, marked `aria-roledescription="checkbox"`, are dropped), `data-checked` (pastewash's own output, so washing is idempotent), or a checkbox `<input>` (GitHub's rendering).

## Word

- **Left out:**
  - `<v:…>` VML, whose `<img>` fallback is real markup;
  - comments: `mso-element: comment-list`, `MsoCommentReference`, `msocomanchor`;
  - footnote and endnote separators;
  - hidden text (`mso-hide: all`).
- **Footnotes** keep their text, including the `[1]` references. Their `#_ftn1` links become plain text, like any fragment link.
- **Tracked changes** are `<ins>`/`<del>` with `cite`/`datetime`, or `msoIns`/`msoDel` classes. They're accepted by default, or rejected with `trackChanges: 'reject'`. Outside Word, a `<del>` without those attributes is ordinary struck-through text.
- **Images:** `file:///…/msohtmlclip1/…/clip_image002.png` exists only on the copier's machine. It's dropped and reported, so an editor can use the image data that was also on the clipboard.
- **Style classes:** `MsoTitle` becomes `<h1>`. Headings are `<h1>`…`<h6>` already.

## Google Docs

- The paste is wrapped in `<b style="font-weight:normal" id="docs-internal-guid-…">`; the explicit weight undoes the bold.
- Formatting is on spans: `font-weight:700`, `font-style:italic`, `text-decoration:underline`, `vertical-align:super`.
- Each list item's text is in a `<p role="presentation">` inside the `<li>`.
- A lone `<br>` between blocks is an empty line. It's dropped, or kept as an empty paragraph with `keepEmptyParagraphs`.
- Links may arrive wrapped in `https://www.google.com/url?q=…`, which is unwrapped. So is Outlook's `*.safelinks.protection.outlook.com/?url=…`.

## Word for the web

- Paragraphs are `<p class="Paragraph" paraid=…>`.
- Headings are `role="heading" aria-level=N`.
- Each paragraph ends with an `EOP` span holding a non-breaking space, which is trimmed like any trailing space.
- Each list item tends to arrive in its own `<ul>`/`<ol>` (with its own `start`) inside a `ListContainerWrapper`. `data-listid` ties them together, and only the first item's `start` counts.

## Spreadsheets

- **Excel** puts bold and italic in classes (`.xl65 { font-weight:700 }`) and hides rows with `display:none`.
- **Google Sheets** puts styles on each cell, and in-cell links in `<a class="in-cell-link">`.
- `<colgroup>` and `<col>` are dropped.

## Safety

The output is written from scratch by the serializer, not filtered from the input:
- text and attribute values are escaped;
- only the listed elements and attributes are ever written;
- link schemes are checked against the allowed list after redirects are unwrapped;
- image sources must be `http(s):` or `data:image/`.

`<script>`, `<style>`, `<svg>`, `<math>`, `<iframe>`, `<object>`, `<embed>`, forms and media are dropped with their content. The `security/xss` fixture and the vocabulary invariant check this.

## What isn't kept, on purpose

- Colours, fonts, sizes, alignment and indentation: an editor's own styles should decide them.
- Non-breaking spaces: they become ordinary spaces, since Word uses them for spacing and that's almost all of them.
- Empty list items, quotes and paragraphs, unless empty paragraphs are asked for.
