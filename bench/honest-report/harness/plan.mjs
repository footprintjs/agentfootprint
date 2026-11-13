/**
 * bench/honest-report/harness/plan.mjs — the order of runs and the spend stop (RULE.md § 8).
 *
 * Round by round. The core arm's repetitions come first, one round each (rounds 0 … coreReps−1);
 * the side arms run in rounds of their own after them (round coreReps + their repetition). Within
 * a round every planned (instance, arm, build) cell once, in a seeded shuffle (seed + round), so
 * the two builds interleave on the same instances. Why the side arms come last: a spend stop can
 * then only leave the LAST round incomplete, never take a core repetition with it (the
 * measurement reading found a stop inside a mixed round 0 that left nothing to analyse).
 *
 * The spend stop: before each paid run, the ledger's total plus the reserve of every run in
 * flight plus this run's reserve must stay under the ceiling. A run's reserve is the dearest run
 * so far × 1.25 (the answer bench's rule, never under `floorUsd`) plus its judging (`judgeUsd`).
 * Every run left is written as `not-started`.
 *
 * Example: 336 instances, arms [free-default, free-checks], builds [A, B], coreReps 3, sideReps 1
 * → rounds 0, 1, 2 of 672 core cells, then round 3 of 672 side cells.
 */

import { shuffled } from '../../inputs/labels.mjs';
import { CORE_ARM } from '../rule-tables.mjs';

/** @returns {{ round: number, rep: number, instanceId: string, arm: string, build: string }[]} in run order */
export function planOf({ instances, arms, builds, coreReps, sideReps, seed }) {
  const plan = [];
  const roundOf = (round, rep, armList) => {
    const cells = [];
    for (const k of instances) for (const arm of armList) for (const build of builds) cells.push({ round, rep, instanceId: k.id, arm, build });
    plan.push(...shuffled(cells, seed + round));
  };
  const side = arms.filter((a) => a !== CORE_ARM);
  const hasCore = arms.includes(CORE_ARM);
  const coreRounds = hasCore ? coreReps : 0;
  for (let rep = 0; rep < coreRounds; rep += 1) roundOf(rep, rep, [CORE_ARM]);
  if (side.length > 0) for (let rep = 0; rep < sideReps; rep += 1) roundOf(coreRounds + rep, rep, side);
  return plan;
}

/** The plan without the side arms (RULE.md § 8: a side arm is cut by the plan, never by the stop). */
export function coreOnly(plan) {
  return plan.filter((p) => p.arm === CORE_ARM);
}

const cellKey = (build, arm, instanceId, rep) => `${build}/${arm}/${instanceId}/r${rep}`;

/**
 * The spend stop's state over one ledger (`cost.mjs` · `ledgerOf`): `admit(index, judgeUsd)`
 * reserves a run's projected cost and says whether it may start; `paid(usd, reserve)` releases
 * the reserve once the run's real cost is on the ledger.
 */
export function spendStop({ maxUsd, ledger, floorUsd = 0.003, dearestUsd = 0 }) {
  const state = { projected: Math.max(floorUsd, dearestUsd * 1.25), inFlight: 0, stoppedBefore: undefined };
  return {
    state,
    admit(index, judgeUsd = 0) {
      if (maxUsd === undefined) return 0;
      const reserve = state.projected + judgeUsd;
      if (ledger.total() + state.inFlight + reserve > maxUsd) {
        state.stoppedBefore ??= index;
        return undefined;
      }
      state.inFlight += reserve;
      return reserve;
    },
    paid(usd, reserve) {
      state.inFlight = Math.max(0, state.inFlight - (reserve ?? 0));
      state.projected = Math.max(floorUsd, state.projected, usd * 1.25);
    },
  };
}

/**
 * Rounds every one of whose planned runs has a row (any ending but `not-started`): the only
 * ones analysed (RULE.md § 8).
 */
export function completeRounds(plan, rows) {
  const done = new Set(rows.filter((r) => r.ending !== 'not-started').map((r) => cellKey(r.build.label ?? r.build, r.arm, r.instanceId, r.rep)));
  const rounds = [...new Set(plan.map((p) => p.round))];
  return rounds.filter((round) => plan.filter((p) => p.round === round).every((p) => done.has(cellKey(p.build, p.arm, p.instanceId, p.rep))));
}

/** The plan's round of a run, by its cell (`build/arm/instance/rep`). */
export function roundIndex(plan) {
  return new Map(plan.map((p) => [cellKey(p.build, p.arm, p.instanceId, p.rep), p.round]));
}
