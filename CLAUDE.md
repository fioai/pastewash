# CLAUDE.md

pastewash turns the HTML that Word, Google Docs, Excel and other applications put on the clipboard into clean, semantic, safe HTML from a closed vocabulary. It's a TypeScript library; the browser entry uses DOMParser and the Node entry uses parse5.

- **`docs/status.md` is the handoff: read it first.** It covers what's verified, how to test, and what's next.
- `docs/design.md` describes each source's quirks and how they're handled. Update it with any behaviour change.
- `test/fixtures/README.md` says where each fixture came from, and how to add one.

Rules that are easy to break:

- **Expected outputs are written by hand from what the paste shows, never copied from what the code produces.** A test that accepts the code's output can't catch its bugs.
- The invariants must hold for any input: washing twice changes nothing; the output uses only the vocabulary in the README; its text appears in the input in order.
- Node and the browser must agree: run `npm run test:browser` after touching `tree.ts` or anything parser-facing.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
