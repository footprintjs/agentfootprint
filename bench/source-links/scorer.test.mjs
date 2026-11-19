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

test('a shared marker can validate both a correct value and a different printed spelling', () => {
  const measured = score('Region: Blue Valley, Count: 41,200 [r1].');
  assert.deepEqual(measured.fields, [
    { name: 'Region', state: 'correct', value: 'Blue Valley', marker: '[r1]', citation: 'valid' },
    { name: 'Count', state: 'wrong', value: '41,200', marker: '[r1]', citation: 'valid' },
  ]);
  assert.deepEqual(measured.markers, [
    { name: 'Region', value: 'Blue Valley', marker: '[r1]', citation: 'valid', exactValuePresent: true },
    { name: 'Count', value: '41,200', marker: '[r1]', citation: 'valid', exactValuePresent: true },
  ]);
  assert.equal(measured.instructedSourceCited, true);
});

const changedValues = [
  ['Capacity', '29', '29%', 'valid'],
  ['Capacity', '29', '29 units', 'wrong-value'],
  ['Capacity', '29', '-29', 'wrong-value'],
  ['Capacity', '29', '29.0', 'valid'],
  ['Code', 'QX41', 'QX-41', 'wrong-value'],
  ['Shelf', 'Teal', 'teal', 'valid'],
];

for (const [name, expected, value, citation] of changedValues) {
  test(`${name}: ${value} is wrong for ${expected} with citation outcome ${citation}`, () => {
    const fieldTask = { fields: [{ name, value: expected, source: 'official' }] };
    const measured = score(`${name}: ${value} [r1]`, {
      task: fieldTask,
      visible: [{ ...visible[0], content: `${name}: ${expected}` }],
    });
    assert.deepEqual(measured.fields, [{ name, state: 'wrong', value, marker: '[r1]', citation }]);
    assert.deepEqual(measured.markers, [{
      name, value, marker: '[r1]', citation,
      ...(citation === 'valid' ? { exactValuePresent: false } : {}),
    }]);
  });
}

test('surrounding whitespace and one trailing comma or semicolon are trimmed', () => {
  for (const suffix of ['', ',', ';']) {
    const measured = score(`  Region: \tBlue Valley${suffix} \t [r1]`);
    assert.deepEqual(measured.fields[0], {
      name: 'Region', state: 'correct', value: 'Blue Valley', marker: '[r1]', citation: 'valid',
    }, suffix);
    assert.equal(measured.markers[0].exactValuePresent, true, suffix);
  }
});

test('one trailing full stop is trimmed for correctness and ends marker scope', () => {
  const measured = score('  Region: \tBlue Valley. \t [r1]');
  assert.deepEqual(measured.fields[0], {
    name: 'Region', state: 'correct', value: 'Blue Valley', citation: 'missing-marker',
  });
  assert.deepEqual(measured.markers, [{ marker: '[r1]', citation: 'orphan-marker' }]);
});

test('repeated and unsupported trailing punctuation make a value wrong', () => {
  for (const suffix of [',,', ';;', ',;']) {
    const measured = score(`Region: Blue Valley${suffix} [r1]`);
    assert.equal(measured.fields[0].state, 'wrong', suffix);
    assert.equal(measured.fields[0].citation, 'valid', suffix);
    assert.equal(measured.markers[0].exactValuePresent, false, suffix);
  }
  for (const suffix of ['..', '!', '?']) {
    const measured = score(`Region: Blue Valley${suffix} [r1]`);
    assert.equal(measured.fields[0].state, 'wrong', suffix);
    assert.equal(measured.fields[0].citation, 'missing-marker', suffix);
    assert.deepEqual(measured.markers, [{ marker: '[r1]', citation: 'orphan-marker' }], suffix);
  }
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

test('whole values in other result fields count as exact text', () => {
  for (const [value, exactValuePresent] of [['node-4417', true], ['41200', false]]) {
    const measured = score(`Region: ${value} [r1]`);
    assert.equal(measured.fields[0].state, 'wrong');
    assert.deepEqual(measured.markers, [
      { name: 'Region', value, marker: '[r1]', citation: 'valid', exactValuePresent },
    ]);
  }
});

test('membership can pass for part of a result field while exact text requires the whole value', () => {
  const measured = score('Region: Blue [r1]');
  assert.deepEqual(measured.markers, [
    { name: 'Region', value: 'Blue', marker: '[r1]', citation: 'valid', exactValuePresent: false },
  ]);
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
