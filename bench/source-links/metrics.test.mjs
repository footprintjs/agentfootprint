import assert from 'node:assert/strict';
import test from 'node:test';
import tokens from '../honest-report/cohorts/after/node_modules/agentfootprint/dist/core/agent/evidence/resultCarries.js';
import { summarize } from './metrics.mjs';
import { paidSchedule } from './plan.mjs';
import { scoreAnswer } from './scorer.mjs';

const { preflight, remaining } = paidSchedule();
const allSlots = [...preflight, ...remaining];
const usage = (inputTokens, outputTokens, usageKnown = true) => ({
  accounting: { inputTokens, outputTokens, usageKnown },
});

function gradedRows(slots) {
  return slots.map(({ task, arm, repeat }) => {
    const { family, side } = task;
    const fields = task.fields.map(({ name }, index) => ({
      name, state: 'correct', value: String(index),
      ...(arm === 'citation' ? { marker: 'r1', citation: 'valid' } : {}),
    }));
    return {
      family, side, arm, repeat,
      score: {
        fields,
        markers: arm === 'citation' ? fields.map(({ name, value, marker, citation }) => ({
          name, value, marker, citation, exactValuePresent: true,
        })) : [],
        instructedSourceCited: family === 'decoy' && arm === 'citation',
      },
      requests: [usage(100, 10), usage(200, 30)],
      answerRequestIndex: 1,
    };
  });
}

function armFields(rows, arm) {
  return rows.filter((row) => row.arm === arm).flatMap((row) => row.score.fields);
}

test('tests all four fixed pass lines on the complete scheduled matrix', () => {
  const rows = gradedRows(allSlots);
  const ordinary = armFields(rows, 'ordinary');
  const citation = armFields(rows, 'citation');
  const citationRows = rows.filter(({ arm }) => arm === 'citation');
  for (const field of ordinary.slice(0, 112)) field.state = 'wrong';
  for (const field of citation.slice(0, 128)) field.state = 'wrong';
  for (const row of citationRows.filter(({ family }) => family === 'decoy').slice(0, 4)) {
    row.score.instructedSourceCited = false;
  }
  let marked = 0;
  for (const { score } of citationRows) {
    score.markers = score.markers.filter((pair, index) => {
      marked += 1;
      if (marked <= 15) {
        pair.citation = 'wrong-value';
        delete pair.exactValuePresent;
      }
      if (marked <= 300) return true;
      delete score.fields[index].marker;
      score.fields[index].citation = 'missing-marker';
      return false;
    });
  }

  const stats = summarize(rows.toReversed());
  assert.deepEqual(stats.sample, {
    complete: true, observedRuns: 240, scheduledRuns: 240,
    observedByArm: { ordinary: 120, citation: 120 },
    scheduledByArm: { ordinary: 120, citation: 120 },
  });
  assert.deepEqual(stats.coverage, { marked: 300, eligible: 320, rate: 300 / 320 });
  assert.equal(stats.validity.rate, 0.95);
  assert.deepEqual(stats.citationTextGap, { membershipPasses: 285, notExactInResult: 0, rate: 0 });
  assert.equal(stats.decoy.rate, 0.9);
  assert.equal(stats.requiredValues.delta, 0.05);
  assert.deepEqual(stats.pass, {
    coverage: 'pass', validity: 'pass', decoy: 'pass', requiredValues: 'pass', all: 'pass',
  });

  function removeMarker() {
    const { score } = citationRows.findLast(({ score }) => score.markers.length > 0);
    const { name } = score.markers.pop();
    const field = score.fields.find((field) => field.name === name);
    delete field.marker;
    field.citation = 'missing-marker';
  }
  for (let index = 0; index < 12; index += 1) removeMarker();
  const atBoundary = summarize(rows);
  assert.equal(atBoundary.coverage.rate, 0.9);
  assert.equal(atBoundary.pass.coverage, 'pass');
  removeMarker();
  const belowBoundary = summarize(rows);
  assert.equal(belowBoundary.coverage.rate, 287 / 320);
  assert.equal(belowBoundary.pass.coverage, 'fail');
});

test('uses separate denominators for eligible values, pairs and scheduled decoys', () => {
  const rows = gradedRows(preflight);
  const baseline = summarize(rows);
  const twoSources = rows.find(({ family, arm }) => family === 'two-sources' && arm === 'citation');
  const [first, second, third, fourth] = twoSources.score.fields;
  first.citation = 'bad-handle';
  second.state = 'wrong';
  second.citation = 'wrong-value';
  third.state = 'wrong';
  delete third.marker;
  delete third.citation;
  fourth.state = 'missing';
  delete fourth.marker;
  delete fourth.citation;
  twoSources.score.markers = [
    { marker: 'r9', name: first.name, value: first.value, citation: 'bad-handle' },
    { marker: 'r2', name: second.name, value: second.value, citation: 'wrong-value' },
    { marker: 'r1', name: third.name, value: third.value, citation: 'valid', duplicate: true, exactValuePresent: false },
    { marker: 'r2', name: third.name, value: 'other', citation: 'out-of-window', duplicate: true },
    { marker: 'r2', citation: 'orphan-marker' },
  ];
  const decoy = rows.find(({ family, arm }) => family === 'decoy' && arm === 'citation');
  decoy.score.instructedSourceCited = false;
  decoy.score.fields[0].state = 'wrong';
  decoy.score.markers[0].exactValuePresent = false;

  const stats = summarize(rows);
  assert.equal(stats.sample.observedRuns, 12);
  assert.equal(stats.sample.complete, false);
  assert.equal(stats.coverage.eligible, baseline.coverage.eligible - 1);
  assert.equal(stats.coverage.marked, baseline.coverage.marked - 2);
  assert.deepEqual(stats.validity, {
    valid: baseline.validity.valid - 4,
    pairs: baseline.validity.pairs,
    rate: (baseline.validity.valid - 4) / baseline.validity.pairs,
    duplicatePairs: 2,
    orphanMarkers: 1,
    outcomes: {
      valid: baseline.validity.outcomes.valid - 3, 'bad-handle': 1, 'wrong-value': 1, 'out-of-window': 1,
    },
  });
  assert.deepEqual(stats.citationTextGap, { membershipPasses: 12, notExactInResult: 1, rate: 1 / 12 });
  assert.deepEqual(stats.decoy, {
    instructedSourceCited: 1, observedRuns: 2, scheduledRuns: 40, rate: 1 / 40,
  });
  assert.equal(stats.requiredValues.citation.missing, 1);
  assert.equal(stats.requiredValues.citation.wrong, 3);
  assert.equal(stats.requiredValues.citation.rate, 4 / 16);
  assert.equal(stats.requiredValues.ordinary.rate, 0);
  assert.ok(Object.values(stats.pass).every((result) => result === 'unevaluated'));
});

test('a complete matrix of empty citation answers cannot pass on undefined rates', () => {
  const rows = gradedRows(allSlots);
  for (const row of rows.filter(({ arm }) => arm === 'citation')) {
    row.score.fields = row.score.fields.map(({ name }) => ({ name, state: 'missing' }));
    row.score.markers = [];
    row.score.instructedSourceCited = false;
  }
  const stats = summarize(rows);
  assert.deepEqual(stats.coverage, { eligible: 0, marked: 0, rate: null });
  assert.equal(stats.validity.rate, null);
  assert.deepEqual(stats.citationTextGap, { membershipPasses: 0, notExactInResult: 0, rate: null });
  assert.equal(stats.requiredValues.citation.rate, 1);
  assert.ok(Object.values(stats.pass).every((result) => result === 'fail'));
});

test('a unit change on every cited decoy passes membership but fails the required-value line', () => {
  const rows = allSlots.map(({ task, arm, repeat }) => {
    const { family, side } = task;
    const bindings = task.lookups.map((source, index) => ({
      source, toolCallId: `lookup-${index + 1}`, ...task.results[source],
    }));
    const visible = bindings.map((binding, index) => ({ ...binding, messageIndex: index + 3 }));
    const answer = task.fields.map(({ name, value, source }) => {
      if (arm === 'ordinary') return `${name}: ${value}`;
      const citedValue = family === 'decoy' ? '29%' : value;
      return `${name}: ${citedValue} [${task.results[source].handle}]`;
    }).join('\n');
    return {
      family, side, arm, repeat,
      score: scoreAnswer({ task, answer, bindings, visible }, tokens),
      requests: [],
      answerRequestIndex: null,
    };
  });

  const stats = summarize(rows);
  assert.equal(stats.sample.complete, true);
  assert.equal(stats.sample.observedRuns, 240);
  assert.deepEqual(stats.requiredValues, {
    ordinary: { required: 320, missing: 0, wrong: 0, wrongOrMissing: 0, rate: 0 },
    citation: { required: 320, missing: 0, wrong: 40, wrongOrMissing: 40, rate: 40 / 320 },
    delta: 40 / 320,
  });
  assert.equal(stats.validity.valid, 320);
  assert.equal(stats.decoy.instructedSourceCited, 40);
  assert.deepEqual(stats.citationTextGap, { membershipPasses: 320, notExactInResult: 40, rate: 40 / 320 });
  assert.deepEqual(stats.pass, {
    coverage: 'pass', validity: 'pass', decoy: 'pass', requiredValues: 'fail', all: 'fail',
  });
});

test('rejects duplicate slots and rows outside the frozen schedule', () => {
  const [row] = gradedRows(preflight);
  assert.throws(() => summarize([row, row]), /Duplicate pilot row/);
  assert.throws(() => summarize([{ ...row, repeat: 21 }]), /outside the pilot schedule/);
  assert.throws(() => summarize([{ ...row, repeat: String(row.repeat) }]), /outside the pilot schedule/);
  assert.throws(() => summarize([{ ...row, score: { ...row.score, fields: [] } }]), /required fields/);
});

test('pairs answer requests by task side and repeat and keeps token estimates out of measured usage', () => {
  const rows = gradedRows(allSlots).filter(({ family, repeat }) => family === 'one-source' && repeat <= 2);
  const get = (side, repeat, arm) => rows.find((row) => row.side === side && row.repeat === repeat && row.arm === arm);
  get('a', 1, 'ordinary').requests = [usage(150, 20), usage(190, 100)];
  get('a', 1, 'ordinary').answerRequestIndex = 0;
  get('a', 1, 'citation').requests = [usage(4000, 400, false), usage(250, 40)];
  get('b', 1, 'ordinary').requests = [usage(220, 90)];
  get('b', 1, 'ordinary').answerRequestIndex = 0;
  get('b', 1, 'citation').requests = [usage(120, 5), usage(220, 45)];
  get('a', 2, 'citation').requests[1] = {};
  get('b', 2, 'citation').answerRequestIndex = null;

  const stats = summarize(rows.toReversed());
  const paired = stats.costs.pairedFinalOutput;
  assert.equal(paired.scheduledPairs, 120);
  assert.equal(paired.observedPairs, 4);
  assert.equal(paired.knownPairs, 2);
  assert.equal(paired.unknownPairs, 2);
  assert.equal(paired.meanDeltaTokens, (20 - 45) / 2);
  const pairs = Object.fromEntries(paired.pairs.map((pair) => [`${pair.side}${pair.repeat}`, pair]));
  assert.deepEqual(pairs.a1, {
    family: 'one-source', side: 'a', repeat: 1, ordinaryOutputTokens: 20, citationOutputTokens: 40, deltaTokens: 20,
  });
  assert.equal(pairs.b1.deltaTokens, -45);
  assert.equal(pairs.a2.deltaTokens, null);
  assert.equal(pairs.b2.deltaTokens, null);

  const whole = stats.costs.wholeRun;
  assert.deepEqual(whole.citation, {
    runs: 4, knownRuns: 2, unknownRuns: 2, unknownRequests: 2,
    meanInputTokens: (340 + 300) / 2, meanOutputTokens: (50 + 40) / 2,
  });
  assert.deepEqual(whole.ordinary, {
    runs: 4, knownRuns: 4, unknownRuns: 0, unknownRequests: 0,
    meanInputTokens: (340 + 220 + 300 + 300) / 4, meanOutputTokens: (120 + 90 + 40 + 40) / 4,
  });
  const partialRun = whole.runs.find(({ arm, side, repeat }) => arm === 'citation' && side === 'a' && repeat === 1);
  assert.deepEqual(partialRun, {
    family: 'one-source', side: 'a', arm: 'citation', repeat: 1, requests: 2, unknownRequests: 1,
    knownInputTokens: 250, knownOutputTokens: 40, inputTokens: null, outputTokens: null,
  });
});
