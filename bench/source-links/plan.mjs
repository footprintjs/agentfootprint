import { MAX_OUTPUT_TOKENS } from '../honest-report/budget.mjs';
import { projectPreflight as projectMeasuredCells } from '../honest-report/plan.mjs';
import { arms, tasks } from './tasks.mjs';

export const PROJECTED_LIMIT_UNITS = 8_000_000;
export const SPEND_LIMIT_UNITS = 10_000_000;

export const limits = Object.freeze({
  model: 'claude-haiku-5-5',
  maxTokens: MAX_OUTPUT_TOKENS,
  maxRequests: 8,
  maxRetries: 0,
  caching: false,
  serverTools: false,
  repeats: 20,
});

const cells = tasks.flatMap((task) => arms.map((arm) => ({ task, arm })));
const keyOf = ({ task, arm }) => `${task.family}/${task.side}/${arm}`;

export function paidSchedule() {
  const round = (repeat) => cells.map(({ task, arm }) => ({ task, arm, repeat }));
  return {
    preflight: round(1),
    remaining: Array.from({ length: limits.repeats - 1 }, (_, index) => round(index + 2)).flat(),
  };
}

export function projectPreflight(rows, remaining, chargedUnits) {
  const measured = rows.filter(({ answerRequestIndex, requests }) =>
    answerRequestIndex !== null && requests.length > 0 && requests.every(({ accounting }) => accounting?.usageKnown));
  return projectMeasuredCells(measured, remaining, chargedUnits, {
    expectedCells: cells, keyOf, maxRequests: limits.maxRequests, projectedLimitUnits: PROJECTED_LIMIT_UNITS,
  });
}
