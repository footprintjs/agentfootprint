import assert from 'node:assert/strict';
import { test } from 'node:test';

import tokens from '../honest-report/cohorts/after/node_modules/agentfootprint/dist/core/agent/evidence/resultCarries.js';
import { scoreAnswer } from './scorer.mjs';

const task = {
  fields: [
    { name: 'Region', value: 'Blue Valley', source: 'official', alternatives: ['Desert Mesa'] },
    { name: 'Count', value: '41200', source: 'official' },
  ],
};
const official = {
  handle: 'r1', toolCallId: 'lookup-1', source: 'official',
  content: 'Region: Blue Valley\nCount: 41,200\nBackup: node-4417\nCopied marker: [r9]',
};
const decoy = {
  handle: 'r2', toolCallId: 'lookup-2', source: 'backup',
  content: 'Region: Desert Mesa\nCount: 7',
};
const bindings = [official, decoy];
const visible = bindings.map((binding, index) => ({ ...binding, messageIndex: 3 + index }));
const score = (answer, overrides = {}) => scoreAnswer({ task, answer, bindings, visible, ...overrides }, tokens);

test('correct values can share a marker and use the pinned canonical spellings', () => {
  const measured = score('Region: Blue Valley, Count: 41,200 [r1].');
  assert.deepEqual(measured.fields, [
    { name: 'Region', state: 'correct', value: 'Blue Valley', marker: '[r1]', citation: 'valid' },
    { name: 'Count', state: 'correct', value: '41,200', marker: '[r1]', citation: 'valid' },
  ]);
  assert.equal(measured.markers.length, 2);
  assert.equal(measured.instructedSourceCited, true);
});

test('a token in the decoy can be cited validly while answering the task incorrectly', () => {
  const measured = score('Region: Desert Mesa [r2]', { task: { fields: [task.fields[0]] } });
  assert.equal(measured.fields[0].state, 'wrong');
  assert.equal(measured.fields[0].citation, 'valid');
  assert.equal(measured.instructedSourceCited, false);
});

test('a source choice and value membership are independent', () => {
  const measured = score('Region: Desert Mesa [r1]');
  assert.equal(measured.fields[0].state, 'wrong');
  assert.equal(measured.fields[0].citation, 'wrong-value');
  assert.equal(measured.instructedSourceCited, true);
});

test('membership may come from a different field of the result', () => {
  const measured = score('Region: 41200 [r1]');
  assert.equal(measured.fields[0].state, 'wrong');
  assert.equal(measured.fields[0].citation, 'valid');
});

test('only a local allocated handle resolves, and invalid marker syntax still pairs', () => {
  for (const marker of ['[r9]', '[r88]', '[R1]', '[[r1]]', '[r1]]', '[r1', 'r1]', '[wrong]']) {
    const measured = score(`Region: Blue Valley ${marker}`);
    assert.equal(measured.fields[0].state, 'correct', marker);
    assert.equal(measured.fields[0].citation, 'bad-handle', marker);
    assert.equal(measured.instructedSourceCited, false, marker);
  }
});

test('a prefix of a whole token is a wrong value for a cited result', () => {
  const measured = score('Region: node-44 [r1]');
  assert.equal(measured.fields[0].state, 'wrong');
  assert.equal(measured.fields[0].citation, 'wrong-value');
});

test('a locally issued handle outside the actual request window is distinct from an unknown handle', () => {
  const measured = score('Region: Blue Valley [r1]', { visible: [visible[1]] });
  assert.equal(measured.fields[0].state, 'correct');
  assert.equal(measured.fields[0].citation, 'out-of-window');
  assert.equal(measured.instructedSourceCited, false);
});

test('matches use the exact request occurrence and the observed bytes', () => {
  const mismatched = score('Region: Blue Valley [r1]', {
    visible: [{ ...visible[0], toolCallId: 'different-occurrence' }],
  });
  assert.equal(mismatched.fields[0].citation, 'out-of-window');
  const altered = score('Region: Blue Valley [r1]', {
    visible: [{ ...visible[0], content: 'Region: Desert Mesa' }],
  });
  assert.equal(altered.fields[0].citation, 'wrong-value');
  const ambiguous = score('Region: Blue Valley [r1]', {
    visible: [visible[0], { ...visible[0], messageIndex: 5 }],
  });
  assert.equal(ambiguous.fields[0].citation, 'bad-handle');
});

test('empty answers record omissions without any marker or source credit', () => {
  const measured = score(' \n ');
  assert.deepEqual(measured.fields, [
    { name: 'Region', state: 'missing' }, { name: 'Count', state: 'missing' },
  ]);
  assert.deepEqual(measured.markers, []);
  assert.equal(measured.instructedSourceCited, false);
});

test('sentence, line and previous-marker boundaries bound the scope', () => {
  const measured = score('Region: Blue Valley. [r1]\n- **Count:** 41,200 [r1][r1]');
  assert.equal(measured.fields[0].citation, 'missing-marker');
  assert.equal(measured.fields[1].citation, 'valid');
  assert.deepEqual(measured.markers.map(({ citation }) => citation), ['orphan-marker', 'valid', 'orphan-marker']);
  const sameLine = score('Region: Blue Valley [r1], Count: 41200 [r1]');
  assert.deepEqual(sameLine.fields.map(({ citation }) => citation), ['valid', 'valid']);
});

test('identical and conflicting repeated field claims cannot earn field or pair credit', () => {
  for (const repeat of ['Region: Blue Valley [r1]', 'Region: Desert Mesa [r2]']) {
    const measured = score(`Region: Blue Valley [r1]\n${repeat}`);
    assert.equal(measured.fields[0].state, 'wrong');
    assert.equal(measured.fields[0].marker, undefined);
    assert.equal(measured.instructedSourceCited, false);
    assert.equal(measured.markers.length, 2);
    assert.ok(measured.markers.every(({ citation, duplicate }) => citation === 'valid' && duplicate));
  }
});

test('value extraction needs a named field and never mines a matching substring from prose', () => {
  const measured = score('Blue Valley [r1]\nCount: 41200 total [r1]');
  assert.equal(measured.fields[0].state, 'missing');
  assert.equal(measured.fields[1].state, 'wrong');
  assert.equal(measured.fields[1].citation, 'wrong-value');
  assert.deepEqual(measured.markers.map(({ citation }) => citation), ['orphan-marker', 'wrong-value']);
});
