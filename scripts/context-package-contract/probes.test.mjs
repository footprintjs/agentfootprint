import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { renderContextProbes } from './probes.mjs';

const digest = (body) => createHash('sha256').update(body, 'utf8').digest('hex');
const FIXED = [
  ['runtime-cjs', '.context-smoke.cjs', 'runtime-and-types'],
  ['runtime-esm', '.context-smoke.mjs', 'runtime-and-types'],
  ['types-mts', '.context-types.mts', 'types-only'],
  ['types-cts', '.context-types.cts', 'types-only'],
];

// Independently rendered from original gate blob ef800389a4a2798dd1e3685170333d193043d209.
// Only CJS's one JSON-quoted consumer prefix is replaced by a fixed marker for this
// platform-independent test. This normalization is not an installed-file admission rule.
const ORIGINAL_BODY_DIGESTS = [
  '6ae42edaa68fd228c586a338578cca7397c1adaf611a72e8e604e78507b4737b',
  '8fcac4c757d4602a1667e0cf8343658f8d940cf860d198a8ff77132b48ecdbb6',
  '53d0eb8586bec4467ba7bd647334cb8283f7ef0ca893e0ee0a3413f1e9b8d496',
  '37e9f552c5f820a45968cab9d3640f1b3523d31f84db9b76c0c044e68c3f7993',
];

test('renders only the four reserved probes with their exact lifetime and descriptor fields', () => {
  const probes = renderContextProbes(join('fixed', 'consumer'));
  assert.deepEqual(
    probes.map(({ id, relativePath, phase }) => [id, relativePath, phase]),
    FIXED,
  );
  for (const probe of probes) {
    assert.deepEqual(Object.keys(probe).sort(), [
      'body',
      'id',
      'phase',
      'relativePath',
      'sha256',
      'size',
    ]);
  }
});

test('preserves every original rendered assertion and declaration byte', () => {
  const root = join('fixed', 'consumer');
  const probes = renderContextProbes(root);
  const prefix = JSON.stringify(join(root, 'node_modules') + sep);
  assert.equal(probes[0].body.split(prefix).length, 2, 'the exact prefix occurs once');
  const normalizedCjs = probes[0].body.replace(prefix, JSON.stringify('@consumer-node-modules@'));
  assert.deepEqual(
    [normalizedCjs, ...probes.slice(1).map(({ body }) => body)].map(digest),
    ORIGINAL_BODY_DIGESTS,
  );
});

test('hashes and sizes the actual UTF-8 body, including a non-ASCII consumer path', () => {
  const root = join('fixed', 'μ-🧪-consumer');
  const probes = renderContextProbes(root);
  for (const probe of probes) {
    assert.equal(typeof probe.body, 'string');
    assert.equal(probe.sha256, digest(probe.body));
    assert.equal(probe.size, Buffer.byteLength(probe.body, 'utf8'));
  }
  assert.ok(probes[0].size > probes[0].body.length, 'bytes differ from UTF-16 string length');
});

test('JSON-quotes the entire consumer-local node_modules prefix without changing other bodies', () => {
  const root = join('fixed', 'quote-"-backslash-\\and-newline-\n-μ');
  const probes = renderContextProbes(root);
  const marker = 'assert.ok(resolved.startsWith(';
  const start = probes[0].body.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length);
  const end = probes[0].body.indexOf('),\n', start);
  assert.ok(end > start);
  const literal = probes[0].body.slice(start, end);
  const expected = join(root, 'node_modules') + sep;
  assert.equal(literal, JSON.stringify(expected));
  assert.equal(JSON.parse(literal), expected);
  const otherRoot = renderContextProbes(join('different', 'consumer'));
  assert.notEqual(probes[0].body, otherRoot[0].body);
  assert.deepEqual(
    probes.slice(1).map(({ body }) => body),
    otherRoot.slice(1).map(({ body }) => body),
  );
});

test('keeps the two declaration modes pointed at their original installed declaration trees', () => {
  const probes = renderContextProbes(join('fixed', 'consumer'));
  assert.ok(probes[2].body.includes("from './dist/esm/integrity/assertion/conflicts.js'"));
  assert.ok(probes[2].body.includes("from './dist/esm/integrity/assertion/types.js'"));
  assert.ok(probes[3].body.includes("from './dist/types/integrity/assertion/conflicts.js'"));
  assert.ok(probes[3].body.includes("from './dist/types/integrity/assertion/types.js'"));
});

test('returns immutable independent descriptors without sharing mutable output between roots', () => {
  const root = join('fixed', 'consumer');
  const first = renderContextProbes(root);
  const again = renderContextProbes(root);
  assert.ok(Object.isFrozen(first));
  assert.notEqual(first, again);
  assert.deepEqual(first, again);
  for (let i = 0; i < first.length; i++) {
    assert.ok(Object.isFrozen(first[i]));
    assert.notEqual(first[i], again[i]);
  }
  assert.throws(() => first.push(first[0]), TypeError);
  assert.throws(() => {
    first[0].body = 'changed';
  }, TypeError);
  assert.throws(() => {
    first[0].relativePath = '.context-extra.cjs';
  }, TypeError);
  assert.throws(() => {
    first[0].sha256 = 'changed';
  }, TypeError);
  assert.deepEqual(renderContextProbes(root), again);
});
