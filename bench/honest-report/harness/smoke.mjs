/**
 * bench/honest-report/harness/smoke.mjs — cost before the run (RULE.md § 8): read the priced
 * smoke step, refuse a harness fault, project the plan's cost, and cut the side arms by the plan.
 *
 * The smoke step is the first `SMOKE_RUNS` runs of the plan (`run.mjs --limit 20`), judged by both
 * judges (`judge.mjs`, then `judge.mjs --second --all`), so the cost of a run AND of a judged
 * answer is measured, not guessed. The full run names the smoke folder (`--smoke <dir>`).
 *
 * Refused, before anything is paid: any `agent-error`, any answer with an HTTP status 4xx, any
 * `text-mismatch` (all faults of the harness, not outcomes), a smoke folder not judged by both
 * judges, a smoke made with another model.
 *
 * The projection, per round: runs × (the smoke's mean run cost × 1.25) + every answer × the first
 * judge's mean cost + every core-arm trap run × the second judge's mean cost (its fallback reading
 * of every primary run, RULE.md § 4) — plus, once, the second judge's sample beyond the trap runs:
 * `secondJudgeRandomExtra` runs and the share the first judge read `unclear` of the other core runs
 * (the smoke's share, at least 10%). The smoke's own spend counts against the same ceiling.
 *
 * Example: `planWithin({ plan, smoke, maxUsd: 15, isTrap })` → `{ plan, projection, droppedSide }`
 * or `{ refusal: 'the first complete core repetition … does not fit …' }`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CORE_ARM, PROPOSED } from '../rule-tables.mjs';
import { ledgerOf } from './cost.mjs';
import { coreOnly } from './plan.mjs';

const readJsonl = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)) : []);
const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** What the smoke folder measured. */
export function readSmoke(dir) {
  const { config } = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
  const lines = readJsonl(join(dir, 'runs.jsonl')).filter((l) => l.ending !== 'not-started');
  const first = readJsonl(join(dir, 'judged.jsonl'));
  const second = readJsonl(join(dir, 'judged-second.jsonl'));
  const usd = lines.map((l) => l.usd ?? 0);
  const coreNonTrap = first.filter((j) => j.arm === CORE_ARM && j.role !== 'trap');
  return {
    config,
    runs: lines.length,
    lines,
    usdPerRun: { mean: mean(usd), max: Math.max(0, ...usd) },
    firstJudgeUsd: mean(first.map((j) => j.usd ?? 0)),
    secondJudgeUsd: mean(second.map((j) => j.usd ?? 0)),
    judged: { first: first.length, second: second.length },
    unclearShare: coreNonTrap.length === 0 ? 0 : coreNonTrap.filter((j) => j.claim?.status === 'unclear').length / coreNonTrap.length,
    spent: ledgerOf(dir).total(),
  };
}

/** Why the full run may not start after this smoke (RULE.md § 8), or undefined. */
export function smokeRefusal(smoke, { model } = {}) {
  if (smoke.config.provider !== 'anthropic') return 'the smoke step must be a paid run (--provider anthropic --limit 20)';
  if (model !== undefined && smoke.config.model !== model) return `the smoke step ran ${smoke.config.model}, this run names ${model}`;
  if (smoke.runs === 0) return 'the smoke step made no run';
  const errors = smoke.lines.filter((l) => l.ending === 'agent-error');
  if (errors.length > 0) return `the smoke step shows ${errors.length} agent error(s) (${errors[0].runKey}${errors[0].error ? `: ${errors[0].error}` : ''}): a harness fault, not an outcome`;
  const fourxx = smoke.lines.filter((l) => Number.isInteger(l.httpStatus) && l.httpStatus >= 400 && l.httpStatus < 500);
  if (fourxx.length > 0) return `the smoke step shows ${fourxx.length} answer(s) with HTTP ${fourxx[0].httpStatus} (${fourxx[0].runKey}): a harness fault, not an outcome`;
  const mismatch = smoke.lines.filter((l) => l.ending === 'text-mismatch');
  if (mismatch.length > 0) return `the smoke step shows ${mismatch.length} text mismatch(es) (${mismatch[0].runKey}): the harness and the library disagree on the model's text`;
  if (smoke.judged.first === 0 || smoke.judged.second === 0) return 'judge the smoke step with both judges first (judge.mjs, then judge.mjs --second --all), so their cost is measured';
  return undefined;
}

/** The projected cost of each round of `plan` and of the second judge's sample beyond the traps. */
export function projectPlan(plan, smoke, isTrap) {
  const perRun = smoke.usdPerRun.mean * 1.25;
  const rounds = [...new Set(plan.map((p) => p.round))].sort((a, b) => a - b).map((round) => {
    const cells = plan.filter((p) => p.round === round);
    const coreTraps = cells.filter((p) => p.arm === CORE_ARM && isTrap(p.instanceId)).length;
    const usd = cells.length * (perRun + smoke.firstJudgeUsd) + coreTraps * smoke.secondJudgeUsd;
    return { round, runs: cells.length, core: cells.every((p) => p.arm === CORE_ARM), coreTraps, usd };
  });
  const coreOther = plan.filter((p) => p.arm === CORE_ARM && !isTrap(p.instanceId)).length;
  const sampleExtra = (PROPOSED.secondJudgeRandomExtra + Math.max(0.1, smoke.unclearShare) * coreOther) * smoke.secondJudgeUsd;
  return { perRun, rounds, sampleExtra, total: smoke.spent + sampleExtra + rounds.reduce((a, r) => a + r.usd, 0) };
}

/**
 * The plan that fits under `maxUsd`, or a refusal: the first complete core repetition (with its
 * judging, the sample's extra and the smoke's own spend) must fit; when the whole plan does not
 * fit, the side arms are dropped from it — never a core repetition.
 */
export function planWithin({ plan, smoke, maxUsd, isTrap }) {
  const full = projectPlan(plan, smoke, isTrap);
  const firstCore = full.rounds.find((r) => r.core);
  const firstFit = smoke.spent + full.sampleExtra + (firstCore?.usd ?? 0);
  if (firstCore === undefined) return { refusal: 'the plan has no core round', projection: full };
  if (firstFit > maxUsd) return { refusal: `the first complete core repetition does not fit: projected $${firstFit.toFixed(2)} (smoke spent $${smoke.spent.toFixed(2)}) against a ceiling of $${maxUsd}`, projection: full };
  if (full.total <= maxUsd) return { plan, projection: full, droppedSide: false };
  const core = coreOnly(plan);
  return { plan: core, projection: projectPlan(core, smoke, isTrap), droppedSide: core.length < plan.length, fullProjection: full };
}
