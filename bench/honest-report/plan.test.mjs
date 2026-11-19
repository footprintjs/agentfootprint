import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROJECTED_LIMIT_UNITS } from './budget.mjs';
import { paidSchedule, projectPreflight } from './plan.mjs';
import { maxRequestsFor } from './tasks.mjs';

const schedule = paidSchedule(['before', 'after']);

function withUsage(inputTokens, outputTokens) {
  return schedule.preflight.map((run) => ({
    ...run,
    requests: [{ accounting: { inputTokens, outputTokens, usageKnown: true } }],
  }));
}

test('four preflight draws are included once in the 480-run schedule', () => {
  const all = [...schedule.preflight, ...schedule.remaining];
  assert.equal(schedule.preflight.length, 4);
  assert.equal(all.length, 480);
  assert.equal(all.filter(({ task }) => task.control).length, 80);
  assert.equal(new Set(all.map(({ arm, label, task, repeat }) => [arm, label, task.id, repeat].join('/'))).size, 480);
  assert.equal(all.reduce((n, { task }) => n + maxRequestsFor(task), 0), 1040);
});

test('the projection prices remaining slots and adds settled preflight charges exactly once', () => {
  const estimate = projectPreflight(withUsage(1000, 200), schedule.remaining, 8000);
  assert.equal(estimate.cells.length, 4);
  assert.ok(estimate.cells.every(({ remainingSlots }) => remainingSlots === 257));
  assert.equal(estimate.projectedUnits, 8000 + 4 * 257 * 2000);
  assert.equal(estimate.canContinue, true);
});

test('the USD 8 ceiling is inclusive and an unmeasurable cell cannot continue', () => {
  const empty = withUsage(0, 0);
  assert.equal(projectPreflight(empty, schedule.remaining, PROJECTED_LIMIT_UNITS).canContinue, true);
  assert.equal(projectPreflight(empty, schedule.remaining, PROJECTED_LIMIT_UNITS + 1).canContinue, false);
  assert.equal(projectPreflight(empty.slice(1), schedule.remaining, 0).canContinue, false);
});

test('missing usage enters the projection with the settlement fallback, including the output cap', () => {
  const rows = withUsage(1000, 200);
  rows[0].requests.push({ accounting: { inputTokens: 500, outputTokens: 4096, usageKnown: false } });
  const estimate = projectPreflight(rows, schedule.remaining, 24_000);
  assert.deepEqual(estimate.cells[0].peaks, { input: 1000, output: 4096 });
  assert.equal(estimate.cells[0].measuredRequests.at(-1).usageKnown, false);
});
