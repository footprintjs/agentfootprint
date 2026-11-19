import assert from 'node:assert/strict';

import { runOne } from './benchmark.mjs';
import { lookupTool } from './desk.mjs';
import { arms, tasks } from './tasks.mjs';

function scripted(task, answer) {
  let next = 0;
  return {
    name: 'scripted',
    async complete() {
      const source = task.lookups[next++];
      if (source === undefined) return { content: answer, toolCalls: [], stopReason: 'stop', usage: { input: 0, output: 0 } };
      return {
        content: '', stopReason: 'tool_use', usage: { input: 0, output: 0 },
        toolCalls: [{ id: `lookup-${next}`, name: lookupTool, args: { target: source } }],
      };
    },
  };
}

function lines(task, arm) {
  return task.fields.map(({ name, value, source }) => {
    const marker = arm === 'citation' ? ` [${task.results[source].handle}]` : '';
    return `${name}: ${value}${marker}`;
  }).join('\n');
}

export const scriptedRows = 17;

export async function rehearse(library, tokens) {
  const rows = [];
  async function play(task, arm, name, answer, prepareRequest) {
    const row = await runOne(library, tokens, scripted(task, answer), { task, arm, repeat: 1 }, { prepareRequest });
    assert.equal(row.ending, 'answered', name);
    assert.equal(row.answerRequestIndex, task.lookups.length, name);
    rows.push({ ...row, play: name });
    return row;
  }

  for (const task of tasks) {
    for (const arm of arms) {
      const row = await play(task, arm, 'correct', lines(task, arm));
      assert.ok(row.score.fields.every(({ state }) => state === 'correct'));
      const final = row.requests[row.answerRequestIndex];
      assert.equal(final.visible.length, arm === 'citation' ? task.lookups.length : 0);
      for (const slot of final.visible) {
        assert.equal(final.request.messages[slot.messageIndex].content, slot.wireContent);
        assert.equal(final.request.messages[slot.messageIndex].toolCallId, slot.toolCallId);
      }
      assert.ok(row.score.fields.every(({ citation }) => citation === (arm === 'citation' ? 'valid' : 'missing-marker')));
      if (task.family === 'decoy' && arm === 'citation') assert.ok(row.score.instructedSourceCited);
    }
  }

  const decoy = tasks.find(({ family, side }) => family === 'decoy' && side === 'b');
  const register = decoy.results.register.handle;
  const estimate = decoy.results.estimate.handle;
  const examples = [
    { name: 'accurate-decoy', answer: `Capacity: 72 [${estimate}]`, state: 'wrong', citation: 'valid' },
    { name: 'bad-handle', answer: 'Capacity: 29 [r93]', state: 'correct', citation: 'bad-handle' },
    { name: 'wrong-value', answer: `Capacity: 9 [${register}]`, state: 'wrong', citation: 'wrong-value', source: true },
    { name: 'out-of-window', answer: `Capacity: 29 [${register}]`, state: 'correct', citation: 'out-of-window',
      prepareRequest: (request) => ({
        ...request, messages: request.messages.filter((message) =>
          message.role !== 'tool' || message.toolCallId !== 'lookup-2'),
      }) },
    { name: 'empty-answer', answer: '', state: 'missing' },
  ];
  for (const { name, answer, state, citation, source, prepareRequest } of examples) {
    const row = await play(decoy, 'citation', name, answer, prepareRequest);
    assert.equal(row.score.fields[0].state, state, name);
    assert.equal(row.score.fields[0].citation, citation, name);
    assert.equal(row.score.instructedSourceCited, source ?? false, name);
  }
  assert.equal(rows.length, scriptedRows);
  return rows;
}
