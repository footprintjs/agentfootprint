/**
 * Arm validation — the teaching refusals.
 *
 * Every refusal here fires BEFORE a single model call. That is the whole design
 * rule: an incoherent comparison must cost nothing. The engine's other refusals
 * (an unstable baseline, an arm that did not take effect) can only be known
 * after the runs, and those refuse a VERDICT rather than throw — refusing after
 * spending N model calls would be hostile. These six can be known from the
 * declaration alone, so they throw.
 */

import type { ArmFacets, StrategyArm } from './types.js';

/** Message prefix — every refusal names the door the caller used. */
const PREFIX = 'compareStrategyArms:';

/**
 * A canonical key for one arm's CONFIGURATION (facets + removals), used only to
 * detect two arms that are secretly the same arm. Hand-rolled rather than
 * `JSON.stringify` because key order in an object literal is authoring
 * accident, and two arms written `{model, scorer}` and `{scorer, model}` are
 * the same arm.
 */
export function armConfigKey(arm: StrategyArm): string {
  const facets = canonical(arm.facets ?? {});
  const ablations = [...(arm.ablations ?? [])].map(canonical).sort().join('|');
  return `${facets}::${ablations}`;
}

/** Stable, sorted, depth-first rendering of a plain value. */
function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    // Spec arrays (`ignoredTools`, `excludeInjectionIds`) are SETS in meaning —
    // two arms differing only in the order they list two tool names are one arm.
    return `[${value.map(canonical).sort().join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${canonical(v)}`);
  return `{${entries.join(',')}}`;
}

/** How many facet leaves an arm declares — 0 means it names no configuration. */
export function declaredFacetCount(facets: ArmFacets | undefined): number {
  if (facets === undefined) return 0;
  let count = 0;
  for (const [key, value] of Object.entries(facets)) {
    if (value === undefined) continue;
    if (key === 'memory' && typeof value === 'object') {
      count += Object.values(value as Record<string, unknown>).filter(
        (v) => v !== undefined,
      ).length;
      continue;
    }
    count += 1;
  }
  return count;
}

/**
 * Refuse every comparison that cannot mean anything, and resolve which arm is
 * the incumbent. Returns the resolved baseline arm id.
 */
export function validateStrategyArms(
  arms: readonly StrategyArm[],
  baselineArmId: string | undefined,
): string {
  // 1. A comparison needs two sides. One arm re-run N times is a VARIANCE
  //    measurement, and the library already has a door for it.
  if (arms.length < 2) {
    throw new Error(
      `${PREFIX} a comparison needs at least two arms — got ${arms.length}. To measure one ` +
        `configuration's own run-to-run variance, probe it with runAblationProbe(config, []) ` +
        `instead; to remove a source from one configuration, use rerunWithoutSources.`,
    );
  }

  // 2 + 3. Ids are the readout's primary key and every verdict sentence's
  //        subject. A blank or repeated one makes the result unreadable.
  const seen = new Set<string>();
  for (const arm of arms) {
    if (typeof arm.id !== 'string' || arm.id.trim() === '') {
      throw new Error(
        `${PREFIX} every arm needs a non-empty id — it names the arm in each verdict and keys ` +
          `the readout. Give each configuration a short label ('topK', 'rerank').`,
      );
    }
    if (seen.has(arm.id)) {
      throw new Error(
        `${PREFIX} two arms share the id '${arm.id}' — arms are reported one row per id, so the ` +
          `second would overwrite the first. Give them distinct labels.`,
      );
    }
    seen.add(arm.id);
  }

  // 4. The incumbent must exist: it is the reference AND the null band.
  const resolved = baselineArmId ?? arms[0].id;
  if (!seen.has(resolved)) {
    throw new Error(
      `${PREFIX} baselineArmId '${resolved}' matches no arm — declared arms: ` +
        `[${arms.map((a) => a.id).join(', ')}]. The baseline arm is the incumbent: the one the ` +
        `others are compared against, and the one whose own reruns form the null band.`,
    );
  }

  // 5. A challenger that names no configuration cannot be checked against the
  //    run manifest and cannot be told apart from the incumbent. The BASELINE
  //    arm may name nothing — "the configuration as it stands" is a real arm,
  //    and it is the factual one.
  for (const arm of arms) {
    if (arm.id === resolved) continue;
    if (declaredFacetCount(arm.facets) === 0 && (arm.ablations ?? []).length === 0) {
      throw new Error(
        `${PREFIX} arm '${arm.id}' declares no configuration — no facets and no ablations. An ` +
          `arm that names nothing cannot be checked against the run manifest and cannot be told ` +
          `apart from the baseline arm '${resolved}'. Declare at least one facet (e.g. ` +
          `{ memory: { retrieval: 'rerank' } }) or an ablation.`,
      );
    }
  }

  // 6. THE incoherent-spec refusal: two arms that are the same configuration.
  //    Comparing an arm with itself measures seed variance and would report it
  //    as a difference between strategies.
  const byConfig = new Map<string, string>();
  for (const arm of arms) {
    const key = armConfigKey(arm);
    const twin = byConfig.get(key);
    if (twin !== undefined) {
      throw new Error(
        `${PREFIX} arms '${twin}' and '${arm.id}' declare the SAME configuration — comparing an ` +
          `arm with itself measures seed-to-seed variance, not a difference between strategies. ` +
          `Change one arm's facets, or raise \`samples\` on a single arm if variance is what you ` +
          `want to see.`,
      );
    }
    byConfig.set(key, arm.id);
  }

  return resolved;
}
