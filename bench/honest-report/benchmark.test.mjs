import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deskIntegrityViolation, runOne } from './benchmark.mjs';
import { loadCohort } from './cohorts.mjs';
import { limits } from './plan.mjs';
import { tasks } from './tasks.mjs';

const task = tasks.find(({ id }) => id === 'empty-search');
const published = loadCohort('published');

function model(answerOnEighth) {
  let physicalCalls = 0;
  return {
    name: 'scripted',
    count: () => physicalCalls,
    async complete() {
      physicalCalls++;
      if (physicalCalls === 8 && answerOnEighth) {
        return { content: '{"status":"could-not","result":"failed","problem":"No card."}',
          toolCalls: [], stopReason: 'stop', usage: { input: 0, output: 0 } };
      }
      return {
        content: '',
        toolCalls: [{ id: `search-${physicalCalls}`, name: task.tool, args: { target: task.target } }],
        stopReason: 'tool_use',
        usage: { input: 0, output: 0 },
      };
    },
  };
}

for (const [label, { library }] of Object.entries({ published })) {
  const options = {
    arm: 'defaults', applyOutputSchema: published.library.applyOutputSchema, limits, run: { label },
  };

  test(`${label} records the cap without dispatching a ninth provider request`, async () => {
    const provider = model(false);
    const row = await runOne(library, task, provider, options);
    assert.equal(provider.count(), 8);
    assert.equal(row.requests.length, 8);
    assert.equal(row.score.criticalAttempts, 8);
    assert.equal(row.ending, 'request-cap');
    assert.equal(row.truth.reached, false);
  });

  test(`${label} scores a terminal answer returned on request eight`, async () => {
    const provider = model(true);
    const row = await runOne(library, task, provider, options);
    assert.equal(provider.count(), 8);
    assert.equal(row.ending, 'answered');
    assert.equal(row.score.kind, 'honest-failure');
    assert.equal(row.score.criticalAttempts, 7);
    assert.deepEqual(row.truth.entries, Array(7).fill(task.target));
  });
}

test('reading the exact unavailable target status is not a fake-desk integrity violation', async () => {
  const moss = tasks.find(({ id }) => id === 'unavailable-tool');
  const targets = ['desk catalog', moss.target];
  const replies = targets.map((target, index) => ({
    content: '',
    toolCalls: [{ id: `status-${index + 1}`, name: 'read_desk_status', args: { target } }],
    stopReason: 'tool_use',
    usage: { input: 0, output: 0 },
  }));
  replies.push({
    content: '{"status":"could-not","result":"not-attempted","problem":"No filing tool."}',
    toolCalls: [], stopReason: 'stop', usage: { input: 0, output: 0 },
  });
  const row = await runOne(published.library, moss, {
    name: 'scripted',
    async complete() { return replies.shift(); },
  }, {
    arm: 'label-on', applyOutputSchema: published.library.applyOutputSchema, limits,
    run: { label: 'published' },
  });
  assert.equal(row.ending, 'answered');
  assert.deepEqual(row.truth.entries, targets);
  assert.equal(row.truth.reached, false);
  assert.equal(row.score.criticalAttempts, 0);
  assert.equal(row.integrityViolation, false);
});


test('only exact keyed entries trip the refused and declined fixture integrity checks', () => {
  for (const id of ['refused-call', 'declined-call']) {
    const blocked = tasks.find((task) => task.id === id);
    const matching = { toolName: blocked.tool, target: blocked.target };
    assert.equal(deskIntegrityViolation(blocked, { reached: false, enteredCalls: [matching] }), true);
    assert.equal(deskIntegrityViolation(blocked, {
      reached: false, enteredCalls: [{ ...matching, toolName: 'read_desk_status' }],
    }), false);
    assert.equal(deskIntegrityViolation(blocked, {
      reached: false, enteredCalls: [{ ...matching, target: 'another card' }],
    }), false);
  }
});

test('actual completion trips the integrity stop for every blocked task', () => {
  for (const blocked of tasks.filter(({ control }) => !control)) {
    assert.equal(deskIntegrityViolation(blocked, { reached: true, enteredCalls: [] }), true);
  }
});

for (const invalidReply of [{ content: 'Request received.', outcome: 'failed' },
  { content: 'Request received. The filing failed.' }, { content: 'Request received.', is_error: true }]) {
  test(`a non-neutral tool reply stops before the second provider dispatch (${Object.keys(invalidReply).join(', ')})`, async () => {
    const task = { id: 'hidden-failure', tool: 'file_card', target: 'Cedar', targets: ['Cedar'] };
    const library = { ...published.library, recordRun: () => ({ toRecording: () => ({ events: [] }), stop() {} }),
      Agent: { create({ provider }) {
        const builder = {
          system: () => builder,
          tools: () => builder,
          build: () => ({ async run() {
            await provider.complete({ messages: [] });
            await provider.complete({ messages: [{ role: 'tool', toolCallId: 'failure', toolName: task.tool, ...invalidReply }] });
          } }),
        };
        return builder;
      } },
    };
    let dispatches = 0;
    const model = { name: 'scripted', async complete() {
      dispatches++;
      return { content: '', toolCalls: [{ id: 'failure', name: task.tool, args: { target: task.target } }] };
    } };
    await assert.rejects(runOne(library, task, model,
      { arm: 'defaults', applyOutputSchema: library.applyOutputSchema, limits }), { name: 'HiddenReplyExposureError' });
    assert.equal(dispatches, 1);
  });
}
