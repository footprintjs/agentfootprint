import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runOne } from './benchmark.mjs';
import { loadCohort } from './cohorts.mjs';
import { limits } from './plan.mjs';
import { tasks } from './tasks.mjs';

const task = tasks.find(({ id }) => id === 'empty-search');
const before = loadCohort('before');
const after = loadCohort('after');

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

for (const [label, { library }] of Object.entries({ before, after })) {
  const options = {
    arm: 'defaults', applyOutputSchema: before.library.applyOutputSchema, limits, run: { label },
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
