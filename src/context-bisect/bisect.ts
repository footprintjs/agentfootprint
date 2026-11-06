/**
 * bisectCulprits — multi-culprit bisection over the ranked suspect set
 * (RFC-003 Part B, block D9). The "git bisect" of the localizer.
 *
 * When single-suspect ablations don't flip the outcome — redundant causes
 * (two facts that EACH justify the wrong answer), or interacting ones —
 * the culprit is a SET. This harness finds a minimal culprit set by
 * recursive halving over the ranked suspects (delta-debugging style,
 * Zeller's ddmin specialized to two-way splits), then keeps searching the
 * remainder for INDEPENDENT culprits until the remainder stops flipping.
 *
 * Probe semantics (the D9 discipline):
 *  - every probe = N seeded reruns of the consumer's `AblationRunner`
 *    with the probe's combined specs; "flipped" = MAJORITY of runs
 *    changed outcome; similarity mean ± spread is always reported —
 *    never single-run verdicts;
 *  - probe 0 is the BASELINE (no ablation): if it flips, the scenario
 *    itself is unstable and the result is honestly `'inconclusive'`;
 *  - probes are cached by spec-set, and budgeted (`maxProbes`) — running
 *    out of budget yields `'inconclusive'`, never a partial claim
 *    dressed up as a finding.
 *
 * Removing every suspect at once leaves the model's default answer, and that
 * can be the wrong answer itself: a model may decline whenever it has no facts.
 * So when that probe doesn't flip the outcome, the search doesn't stop there.
 * It tries the top-ranked suspects alone, then in pairs.
 *
 * §B2: the returned `verdict`/`culprits` are CAUSAL claims — they rest
 * exclusively on counterfactual reruns. The input ranking only chooses
 * the SEARCH ORDER (better ranking = fewer probes), it never decides the
 * outcome.
 */

import {
  isRemovable,
  pairsOf,
  probeFlipped,
  resolvePairSearchTop,
  runAblationProbe,
  suspectLabel,
  type ProbeConfig,
} from './ablation.js';
import type { AblationRerun, BisectionProbe, Embedder, Suspect } from './types.js';
import { CONTEXT_BISECT_DEFAULTS } from './types.js';

export type { BisectionProbe };

// ─── Types ───────────────────────────────────────────────────────────

export interface BisectionResult {
  /**
   * `'confirmed'` — a minimal culprit set was found and verified by
   * counterfactual reruns. `'not-reproducible'` — nothing tried flipped the
   * outcome: not every suspect together, and not the top-ranked ones alone or
   * in pairs. A cause may still be in a larger group, or outside the slice
   * (look at the report's honesty flags). `'not-specific'` — every suspect
   * together didn't flip it, and several top-ranked suspects or pairs did, so
   * removal can't single out a cause (see `probes`). `'inconclusive'` —
   * unstable baseline or probe budget exhausted.
   */
  readonly verdict: 'confirmed' | 'not-reproducible' | 'not-specific' | 'inconclusive';
  /**
   * Minimal culprit set(s): each inner array is one minimal set whose
   * JOINT ablation flips the outcome. Independent culprits appear as
   * separate sets; redundant/interacting causes appear together in one.
   */
  readonly culprits: readonly (readonly Suspect[])[];
  /** Every probe executed, in order (baseline first). */
  readonly probes: readonly BisectionProbe[];
  /** Total consumer-runner invocations (probes × samples). */
  readonly runsUsed: number;
}

export interface BisectCulpritsOptions {
  /** Ranked suspects — only those carrying an applicable ablation spec
   *  participate ('arg' and 'stage' suspects are skipped: nothing the
   *  harness can remove for the consumer). */
  readonly suspects: readonly Suspect[];
  readonly rerun: AblationRerun;
  /** Embedder for similarity stats (and the default flip comparator). */
  readonly embedder: Embedder;
  /** Probe budget. Default 24. Exhaustion → 'inconclusive'. */
  readonly maxProbes?: number;
  /** Max independent culprit sets to search for. Default 4. */
  readonly maxCulprits?: number;
}

// ─── The harness ─────────────────────────────────────────────────────

class ProbeBudgetExceeded extends Error {
  constructor() {
    super('probe budget exceeded');
  }
}

/**
 * Find minimal culprit set(s) by seeded counterfactual bisection. See
 * module docs for semantics and the §B2 claim tier.
 */
export async function bisectCulprits(options: BisectCulpritsOptions): Promise<BisectionResult> {
  const candidates = options.suspects.filter(isRemovable);
  const maxProbes = options.maxProbes ?? CONTEXT_BISECT_DEFAULTS.maxProbes;
  const maxCulprits = options.maxCulprits ?? CONTEXT_BISECT_DEFAULTS.maxCulprits;
  const config: ProbeConfig = { rerun: options.rerun, embedder: options.embedder };

  const probes: BisectionProbe[] = [];
  const cache = new Map<string, boolean>();
  let runsUsed = 0;

  const keyOf = (set: readonly Suspect[]): string =>
    set
      .map((suspect) => suspectLabel(suspect))
      .sort()
      .join('|');

  async function probe(set: readonly Suspect[]): Promise<boolean> {
    const key = keyOf(set);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    if (probes.length >= maxProbes) throw new ProbeBudgetExceeded();
    const stats = await runAblationProbe(
      config,
      set.flatMap((suspect) => (suspect.ablation !== undefined ? [suspect.ablation] : [])),
    );
    runsUsed += stats.samples;
    const flipped = probeFlipped(stats);
    probes.push({ ablated: set.map((suspect) => suspectLabel(suspect)), stats, flipped });
    cache.set(key, flipped);
    return flipped;
  }

  /**
   * Minimal subset of `candidates` that — together with `context` — flips
   * the outcome. Precondition: probe(candidates ∪ context) flipped.
   * Two-way ddmin: try each half; on interference (neither half alone
   * suffices) minimize each half with the other as context.
   */
  async function minimize(
    set: readonly Suspect[],
    context: readonly Suspect[],
  ): Promise<Suspect[]> {
    if (set.length <= 1) return [...set];
    const mid = Math.ceil(set.length / 2);
    const top = set.slice(0, mid); // ranked order: the likelier half first
    const rest = set.slice(mid);
    if (await probe([...top, ...context])) return minimize(top, context);
    if (await probe([...rest, ...context])) return minimize(rest, context);
    // Interference: parts of BOTH halves are needed jointly.
    const fromTop = await minimize(top, [...rest, ...context]);
    const fromRest = await minimize(rest, [...fromTop, ...context]);
    return [...fromTop, ...fromRest];
  }

  try {
    // Baseline: an unstable scenario invalidates everything downstream.
    // ZERO-TOLERANCE (review Finding 1): a single un-ablated flip marks the
    // scenario unstable — the majority-rule probeFlipped() gate would let a
    // 1-in-3-flaky scenario through to a 'confirmed' CAUSAL verdict, which
    // violates the §B2 honest-claims discipline. Same gate localize.ts uses.
    {
      const baselineStats = await runAblationProbe(config, []);
      runsUsed += baselineStats.samples;
      const unstable = baselineStats.flips > 0;
      probes.push({ ablated: [], stats: baselineStats, flipped: unstable });
      cache.set(keyOf([]), probeFlipped(baselineStats));
      if (unstable) {
        return { verdict: 'inconclusive', culprits: [], probes, runsUsed };
      }
    }
    if (candidates.length === 0) {
      return { verdict: 'not-reproducible', culprits: [], probes, runsUsed };
    }
    if (!(await probe(candidates))) {
      // Removing everything can leave the same wrong answer, so look closer.
      const top = candidates.slice(0, resolvePairSearchTop(options.rerun));
      const groups: (readonly Suspect[])[] = [];
      for (const suspect of top) if (await probe([suspect])) groups.push([suspect]);
      if (groups.length === 0) {
        for (const pair of pairsOf(top)) if (await probe(pair)) groups.push(pair);
      }
      if (groups.length === 0) {
        return { verdict: 'not-reproducible', culprits: [], probes, runsUsed };
      }
      return groups.length === 1
        ? { verdict: 'confirmed', culprits: groups, probes, runsUsed }
        : { verdict: 'not-specific', culprits: [], probes, runsUsed };
    }

    // Find minimal sets; then keep searching the remainder for
    // INDEPENDENT culprits until it stops flipping.
    const culprits: Suspect[][] = [];
    let remaining = candidates;
    for (let round = 0; round < maxCulprits; round++) {
      const found = await minimize(remaining, []);
      culprits.push(found);
      const foundKeys = new Set(found.map((suspect) => suspectLabel(suspect)));
      remaining = remaining.filter((suspect) => !foundKeys.has(suspectLabel(suspect)));
      if (remaining.length === 0 || !(await probe(remaining))) break;
    }
    return { verdict: 'confirmed', culprits, probes, runsUsed };
  } catch (error) {
    if (error instanceof ProbeBudgetExceeded) {
      return { verdict: 'inconclusive', culprits: [], probes, runsUsed };
    }
    throw error;
  }
}
