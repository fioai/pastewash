# Status

Where pastewash stands, how to work on it, and what's next. Read this first.

## State (2026-10-08)

Version 0.1.0, not published.

- `src/` is about 1,000 lines of TypeScript, with no dependencies but parse5, which only the Node entry uses.
- The entry points are `pastewash` (browser, `DOMParser`), `pastewash/node` (parse5) and `pastewash/core` (`washParsed`, for bringing your own parser).

What's been verified:

- **The fixtures**, 15 of them across 8 sources plus a security set. Each expected output was written by hand before the code ran.
  - The Google Docs ones are real captures, from Lexical's tests (MIT).
  - The rest are reconstructions. The Word ones follow the structure of real Word HTML: unfiltered `mso-list` lists as in Quill's tests, and filtered lists checked against Word-generated HTML found online.
- **The invariants** (idempotent, closed vocabulary, text kept in order), over every fixture and 2,000 random documents in every `npm test`. An extra 30,000 seeds were also run once with 3 option sets.
  - Random testing found two real bugs: text after a nested list was moved before it, and adjacent nested lists merged on a second wash. Both are fixed, and each is now covered.
- **The browser and Node give the same results** (`npm run test:browser`): every fixture and 300 random documents in headless Chromium.

Not verified:

- **Real Word, Word for the web, Excel and Apple captures.** The reconstructions could be wrong in details that matter. Word for the web's `MacChromeBold` class and one-item lists come from other editors' handling of it, not from a capture.
- Pastes from Outlook, Notion, Slack, Pages, and Firefox and Safari's own copy formats.

## How to work

```sh
npm install
npm run check          # tsc, strict
npm test               # ~1 s; needs Node 22.18+ (runs the TypeScript directly)
npm run test:browser   # builds dist/, then Chromium ($CHROME or chromium on the PATH)
```

- To replay a random document from a failure message (`seed 123`), use `randomHtml(rng(123))` from `test/support.ts`.
- Every behaviour change gets a fixture or a unit test, with the expected output written by hand first.
- A new source gets a directory in `test/fixtures/` and a row in `docs/design.md`.

## Next

1. **Real captures.** Use `tools/capture.html` to collect them from Word (Windows and Mac), Word for the web, Excel, Outlook, Pages and Notion, and replace the reconstructions. This is the most valuable next step.
2. **Publish** to npm, and put the repository on GitHub with CI (`.github/workflows/ci.yml` is ready).
3. **Images on the clipboard.** Pair Word's `file:` images with the image files on the clipboard, or say how in the README, with an example for `DataTransfer.files`.
4. **Options for editors that want more:**
   - keep text alignment;
   - keep colours;
   - map headings down a level (h1 → h2) for editors where h1 is the title.
5. **Lists typed by hand** (`1.` and a tab, no list feature): turn them into lists, carefully, since false positives would be worse.
