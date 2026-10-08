import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseDeclarations, Stylesheet } from '../src/css.ts';
import { wash } from '../src/node.ts';

const html = (input: string, options = {}) => wash(input, options).html;
const WORD = '<html xmlns:w="urn:schemas-microsoft-com:office:word"><body>';

describe('css', () => {
  test('declarations: quotes and parentheses hide semicolons, !important is dropped', () => {
    const d = parseDeclarations(`font-family:"A;B", sans-serif; background:url(a;b) ; COLOR: red !important;bad`);
    assert.deepEqual([...d], [
      ['font-family', '"A;B", sans-serif'],
      ['background', 'url(a;b)'],
      ['color', 'red'],
    ]);
  });

  test("stylesheets: Word's comment wrapper, @list rules, and specificity", () => {
    const sheet = new Stylesheet([
      `<!-- p {font-weight:400} p.x {font-weight:700} .x {font-style:italic}
         @list l3:level2 {mso-level-number-format:alpha-lower;} @media print { p {color:red} } -->`,
    ]);
    const el = { kind: 'element', tag: 'p', attrs: new Map([['class', 'X']]), children: [] } as const;
    const d = sheet.declared(el);
    assert.equal(d.get('font-weight'), '700');
    assert.equal(d.get('font-style'), 'italic');
    assert.equal(d.get('color'), undefined);
    assert.equal(sheet.lists.get('l3:level2')?.get('mso-level-number-format'), 'alpha-lower');
  });
});

describe('formatting', () => {
  test('an explicit normal weight undoes <b>, as in Google Docs', () => {
    assert.equal(html('<b style="font-weight:normal">plain <span style="font-weight:700">bold</span></b>'), '<p>plain <strong>bold</strong></p>');
  });

  test('marks nest in one order, and a space between runs takes only what they share', () => {
    assert.equal(html('<i><b>a</b></i> <b><i>b</i></b>'), '<p><strong><em>a b</em></strong></p>');
    assert.equal(html('<b>a</b> <i>b</i>'), '<p><strong>a</strong> <em>b</em></p>');
  });

  test("text-decoration: none on <u> itself undoes it; an ancestor's underline still shows", () => {
    assert.equal(html('<u style="text-decoration:none">a</u>'), '<p>a</p>');
    assert.equal(html('<u>a<span style="text-decoration:none">b</span></u>'), '<p><u>ab</u></p>');
  });

  test('super- and subscript from vertical-align', () => {
    assert.equal(html('x<span style="vertical-align:super">2</span>y<span style="vertical-align:sub">i</span>'), '<p>x<sup>2</sup>y<sub>i</sub></p>');
  });

  test('monospace fonts become <code> unless code: false; <code> itself stays', () => {
    assert.equal(html('<span style="font-family:Consolas">x</span>'), '<p><code>x</code></p>');
    assert.equal(html('<span style="font-family:Consolas">x</span>', { code: false }), '<p>x</p>');
    assert.equal(html('<code>x</code>', { code: false }), '<p><code>x</code></p>');
  });

  test('hidden text is left out', () => {
    assert.equal(html('a<span style="display:none">b</span><span style="visibility:hidden">c</span>d'), '<p>ad</p>');
  });
});

describe('whitespace', () => {
  test('collapsed as a browser shows it, &nbsp; included, and trimmed at the edges', () => {
    assert.equal(html('<p>\n  a&nbsp;&nbsp; b\t c  </p>'), '<p>a b c</p>');
  });

  test('line breaks at the edges of a paragraph go, those inside stay', () => {
    assert.equal(html('<p><br>a<br><br>b<br></p>'), '<p>a<br><br>b</p>');
  });

  test('empty paragraphs go, unless asked for', () => {
    assert.equal(html('<p>a</p><p>&nbsp;</p><p></p><p>b</p>'), '<p>a</p>\n<p>b</p>');
    assert.equal(html('<p>a</p><p>&nbsp;</p><p>b</p>', { keepEmptyParagraphs: true }), '<p>a</p>\n<p><br></p>\n<p>b</p>');
  });

  test('<pre> keeps its whitespace', () => {
    assert.equal(html('<pre>a  b\n  c<br>d</pre>'), '<pre>a  b\n  c\nd</pre>');
  });
});

describe('links', () => {
  test('only allowed schemes; relative links and fragments become text', () => {
    assert.equal(
      html('<a href="https://a.example">a</a> <a href="mailto:x@y.z">b</a> <a href="/c">c</a> <a href="#d">d</a> <a href="javascript:e()">e</a>'),
      '<p><a href="https://a.example">a</a> <a href="mailto:x@y.z">b</a> c d e</p>',
    );
    assert.equal(html('<a href="ftp://f.example">f</a>', { linkSchemes: ['ftp'] }), '<p><a href="ftp://f.example">f</a></p>');
  });

  test('Google and Outlook redirects are unwrapped', () => {
    assert.equal(
      html('<a href="https://www.google.com/url?q=https://real.example/page&sa=D">g</a>'),
      '<p><a href="https://real.example/page">g</a></p>',
    );
    assert.equal(
      html('<a href="https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Freal.example%2F&data=x">o</a>'),
      '<p><a href="https://real.example/">o</a></p>',
    );
  });
});

describe('images', () => {
  test('kept, dropped and reported', () => {
    const r = wash('<img src="https://a.example/i.png" alt="a"><img src="file:///C:/x.png"><img src="data:image/png;base64,AA" alt="d"><img src="cid:123">');
    assert.equal(r.html, '<p><img src="https://a.example/i.png" alt="a"><img src="data:image/png;base64,AA" alt="d"></p>');
    assert.deepEqual(r.images.map((i) => [i.kept, i.reason ?? '']), [
      [true, ''],
      [false, 'unreachable'],
      [true, ''],
      [false, 'unreachable'],
    ]);
  });

  test("images: 'drop' drops them all, and says so", () => {
    const r = wash('<p>a<img src="https://a.example/i.png"></p>', { images: 'drop' });
    assert.equal(r.html, '<p>a</p>');
    assert.deepEqual(r.images, [{ src: 'https://a.example/i.png', alt: '', kept: false, reason: 'option' }]);
  });
});

describe('lists', () => {
  test('real nesting, with text after a nested list kept in its place', () => {
    assert.equal(html('<ul><li>a<ul><li>b</li></ul>c</li></ul>'), '<ul><li><p>a</p><ul><li>b</li></ul><p>c</p></li></ul>');
  });

  test('a list nested directly in a list (Google Docs) joins the item before it', () => {
    assert.equal(html('<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>'), '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
  });

  test('levels that skip nest one deeper; bullets after numbers start a new list', () => {
    assert.equal(
      html('<ol><li aria-level="1">a</li><li aria-level="3">b</li></ol><ul><li aria-level="1">c</li></ul>'),
      '<ol><li>a<ol><li>b</li></ol></li></ol>\n<ul><li>c</li></ul>',
    );
  });

  test('<ol start> and task lists in their three spellings', () => {
    assert.equal(html('<ol start="4"><li>d</li></ol>'), '<ol start="4"><li>d</li></ol>');
    assert.equal(
      html('<ul><li><input type="checkbox" checked disabled> a</li><li role="checkbox" aria-checked="false">b</li><li data-checked="true">c</li></ul>'),
      '<ul><li data-checked="true">a</li><li data-checked="false">b</li><li data-checked="true">c</li></ul>',
    );
  });

  test("Word's marker decides numbering when there's no @list rule, and gives the start", () => {
    const p = (marker: string, text: string) =>
      `<p class=MsoListParagraph style="mso-list:l9 level1 lfo1"><span style="mso-list:Ignore">${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp; </span></span>${text}</p>`;
    assert.equal(html(`${WORD}${p('7.', 'seven')}${p('8.', 'eight')}`), '<ol start="7"><li>seven</li><li>eight</li></ol>');
    assert.equal(html(`${WORD}${p('•', 'dot')}`), '<ul><li>dot</li></ul>');
  });
});

describe('tables', () => {
  test('header cells and spans; a single paragraph in a cell is unwrapped', () => {
    assert.equal(
      html('<table><tr><th colspan="2">h</th></tr><tr><td rowspan="2"><p>a</p></td><td><p>b</p><p>c</p></td></tr></table>'),
      '<table><tbody><tr><th colspan="2">h</th></tr><tr><td rowspan="2">a</td><td><p>b</p><p>c</p></td></tr></tbody></table>',
    );
  });
});

describe('Word', () => {
  test("tracked changes: accepted by default, or rejected", () => {
    const input = `${WORD}<p class=MsoNormal>at <del cite="mailto:x">nine</del><ins cite="mailto:x">ten</ins></p>`;
    assert.equal(html(input), '<p>at ten</p>');
    assert.equal(html(input, { trackChanges: 'reject' }), '<p>at nine</p>');
  });

  test('outside Word, <del> is struck-through text and <ins> plain', () => {
    assert.equal(html('<del>a</del><ins>b</ins>'), '<p><s>a</s>b</p>');
  });

  test("Word for the web's headings, and its bold class", () => {
    assert.equal(
      html('<p class="Paragraph" paraid="1" role="heading" aria-level="3"><span class="TextRun MacChromeBold">T</span></p>'),
      '<h3><strong>T</strong></h3>',
    );
  });
});

describe('sources', () => {
  const cases: [string, string][] = [
    ['<b id="docs-internal-guid-1">x</b>', 'google-docs'],
    ['<google-sheets-html-origin><table><tr><td>x</td></tr></table></google-sheets-html-origin>', 'google-sheets'],
    ['<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body>x', 'excel'],
    [`${WORD}x`, 'word'],
    ['<p class=MsoNormal>x</p>', 'word'],
    ['<p class="Paragraph" paraid="1">x</p>', 'word-online'],
    ['<meta name="generator" content="LibreOffice 24.8"><p>x</p>', 'libreoffice'],
    ['<meta name="Generator" content="Cocoa HTML Writer"><p>x</p>', 'apple'],
    ['<p>x</p>', 'web'],
  ];
  for (const [input, source] of cases) {
    test(source, () => assert.equal(wash(input).source, source));
  }
});

test('nothing in, nothing out', () => {
  assert.deepEqual(wash(''), { html: '', source: 'web', images: [] });
  assert.equal(html('   \n  '), '');
});
