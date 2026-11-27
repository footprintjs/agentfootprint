import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPhrase, controls } from './manifest.mjs';
import { verify } from './verify.mjs';

test('a missing, substituted, extra or failed cell and a changed runtime each prevent qualification', () => {
  const expected = { from: '2026-01-01T00:00Z', to: '2026-01-01T01:00Z', end: 'exclusive', precision: 'minute' };
  const manifest = ['a', 'b'].map(id => ({ id, form: 'range', expected }));
  const [a, b] = manifest.map(({ id }) => ({ id, pass: true, actual: { ...expected, cutoff: expected.to } }));
  const eligible = (rows, actual = 'pinned') => verify(manifest, rows, 'pinned', actual).range.qualifies;
  assert.ok(eligible([a, b]));
  for (const rows of [[a], [a, a], [a, b, { ...a, id: 'c' }], [a, { ...b, pass: false }], [a, { ...b, actual: { ...b.actual, from: expected.to } }]]) {
    assert.equal(eligible(rows), false);
  }
  assert.equal(eligible([a, b], 'different'), false);
  assert.throws(() => verify([], [], 'x', 'x'));
});
test('unmeasured and ambiguous contexts are outside the exact phrase grammar', () => {
  for (const text of controls) assert.equal(classifyPhrase(text), undefined, text);
});
