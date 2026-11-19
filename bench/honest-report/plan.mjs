import { MAX_OUTPUT_TOKENS, PROJECTED_LIMIT_UNITS, toDollars, unitsFor } from './budget.mjs';
import { hiddenTasks } from './hiddenTasks.mjs';
import { maxRequestsPerRun, repeats, tasks } from './tasks.mjs';

const legacyRepeats = 10;
const preflightTask = hiddenTasks.find(({ id }) => id === 'partial-failure');

export const cells = Object.freeze([
  Object.freeze({ label: 'published', arm: 'label-on' }),
  Object.freeze({ label: 'candidate', arm: 'label-on' }),
]);

export const limits = Object.freeze({
  model: 'claude-haiku-5-5',
  maxTokens: MAX_OUTPUT_TOKENS,
  maxRequests: maxRequestsPerRun,
  maxRetries: 0,
  caching: false,
  serverTools: false,
  repeats,
});

export const cellKey = (label, arm) => `${label}/${arm}`;

export function paidSchedule() {
  const runs = (task, repeat) => cells.map((cell) => ({ ...cell, task, repeat }));
  const preflight = runs(preflightTask, 1);
  const allTasks = [...tasks, ...hiddenTasks];
  const remaining = Array.from({ length: repeats }, (_, index) => index + 1).flatMap((repeat) => {
    const roundTasks = repeat <= legacyRepeats ? allTasks : hiddenTasks;
    return roundTasks.filter((task) => repeat !== 1 || task !== preflightTask)
      .flatMap((task) => runs(task, repeat));
  });
  return { preflight, remaining };
}

export function projectPreflight(preflightRows, remaining, chargedUnits) {
  const cellProjections = preflightRows.map((row) => {
    const peaks = { input: 0, output: 0 };
    const requests = row.requests.filter(({ accounting }) => accounting !== undefined);
    for (const { accounting } of requests) {
      peaks.input = Math.max(peaks.input, accounting.inputTokens);
      peaks.output = Math.max(peaks.output, accounting.outputTokens);
    }
    const slots = remaining.filter(({ label, arm }) => label === row.label && arm === row.arm)
      .length * limits.maxRequests;
    return {
      cell: cellKey(row.label, row.arm),
      measuredRequests: requests.map(({ accounting }) => accounting),
      peaks,
      remainingSlots: slots,
      remainingUnits: unitsFor(peaks.input, peaks.output) * slots,
    };
  });
  const projectedUnits = chargedUnits + cellProjections.reduce((n, { remainingUnits }) => n + remainingUnits, 0);
  const measurableKeys = new Set(cellProjections.filter(({ measuredRequests }) => measuredRequests.length > 0)
    .map(({ cell }) => cell));
  const measurable = preflightRows.length === cells.length &&
    cells.every(({ label, arm }) => measurableKeys.has(cellKey(label, arm)));
  return {
    cells: cellProjections, chargedUnits, projectedUnits,
    projectedUsd: toDollars(projectedUnits),
    canContinue: measurable && projectedUnits <= PROJECTED_LIMIT_UNITS,
  };
}
