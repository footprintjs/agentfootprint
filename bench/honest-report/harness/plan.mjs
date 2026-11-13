/**
 * bench/honest-report/harness/plan.mjs — the order of runs and the spend stop (RULE.md § 8).
 *
 * Repetition by repetition; within a repetition every planned (instance, arm, build) cell once,
 * in a seeded shuffle (seed + repetition index), so the two builds interleave on the same
 * instances. The core arm runs `coreReps` times, a side arm `sideReps` times; a cell whose arm has
 * fewer repetitions simply has no cell in the later rounds.
 *
 * The spend stop: before each paid run, the spend so far plus the projected cost of the next run
 * must stay under `--max-usd`; the projection is the dearest run so far × 1.25 (the answer
 * bench's rule), never under `floorUsd`. Every run left is written as `not-started`.
 *
 * Example: 336 instances, arms [free-default], builds [A, B], coreReps 3 → 2,016 cells in three
 * rounds of 672.
 */

import { shuffled } from '../../inputs/labels.mjs';
import { CORE_ARM } from '../rule-tables.mjs';

/** @returns {{ rep: number, instanceId: string, arm: string, build: string }[]} in run order */
export function planOf({ instances, arms, builds, coreReps, sideReps, seed }) {
  const repsOf = (arm) => (arm === CORE_ARM ? coreReps : sideReps);
  const rounds = Math.max(...arms.map(repsOf));
  const plan = [];
  for (let rep = 0; rep < rounds; rep += 1) {
    const round = [];
    for (const k of instances)
      for (const arm of arms) {
        if (rep >= repsOf(arm)) continue;
        for (const build of builds) round.push({ rep, instanceId: k.id, arm, build });
      }
    plan.push(...shuffled(round, seed + rep));
  }
  return plan;
}

/** The spend stop's state: `admit()` says whether the next run may start; `paid(usd)` records one. */
export function spendStop({ maxUsd, floorUsd = 0.03 }) {
  const state = { usd: 0, projected: floorUsd, stoppedBefore: undefined };
  return {
    state,
    admit(index) {
      if (maxUsd === undefined) return true;
      if (state.usd + state.projected > maxUsd) {
        state.stoppedBefore ??= index;
        return false;
      }
      return true;
    },
    paid(usd) {
      state.usd += usd;
      state.projected = Math.max(floorUsd, state.projected, usd * 1.25);
    },
  };
}

/**
 * Repetitions every one of whose planned runs has a row (any ending but `not-started`):
 * the only ones analysed (RULE.md § 8).
 */
export function completeRepetitions(plan, rows) {
  const done = new Set(rows.filter((r) => r.ending !== 'not-started').map((r) => `${r.build.label}/${r.arm}/${r.instanceId}/r${r.rep}`));
  const reps = [...new Set(plan.map((p) => p.rep))];
  return reps.filter((rep) => plan.filter((p) => p.rep === rep).every((p) => done.has(`${p.build}/${p.arm}/${p.instanceId}/r${p.rep}`)));
}
