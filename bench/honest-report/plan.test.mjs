import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROJECTED_LIMIT_UNITS } from './budget.mjs';
import { cellKey, cells, limits, paidSchedule, projectPreflight } from './plan.mjs';

const schedule = paidSchedule();

function withUsage(inputTokens, outputTokens) {
  return schedule.preflight.map((run) => ({
    ...run,
    requests: [{ accounting: { inputTokens, outputTokens, usageKnown: true } }],
  }));
}

test('each scheduled cell includes ten repeats per legacy task and twenty per hidden task', () => {
  assert.deepEqual(cells.map(({ label, arm }) => cellKey(label, arm)), [
    'published/defaults', 'published/label-on', 'candidate/label-on',
  ]);
  const all = [...schedule.preflight, ...schedule.remaining];
  assert.equal(all.length, 360);
  for (const { label, arm } of cells) {
    const draws = all.filter((item) => item.label === label && item.arm === arm);
    assert.equal(draws.length, 120);
    for (const [taskId, count] of Object.entries({
      'unavailable-tool': 10,
      'refused-call': 10,
      'declined-call': 10,
      'failed-step': 10,
      'empty-search': 10,
      'done-control': 10,
      'hidden-failure': 20,
      'partial-failure': 20,
      'recovered-retry': 20,
    })) {
      assert.deepEqual(draws.filter(({ task }) => task.id === taskId).map(({ repeat }) => repeat),
        Array.from({ length: count }, (_, index) => index + 1));
    }
  }
  assert.equal(limits.maxRequests, 8);
  assert.equal(all.length * limits.maxRequests, 2880);
});

test('preflight uses the first partial-failure draw in each cell', () => {
  assert.equal(schedule.preflight.length, 3);
  assert.equal(schedule.remaining.length, 357);
  assert.deepEqual(schedule.preflight.map(({ task, repeat, ...cell }) => {
    assert.equal(task.id, 'partial-failure');
    assert.equal(repeat, 1);
    return cell;
  }), cells);
  assert.ok(!schedule.remaining.some(({ task, repeat }) => task.id === 'partial-failure' && repeat === 1));
});

test('the projection prices remaining slots and adds settled preflight charges exactly once', () => {
  const rows = withUsage(1000, 200);
  rows[2].requests.push({ accounting: { inputTokens: 2000, outputTokens: 100, usageKnown: true } });
  const estimate = projectPreflight(rows, schedule.remaining, 8000);
  assert.equal(estimate.cells.length, 3);
  assert.ok(estimate.cells.every(({ remainingSlots }) => remainingSlots === 952));
  assert.equal(estimate.projectedUnits, 8000 + 952 * (2000 + 2000 + 3000));
  assert.equal(estimate.canContinue, true);
});

test('the USD 8 ceiling is inclusive', () => {
  const rows = withUsage(1000, 200);
  const projectedRemaining = 3 * 952 * (1000 + 5 * 200);
  const onLimit = PROJECTED_LIMIT_UNITS - projectedRemaining;
  assert.equal(projectPreflight(rows, schedule.remaining, onLimit).canContinue, true);
  assert.equal(projectPreflight(rows, schedule.remaining, onLimit + 1).canContinue, false);
});

test('the projection requires one measured row for each exact cell', () => {
  const [defaults, published, candidate] = withUsage(1000, 200);
  const continues = (rows) => projectPreflight(rows, schedule.remaining, 20_000).canContinue;
  assert.equal(continues([candidate, defaults, published]), true);
  assert.equal(continues([defaults, published]), false);
  assert.equal(continues([defaults, published, published]), false);
  assert.equal(continues([defaults, published, { ...candidate, arm: 'defaults' }]), false);
  assert.equal(continues([defaults, published, { ...candidate, requests: [{}] }]), false);
  assert.equal(continues([defaults, published, candidate, candidate]), false);
});

test('missing usage enters the projection with the settlement fallback, including the output cap', () => {
  const rows = withUsage(1000, 200);
  rows[0].requests.push({ accounting: { inputTokens: 500, outputTokens: 4096, usageKnown: false } });
  const estimate = projectPreflight(rows, schedule.remaining, 24_000);
  assert.deepEqual(estimate.cells[0].peaks, { input: 1000, output: 4096 });
  assert.equal(estimate.cells[0].measuredRequests.at(-1).usageKnown, false);
});
