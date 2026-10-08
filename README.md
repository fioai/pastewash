# pastewash

Clean up HTML pasted from Word, Google Docs, Excel and the web.

When someone pastes into a rich-text editor, the clipboard's HTML is whatever the application they copied from decided to write:

- **Word** writes lists as paragraphs with `mso-list: l0 level2 lfo1` and the bullet as text in a hidden span, wraps it all in Office namespaces and conditional comments, and points images at its temp folder (`file:///C:/Users/…/clip_image001.png`).
- **Google Docs** wraps the whole paste in `<b style="font-weight:normal">`, so a naive cleaner makes everything bold. It writes bold as `font-weight:700` on a span, and nests lists by putting a `<ul>` directly inside a `<ul>`.
- **Word for the web** gives every list item its own list, and can mark bold with a class that has no CSS.
- **Excel and Apple's apps** put the formatting in a `<style>` block.
- **A web page** arrives with every computed style written out inline.

Editors, CMSs and email composers each end up writing their own cleanup, and the thorough ones are paid add-ons or built into one editor. pastewash is that cleanup as a library, for any editor:

```js
import { wash } from 'pastewash';

editor.addEventListener('paste', (event) => {
  const html = event.clipboardData?.getData('text/html');
  if (!html) return;
  event.preventDefault();
  const { html: clean } = wash(html);
  insertHtml(clean); // your editor's way of inserting HTML
});
```

```html
<!-- Word's list, about 1,500 characters of it, becomes: -->
<ul><li>Passport</li><li>Chargers for the <strong>phone</strong> and laptop<ul><li>USB-C</li><li>Lightning</li></ul></li></ul>
```

In Node, or anywhere without a `DOMParser`, import from `pastewash/node` instead. It parses with [parse5](https://github.com/inikulin/parse5), which follows the same HTML standard as browsers, and a test checks that Node and Chromium give identical output.

## What comes out

Only these elements and attributes, whatever went in:

| | |
|---|---|
| Blocks | `p`, `h1`–`h6`, `ul`, `ol` (`start`), `li` (`data-checked` for task lists), `blockquote`, `pre`, `hr`, `table`, `tbody`, `tr`, `th`/`td` (`colspan`, `rowspan`) |
| Inline | `strong`, `em`, `u`, `s`, `code`, `sub`, `sup`, `a` (`href`), `img` (`src`, `alt`), `br` |

Formatting is worked out from tags and from CSS (inline styles and `<style>` rules), so `<span style="font-weight:700">` and `<td class=xl65>` both come out as `<strong>`. Marks are always nested in the same order and merged where they meet, and whitespace is collapsed the way a browser displays it.

What's left out:
- colours, fonts, sizes and alignment;
- comments and footnote separators;
- hidden text;
- scripts, styles, forms, embedded objects;
- every class, id, style and event handler.

Links keep only `http`, `https`, `mailto` and `tel` addresses (configurable). Google's and Outlook's redirect wrappers are taken off. Relative links and `#fragments` become plain text, because they pointed into the document the text was copied from.

Images are kept when they're `data:` or `http(s)` URLs. Images whose address can't be loaded where the paste lands are dropped:
- `file:` (Word's temp folder);
- `cid:` (email attachments);
- relative or `blob:` URLs (the source page).

Every image is listed in the result, so an editor can replace the dropped ones with the image files that were also on the clipboard.

The output is safe to insert because it's built from scratch out of that vocabulary, not by filtering the input.

## The result

```ts
wash(html: string, options?: Options): {
  html: string;                    // the clean HTML
  source: 'word' | 'word-online' | 'google-docs' | 'google-sheets'
        | 'excel' | 'libreoffice' | 'apple' | 'web';
  images: { src: string; alt: string; kept: boolean; reason?: 'unreachable' | 'option' }[];
}
```

## Options

| Option | Default | |
|---|---|---|
| `keepEmptyParagraphs` | `false` | Keep blank paragraphs, as `<p><br></p>`. |
| `images` | `'keep'` | `'drop'` leaves all images out (they're still listed). |
| `code` | `true` | Text in a monospace font (Courier, Consolas, Menlo, …) becomes `<code>`. |
| `linkSchemes` | `['http', 'https', 'mailto', 'tel']` | The URL schemes a link may have. |
| `trackChanges` | `'accept'` | Word's tracked changes: `'accept'` keeps insertions, `'reject'` keeps deletions. |

## Sources

| | Recognised by | What's special |
|---|---|---|
| Word | Office namespaces, `Mso` classes | lists from `mso-list` and `@list` rules; filtered HTML's lists from the marker and indent; Title style; comments, footnotes, tracked changes, VML images |
| Word for the web | its class names, `paraid` | one-item lists joined by `data-listid` and nested by `data-aria-level`; `role="heading"`; bold by class |
| Google Docs | `docs-internal-guid` | the bold wrapper; lists nested by `aria-level`; checklists (their checkbox images are dropped) |
| Google Sheets, Excel | their markers | tables; formatting from cell styles and classes; hidden rows |
| LibreOffice, TextEdit | `generator` meta | formatting from `<style>` rules and `<font face>` |
| Anything else | | ordinary HTML, including Chrome's inline computed styles |

How each is handled, and why, is in [docs/design.md](docs/design.md).

## How it's tested

- **Fixtures:** one or more per source. Each expected output was written by hand before running the code, so a test can catch a bug instead of enshrining it. The Google Docs ones are real captures, from [Lexical](https://github.com/facebook/lexical)'s tests. The others are reconstructions in each application's format. [`tools/capture.html`](tools/capture.html) collects real ones, and they're very welcome.
- **Invariants,** over every fixture and 2,000 random, often malformed documents per run (30,000 more, each with three sets of options, were run once):
  - washing the output again changes nothing;
  - the output uses only the vocabulary above;
  - its text appears in the input in the same order, so nothing is made up or moved.
- **The browser:** every fixture and 300 random documents are washed in headless Chromium with the real `DOMParser`, and must match Node's output exactly.

```sh
npm test              # Node 22.18 or later
npm run test:browser  # builds, then needs Chromium ($CHROME or chromium on the PATH)
```

## Limits

- The Word, Excel and Apple fixtures are reconstructions, not captures. Real pastes from versions not covered may hold surprises; please send them.
- Non-breaking spaces become ordinary spaces. Word uses them for spacing, which is almost all of them.
- Lists from Word documents that don't use Word's list feature (typed "1." and a tab) stay paragraphs.
- Plain-text and RTF clipboard formats aren't handled; this is for `text/html`.

## Prior art

- [Quill](https://github.com/slab/quill)'s `normalizeExternalHTML` (Google Docs' bold wrapper, Word's lists), built into Quill.
- CKEditor 5's paste-from-Office, GPL and built into CKEditor.
- TinyMCE's PowerPaste, a paid plugin.

## License

MIT. See [LICENSE](LICENSE).
