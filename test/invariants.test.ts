/**
 * What must hold for any input: washing twice changes nothing more, the output uses only the
 * allowed elements, attributes, link schemes and image sources, and no text is made up.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wash } from '../src/node.ts';
import { fixtures, letters, randomHtml, rng, vocabularyProblems } from './support.ts';

function check(input: string, label: string, options = {}) {
  const once = wash(input, options).html;
  const twice = wash(once, options).html;
  assert.equal(twice, once, `${label}: washing again changed it`);
  assert.deepEqual(vocabularyProblems(once), [], `${label}: ${once}`);
  // Washing only leaves things out; it never reorders. So the output's characters appear in the
  // input, in the same order.
  const source = letters(input);
  const output = letters(once);
  let at = 0;
  for (const c of output) {
    at = source.indexOf(c, at);
    assert.ok(at >= 0, `${label}: the output's text isn't the input's: ${output}`);
    at += c.length;
  }
}

for (const f of fixtures()) {
  test(`invariants hold for ${f.id}`, () => check(f.input, f.id, f.options));
}

test('invariants hold for 2000 random documents', () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const html = randomHtml(rng(seed));
    check(html, `seed ${seed}`);
    check(html, `seed ${seed} keeping empty paragraphs`, { keepEmptyParagraphs: true });
  }
});
