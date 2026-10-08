import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wash } from '../src/node.ts';
import { fixtures } from './support.ts';

for (const f of fixtures()) {
  test(f.id, () => {
    const result = wash(f.input, f.options);
    assert.equal(result.html, f.expected);
    assert.equal(result.source, f.source);
  });
}
