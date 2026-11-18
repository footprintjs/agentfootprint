/** Pure fixed probes for the context-package contract. No file or process effects. */
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import { publicProducerProbe } from './publicProducerProbe.mjs';

export function renderContextProbes(consumerRoot, paired = false) {
  if (typeof paired !== 'boolean') throw new TypeError('Unknown context probe mode');
  const consumer = consumerRoot;
  const verification = `
const assertion = (value, extra = {}) => ({ subject: { kind: 'entity', id: 'node/11' }, predicate: 'latency',
  value, epoch: 2, stratum: 'asserted', provenance: 'packed evidence', runtimeStageId: 'run/stage', ...extra });
const first = assertion({ kind: 'known', value: false }), second = assertion(true);
const facts = [assertion(9, { stratum: 'quoted' }), assertion({ kind: 'unknown', reason: 'not collected' }), first, second];
const legacyKey = 'entity\\u0000node/11\\u0000latency\\u00002';
const result = comparison.conflictsOf(facts);
assert.equal(result.length, 1);
assert.equal(result[0].key, legacyKey);
assert.equal(result[0].assertions[0], first);
assert.equal(result[0].assertions[1], second);
assert.equal(result[0].assertions[0].runtimeStageId, 'run/stage');
assert.equal(helpers.assertionKey(first), legacyKey);
assert.deepEqual(result, shared.conflictsOf(facts, undefined, helpers.assertionKey));
assert.equal(helpers.participates, shared.participates);
assert.equal(helpers.comparableValueOf, shared.comparableValueOf);
assert.equal(helpers.sameSubject, shared.sameSubject);
assert.notEqual(shared.assertionKey(first), legacyKey);
assert.deepEqual(comparison.conflictsOf(facts, new Set(['latency'])), []);
assert.equal('createEvidenceContext' in shared, false);
const own = assertion(JSON.parse('{"__proto__":{"observed":true},"total":4}'));
const omitted = assertion({total:4});
assert.equal(comparison.conflictsOf([own, omitted]).length, 1,
  'The packed dependency must preserve own JSON property names.');
`;
  const probes = [
    {
      id: 'runtime-cjs',
      relativePath: '.context-smoke.cjs',
      phase: 'runtime-and-types',
      body: `
const assert = require('node:assert/strict');
const comparison = require('./dist/integrity/assertion/conflicts.js');
const helpers = require('./dist/integrity/assertion/types.js');
const shared = require('contextfootprint');
const resolved = require.resolve('contextfootprint');
assert.ok(resolved.startsWith(${JSON.stringify(join(consumer, 'node_modules') + sep)}),
  'The consumer must use its installed dependency, not the author workspace.');
${verification}
${paired ? publicProducerProbe('cjs') : ''}`,
    },
    {
      id: 'runtime-esm',
      relativePath: '.context-smoke.mjs',
      phase: 'runtime-and-types',
      body: `
import assert from 'node:assert/strict';
import * as comparison from './dist/esm/integrity/assertion/conflicts.js';
import * as helpers from './dist/esm/integrity/assertion/types.js';
import * as shared from 'contextfootprint';
${verification}
${paired ? publicProducerProbe('esm') : ''}`,
    },
  ];
  for (const { id, relativePath, declarationPath } of [
    { id: 'types-mts', relativePath: '.context-types.mts', declarationPath: 'esm' },
    { id: 'types-cts', relativePath: '.context-types.cts', declarationPath: 'types' },
  ]) {
    probes.push({
      id,
      relativePath,
      phase: 'types-only',
      body: `
import { conflictsOf } from './dist/${declarationPath}/integrity/assertion/conflicts.js';
import { assertionKey, participates, comparableValueOf } from './dist/${declarationPath}/integrity/assertion/types.js';
import type { Assertion, Conflict } from 'contextfootprint';
const row: Assertion = { subject: { kind: 'entity', id: 'one' }, predicate: 'status', value: false,
  stratum: 'asserted', provenance: 'type smoke' };
const conflicts: readonly Conflict[] = conflictsOf([row]);
const key: string = assertionKey(row);
const known: boolean = participates(row.value);
const value: unknown = comparableValueOf(row.value);
void [conflicts, key, known, value];
`,
    });
  }
  return Object.freeze(
    probes.map((probe) =>
      Object.freeze({
        ...probe,
        sha256: createHash('sha256').update(probe.body, 'utf8').digest('hex'),
        size: Buffer.byteLength(probe.body, 'utf8'),
      }),
    ),
  );
}
