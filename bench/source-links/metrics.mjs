import { paidSchedule } from './plan.mjs';
import { arms } from './tasks.mjs';

const rate = (numerator, denominator) => denominator === 0 ? null : numerator / denominator;

function pairKey({ family, side, repeat }) {
  return `${family}/${side}/${repeat}`;
}

function slotKey(row) {
  return `${pairKey(row)}/${row.arm}`;
}

function newRequiredCounts() {
  return { required: 0, missing: 0, wrong: 0, wrongOrMissing: 0, rate: null };
}

function knownUsage(request) {
  const usage = request?.accounting;
  if (usage?.usageKnown !== true) return null;
  const { inputTokens, outputTokens } = usage;
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
      !Number.isSafeInteger(outputTokens) || outputTokens < 0) return null;
  return usage;
}

function runUsage({ family, side, arm, repeat, requests }) {
  let knownInputTokens = 0;
  let knownOutputTokens = 0;
  let unknownRequests = 0;
  for (const request of requests) {
    const usage = knownUsage(request);
    if (usage === null) {
      unknownRequests += 1;
    } else {
      knownInputTokens += usage.inputTokens;
      knownOutputTokens += usage.outputTokens;
    }
  }
  return {
    family, side, arm, repeat,
    requests: requests.length,
    unknownRequests,
    knownInputTokens,
    knownOutputTokens,
    inputTokens: unknownRequests === 0 ? knownInputTokens : null,
    outputTokens: unknownRequests === 0 ? knownOutputTokens : null,
  };
}

function wholeRunSummary(runs) {
  const known = runs.filter(({ unknownRequests }) => unknownRequests === 0);
  return {
    runs: runs.length,
    knownRuns: known.length,
    unknownRuns: runs.length - known.length,
    unknownRequests: runs.reduce((sum, run) => sum + run.unknownRequests, 0),
    meanInputTokens: rate(known.reduce((sum, run) => sum + run.inputTokens, 0), known.length),
    meanOutputTokens: rate(known.reduce((sum, run) => sum + run.outputTokens, 0), known.length),
  };
}

function finalOutput(row) {
  if (!Number.isSafeInteger(row.answerRequestIndex) || row.answerRequestIndex < 0) return null;
  return knownUsage(row.requests[row.answerRequestIndex])?.outputTokens ?? null;
}

function pairedOutputSummary(scheduledPairs, rowsByPair) {
  const pairs = [];
  for (const { ordinary, citation } of rowsByPair.values()) {
    if (!ordinary || !citation) continue;
    const { family, side, repeat } = ordinary;
    const ordinaryOutputTokens = finalOutput(ordinary);
    const citationOutputTokens = finalOutput(citation);
    pairs.push({
      family, side, repeat, ordinaryOutputTokens, citationOutputTokens,
      deltaTokens: ordinaryOutputTokens === null || citationOutputTokens === null
        ? null : citationOutputTokens - ordinaryOutputTokens,
    });
  }
  const known = pairs.filter(({ deltaTokens }) => deltaTokens !== null);
  return {
    scheduledPairs,
    observedPairs: pairs.length,
    knownPairs: known.length,
    unknownPairs: pairs.length - known.length,
    meanDeltaTokens: rate(known.reduce((sum, pair) => sum + pair.deltaTokens, 0), known.length),
    pairs,
  };
}

export function summarize(rows) {
  const { preflight, remaining } = paidSchedule();
  const slots = new Map();
  const scheduledByArm = { ordinary: 0, citation: 0 };
  let scheduledDecoys = 0;
  for (const { task, arm, repeat } of [...preflight, ...remaining]) {
    const slot = { family: task.family, side: task.side, arm, repeat };
    const key = slotKey(slot);
    if (slots.has(key)) throw new Error(`Duplicate scheduled slot: ${key}`);
    slots.set(key, { ...slot, fieldCount: task.fields.length });
    scheduledByArm[arm] += 1;
    if (arm === 'citation' && task.family === 'decoy') scheduledDecoys += 1;
  }

  const observedByArm = { ordinary: 0, citation: 0 };
  const rowsBySlot = new Map();
  for (const row of rows) {
    const key = slotKey(row);
    const slot = slots.get(key);
    if (!slot || row.family !== slot.family || row.side !== slot.side || row.arm !== slot.arm ||
        row.repeat !== slot.repeat) throw new Error(`Row is outside the pilot schedule: ${key}`);
    if (rowsBySlot.has(key)) throw new Error(`Duplicate pilot row: ${key}`);
    if (row.score.fields.length !== slot.fieldCount) {
      throw new Error(`Expected ${slot.fieldCount} required fields in ${key}`);
    }
    rowsBySlot.set(key, row);
    observedByArm[row.arm] += 1;
  }

  const sample = {
    complete: rowsBySlot.size === slots.size,
    observedRuns: rowsBySlot.size,
    scheduledRuns: slots.size,
    observedByArm,
    scheduledByArm,
  };
  const coverage = { marked: 0, eligible: 0, rate: null };
  const validity = {
    valid: 0,
    pairs: 0,
    rate: null,
    duplicatePairs: 0,
    orphanMarkers: 0,
    outcomes: { valid: 0, 'bad-handle': 0, 'wrong-value': 0, 'out-of-window': 0 },
  };
  const decoy = { instructedSourceCited: 0, observedRuns: 0, scheduledRuns: scheduledDecoys, rate: null };
  const requiredValues = { ordinary: newRequiredCounts(), citation: newRequiredCounts(), delta: null };
  const rowsByPair = new Map();
  const runs = [];
  for (const key of slots.keys()) {
    const row = rowsBySlot.get(key);
    if (!row) continue;
    const { arm, family, score } = row;
    const pair = pairKey(row);
    if (!rowsByPair.has(pair)) rowsByPair.set(pair, {});
    rowsByPair.get(pair)[arm] = row;
    runs.push(runUsage(row));
    const required = requiredValues[arm];
    for (const field of score.fields) {
      required.required += 1;
      if (field.state === 'missing') required.missing += 1;
      if (field.state === 'wrong') required.wrong += 1;
      if (arm === 'citation' && field.state !== 'missing') {
        coverage.eligible += 1;
        if (field.marker != null) coverage.marked += 1;
      }
    }
    if (arm !== 'citation') continue;
    for (const pair of score.markers) {
      if (pair.citation === 'orphan-marker') {
        validity.orphanMarkers += 1;
        continue;
      }
      validity.pairs += 1;
      validity.outcomes[pair.citation] += 1;
      if (pair.duplicate) validity.duplicatePairs += 1;
      if (pair.citation === 'valid' && !pair.duplicate) validity.valid += 1;
    }
    if (family === 'decoy') {
      decoy.observedRuns += 1;
      if (score.instructedSourceCited) decoy.instructedSourceCited += 1;
    }
  }

  coverage.rate = rate(coverage.marked, coverage.eligible);
  validity.rate = rate(validity.valid, validity.pairs);
  decoy.rate = rate(decoy.instructedSourceCited, decoy.scheduledRuns);
  for (const arm of arms) {
    const counts = requiredValues[arm];
    counts.wrongOrMissing = counts.missing + counts.wrong;
    counts.rate = rate(counts.wrongOrMissing, counts.required);
  }
  const { ordinary, citation } = requiredValues;
  const deltaNumerator = citation.wrongOrMissing * ordinary.required - ordinary.wrongOrMissing * citation.required;
  const deltaDenominator = citation.required * ordinary.required;
  requiredValues.delta = rate(deltaNumerator, deltaDenominator);

  // Compare integer counts so an exact pass line cannot drift due to division or subtraction.
  const verdict = (met) => !sample.complete ? 'unevaluated' : met ? 'pass' : 'fail';
  const pass = {
    coverage: verdict(coverage.eligible > 0 && coverage.marked * 10 >= coverage.eligible * 9),
    validity: verdict(validity.pairs > 0 && validity.valid * 20 >= validity.pairs * 19),
    decoy: verdict(decoy.instructedSourceCited * 10 >= decoy.scheduledRuns * 9),
    requiredValues: verdict(deltaDenominator > 0 && deltaNumerator * 20 <= deltaDenominator),
  };
  pass.all = verdict(Object.values(pass).every((result) => result === 'pass'));

  return {
    sample, coverage, validity, decoy, requiredValues, pass,
    costs: {
      pairedFinalOutput: pairedOutputSummary(scheduledByArm.ordinary, rowsByPair),
      wholeRun: {
        ordinary: wholeRunSummary(runs.filter(({ arm }) => arm === 'ordinary')),
        citation: wholeRunSummary(runs.filter(({ arm }) => arm === 'citation')),
        runs,
      },
    },
  };
}
