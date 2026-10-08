# Fixtures

Each `<source>/<name>.html` is what an application put on the clipboard as `text/html`. Next to it, `<name>.expected.html` is the washed result, written by hand from what the paste shows. Writing the expected output first, rather than accepting whatever the code produces, is what lets a fixture catch a bug. An optional `<name>.options.json` holds the options to wash with. The directory name is the source the paste must be recognised as (`security/` is expected to be `web`).

Every fixture also goes through the invariant checks in `../invariants.test.ts`, and through Chromium in `../browser/run.ts`.

## Where they came from

- **`google-docs/`**: real captures from Google Docs. They were taken from the tests of [Lexical](https://github.com/facebook/lexical) (`packages/lexical-playground/src/__tests__/browser/TextFormatHTMLCopyAndPaste.test.ts`, `TablesHTMLCopyAndPaste.test.ts`, `packages/lexical/src/__tests__/unit/HTMLCopyAndPaste.test.ts`), MIT License, Copyright (c) Meta Platforms, Inc. and affiliates.
- **`word/`**, **`word-online/`**, **`excel/`**, **`google-sheets/`**, **`libreoffice/`**, **`apple/`**, **`web/`**: written for pastewash in each application's format, with made-up text. The structure follows these applications' output as documented in other editors' code and seen in Word-generated HTML published online. They are reconstructions, not captures: replace them with real ones as they come in.
- **`security/`**: hostile input, written for pastewash.

## Adding one

1. Open `tools/capture.html` in a browser.
2. Paste from the application, and save the `text/html` part.
3. Put it in the source's directory, write `<name>.expected.html` from what you see, and run `npm test`.

Captures are welcome as pull requests. Check the text first: a clipboard can carry more than you meant to share, such as names, file paths and comments.
