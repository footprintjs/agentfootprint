import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROJECTED_LIMIT_UNITS } from './budget.mjs';
import { cellKey, cells, limits, paidSchedule, projectPreflight, released16Cells } from './plan.mjs';

const schedule = paidSchedule();

function withUsage(inputTokens, outputTokens) {
  return schedule.preflight.map((run) => ({
    ...run,
    requests: [{ accounting: { inputTokens, outputTokens, usageKnown: true } }],
  }));
}

test('each scheduled cell includes ten repeats per legacy task and twenty per hidden task', () => {
  assert.deepEqual(cells.map(({ label, arm }) => cellKey(label, arm)), [
    'published/label-on', 'candidate/label-on',
  ]);
  const all = [...schedule.preflight, ...schedule.remaining];
  assert.equal(all.length, 280);
  for (const { label, arm } of cells) {
    const draws = all.filter((item) => item.label === label && item.arm === arm);
    assert.equal(draws.length, 140);
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
      'pending-acceptance': 20,
    })) {
      assert.deepEqual(draws.filter(({ task }) => task.id === taskId).map(({ repeat }) => repeat),
        Array.from({ length: count }, (_, index) => index + 1));
    }
  }
  assert.equal(limits.maxRequests, 8);
  assert.equal(all.length * limits.maxRequests, 2240);
});

test('preflight uses the first partial-failure draw in each cell', () => {
  assert.equal(schedule.preflight.length, 2);
  assert.equal(schedule.remaining.length, 278);
  assert.deepEqual(schedule.preflight.map(({ task, repeat, ...cell }) => {
    assert.equal(task.id, 'partial-failure');
    assert.equal(repeat, 1);
    return cell;
  }), cells);
  assert.ok(!schedule.remaining.some(({ task, repeat }) => task.id === 'partial-failure' && repeat === 1));
});

test('the projection prices remaining slots and adds settled preflight charges exactly once', () => {
  const rows = withUsage(1000, 200);
  rows[1].requests.push({ accounting: { inputTokens: 1300, outputTokens: 100, usageKnown: true } });
  const estimate = projectPreflight(rows, schedule.remaining, 5800);
  assert.equal(estimate.cells.length, 2);
  assert.ok(estimate.cells.every(({ remainingSlots }) => remainingSlots === 1112));
  assert.equal(estimate.projectedUnits, 5800 + 1112 * (2000 + 2300));
  assert.equal(estimate.canContinue, true);
});

test('the USD 4 ceiling is inclusive', () => {
  const rows = withUsage(1000, 200);
  const projectedRemaining = 2 * 1112 * (1000 + 5 * 200);
  const onLimit = PROJECTED_LIMIT_UNITS - projectedRemaining;
  const atLimit = projectPreflight(rows, schedule.remaining, onLimit);
  assert.equal(atLimit.projectedUsd, 4);
  assert.equal(atLimit.canContinue, true);
  const aboveLimit = projectPreflight(rows, schedule.remaining, onLimit + 1);
  assert.equal(aboveLimit.projectedUsd, 4.0000005);
  assert.equal(aboveLimit.canContinue, false);
});

test('the projection requires one measured row for each exact cell', () => {
  const [published, candidate] = withUsage(1000, 200);
  const continues = (rows) => projectPreflight(rows, schedule.remaining, 20_000).canContinue;
  assert.equal(continues([candidate, published]), true);
  assert.equal(continues([published]), false);
  assert.equal(continues([published, published]), false);
  assert.equal(continues([published, { ...candidate, arm: 'defaults' }]), false);
  assert.equal(continues([published, { ...candidate, requests: [{}] }]), false);
  assert.equal(continues([published, candidate, candidate]), false);
});

test('release 16 schedules both arms of one package and prices their preflights separately', () => {
  const schedule16 = paidSchedule(released16Cells);
  const all = [...schedule16.preflight, ...schedule16.remaining];
  assert.equal(all.length, 280);
  for (const arm of ['default', 'label-off']) {
    assert.equal(all.filter((run) => run.label === 'released16' && run.arm === arm).length, 140);
  }
  const measured = schedule16.preflight.map((run) => ({
    ...run,
    requests: [{ accounting: { inputTokens: 1000, outputTokens: 200, usageKnown: true } }],
  }));
  assert.equal(projectPreflight(measured, schedule16.remaining, 0, released16Cells).canContinue, true);
  const [first] = measured;
  assert.equal(projectPreflight([first, first], schedule16.remaining, 0, released16Cells).canContinue, false);
});

test('missing usage enters the projection with the settlement fallback, including the output cap', () => {
  const rows = withUsage(1000, 200);
  rows[0].requests.push({ accounting: { inputTokens: 500, outputTokens: 4096, usageKnown: false } });
  const estimate = projectPreflight(rows, schedule.remaining, 24_000);
  assert.deepEqual(estimate.cells[0].peaks, { input: 1000, output: 4096 });
  assert.equal(estimate.cells[0].measuredRequests.at(-1).usageKnown, false);
  assert.equal(estimate.canContinue, false);
});
