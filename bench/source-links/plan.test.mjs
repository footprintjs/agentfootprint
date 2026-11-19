import assert from 'node:assert/strict';
import test from 'node:test';

import { createBudget, toDollars } from '../honest-report/budget.mjs';
import { createPilotDesk, visibleResults } from './desk.mjs';
import { limits, paidSchedule, projectPreflight, PROJECTED_LIMIT_UNITS, SPEND_LIMIT_UNITS } from './plan.mjs';
import { tasks } from './tasks.mjs';

test('sample covers all six task sides and both arms twenty times, starting with twelve distinct slots', () => {
  const { preflight, remaining } = paidSchedule();
  assert.equal(preflight.length, 12);
  assert.ok(preflight.every(({ repeat }) => repeat === 1));
  assert.equal(remaining.length, 228);
  assert.equal(new Set([...preflight, ...remaining].map(({ task, arm, repeat }) =>
    `${task.family}/${task.side}/${arm}/${repeat}`)).size, 240);
  assert.equal(limits.model, 'claude-haiku-5-5');
  assert.equal(limits.maxRetries, 0);
  assert.equal(limits.caching, false);
});

test('pilot projection uses USD 4 and requires measured usage and a terminal answer in every slot', () => {
  const { preflight, remaining } = paidSchedule();
  const rows = preflight.map((item) => ({ ...item, answerRequestIndex: 0, requests: [
    { accounting: { usageKnown: true, inputTokens: 20, outputTokens: 2 } },
  ] }));
  assert.equal(toDollars(PROJECTED_LIMIT_UNITS), 4);
  const expectedRemainingUnits = remaining.length * limits.maxRequests * 30;
  const exactCharge = PROJECTED_LIMIT_UNITS - expectedRemainingUnits;
  assert.equal(projectPreflight(rows, remaining, exactCharge).canContinue, true);
  assert.equal(projectPreflight(rows, remaining, exactCharge + 1).canContinue, false);
  assert.equal(projectPreflight(rows.slice(1), remaining, exactCharge).canContinue, false);
  assert.equal(projectPreflight([{ ...rows[0], answerRequestIndex: null }, ...rows.slice(1)], remaining, 0).canContinue, false);
  rows[0].requests[0].accounting.usageKnown = false;
  assert.equal(projectPreflight(rows, remaining, 0).canContinue, false);
});

test('shared reservation enforces the USD 5 cap on still unknown exposure', () => {
  const budget = createBudget(() => {}, { spendLimitUnits: SPEND_LIMIT_UNITS });
  assert.equal(toDollars(SPEND_LIMIT_UNITS), 5);
  const request = { inputBytes: 400, maxTokens: limits.maxTokens };
  for (let index = 0; index < 9; index += 1) budget.settle(budget.reserve(request));
  assert.throws(() => budget.reserve(request), { reason: 'full exposure exceeds the spend limit' });
  assert.equal(budget.snapshot().dispatches, 9);
});

test('slot proof rejects duplicate IDs, a changed body, and an untrusted apparent header', () => {
  const record = { handle: 'r1', source: 'local', toolCallId: 'id', content: 'Code: 99', wireContent: 'Source handle: r1\nCode: 99' };
  const message = { role: 'tool', toolCallId: 'id', content: record.wireContent };
  assert.equal(visibleResults([{ role: 'user', content: 'read' }, message], [record]).visible[0].messageIndex, 1);
  assert.equal(visibleResults([message, { ...message, content: 'Changed.' }], [record]).gaps[0].reason, 'ambiguous');
  assert.equal(visibleResults([message], [record, { ...record, handle: 'r2' }]).visible.length, 0);
  assert.equal(visibleResults([{ ...message, content: 'Source handle: r1\nCode: 999' }], [record]).gaps[0].reason, 'content-mismatch');
  assert.equal(visibleResults([{ ...message, toolCallId: 'foreign' }], [record]).gaps[0].reason, 'absent');
});

test('each paid desk can serve its pair in only the frozen order', () => {
  const library = { defineTool: (tool) => tool };
  const pair = tasks.filter(({ family }) => family === 'two-sources');
  for (const task of pair) {
    for (const arm of ['ordinary', 'citation']) {
      const desk = createPilotDesk(library, task, arm);
      const [{ execute }] = desk.apply({ tools: (tools) => tools });
      const [first, second] = task.lookups;
      const read = (target, toolCallId) => execute({ target }, { toolCallId });
      assert.equal(read(second, 'early'), `Read ${first} before ${second}.`);
      assert.equal(desk.bindings.length, 0);
      assert.ok(read(first, 'first').endsWith(task.results[first].content));
      assert.ok(read(second, 'second').endsWith(task.results[second].content));
      assert.deepEqual(desk.bindings.map(({ source }) => source), arm === 'citation' ? task.lookups : []);
    }
  }
});
