import { MAX_OUTPUT_TOKENS, PROJECTED_LIMIT_UNITS, toDollars, unitsFor } from './budget.mjs';
import { arms, maxRequestsFor, preflightTask, repeats, tasks } from './tasks.mjs';

export const limits = Object.freeze({
  model: 'claude-haiku-5-5',
  maxTokens: MAX_OUTPUT_TOKENS,
  maxRetries: 0,
  caching: false,
  serverTools: false,
  repeats,
});

export const cellKey = (label, arm) => `${label}/${arm}`;

export function paidSchedule(labels) {
  const cells = arms.flatMap((arm) => labels.map((label) => ({ arm, label })));
  const runs = (task, repeat) => cells.map((cell) => ({ ...cell, task, repeat }));
  const first = tasks.find(({ id }) => id === preflightTask);
  const preflight = runs(first, 1);
  const remaining = Array.from({ length: repeats }, (_, index) => index + 1).flatMap((repeat) =>
    tasks.filter((task) => repeat !== 1 || task !== first).flatMap((task) => runs(task, repeat)),
  );
  return { preflight, remaining };
}

export function projectPreflight(preflightRows, remaining, chargedUnits) {
  const cells = preflightRows.map((row) => {
    const peaks = { input: 0, output: 0 };
    const requests = row.requests.filter(({ accounting }) => accounting !== undefined);
    for (const { accounting } of requests) {
      peaks.input = Math.max(peaks.input, accounting.inputTokens);
      peaks.output = Math.max(peaks.output, accounting.outputTokens);
    }
    const slots = remaining.filter(({ label, arm }) => label === row.label && arm === row.arm)
      .reduce((n, { task }) => n + maxRequestsFor(task), 0);
    return {
      cell: cellKey(row.label, row.arm),
      measuredRequests: requests.map(({ accounting }) => accounting),
      peaks,
      remainingSlots: slots,
      remainingUnits: unitsFor(peaks.input, peaks.output) * slots,
    };
  });
  const projectedUnits = chargedUnits + cells.reduce((n, { remainingUnits }) => n + remainingUnits, 0);
  const measurable = cells.length === 4 && cells.every(({ measuredRequests }) => measuredRequests.length > 0);
  return {
    cells, chargedUnits, projectedUnits,
    projectedUsd: toDollars(projectedUnits),
    canContinue: measurable && projectedUnits <= PROJECTED_LIMIT_UNITS,
  };
}
