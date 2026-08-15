/**
 * The manifest bridge — which arm did this run belong to, according to the RUN
 * rather than according to the experimenter.
 *
 * Before 9.41.0 an arm label was bookkeeping: the consumer set a variable to
 * `'rerank'`, built an agent it believed re-ranked, and nothing in the library
 * could contradict it. `agentfootprint.agent.run_configured` names the adapters
 * and strategies a run is about to use, so the belief became checkable — and
 * {@link ArmFacets} is deliberately spelled in that event's own vocabulary so
 * the check is a field-by-field comparison and not a translation layer.
 *
 * Two directions, both here:
 *  - **verify** — `checkArmApplied(arm, manifest)`: the arm said `retrieval:
 *    'rerank'`; did the run agree? A contradiction costs the arm its verdict
 *    (`compare.ts`), because a difference measured between two arms that were
 *    secretly one configuration is not evidence about either.
 *  - **classify** — `matchArm(arms, manifest)`: hand it a recorded run's
 *    manifest and it says which declared arm that run belongs to. This is the
 *    door for grouping runs a study already made, offline, out of saved
 *    recordings.
 *
 * ## Absence is a contradiction, not a wildcard
 *
 * The manifest's own rule is that an absent field means "not configured", never
 * a guessed default. So an arm declaring `window: 'tokenBudget'` against a
 * manifest with no `window` is a MISMATCH, reported with `observed` absent. The
 * alternative — treating absence as "could be anything" — would let a run with
 * no window stage pass as the token-budget arm, which is exactly the mis-wiring
 * this file exists to catch.
 */

import type { CapturedEventLike } from '../types.js';
import { declaredFacetCount } from './validate.js';
import type {
  ArmFacetMismatch,
  ArmFacets,
  ManifestMemoryLike,
  RunManifestLike,
  StrategyArm,
} from './types.js';

/** The event type the run manifest rides on (9.41.0). */
export const RUN_CONFIGURED_EVENT = 'agentfootprint.agent.run_configured';

/**
 * Pull the run manifest out of a run's captured typed events — the same
 * `CapturedEventLike[]` bag `localizeContextBug` already accepts, so a consumer
 * who collected events with `agent.on('*', …)` needs no second capture.
 *
 * One manifest per run by design; the FIRST is returned. A bag holding events
 * from several runs is the caller's own mixing — filter by `meta.runId` first.
 */
export function manifestFromEvents(
  events: readonly CapturedEventLike[] | undefined,
): RunManifestLike | undefined {
  const event = events?.find((e) => e.type === RUN_CONFIGURED_EVENT);
  if (event === undefined) return undefined;
  const payload = event.payload;
  // Structural, not a cast-and-pray: a payload that is not an object at all is
  // no manifest, and reporting `undefined` keeps `checked: false` honest.
  return payload !== null && typeof payload === 'object' ? (payload as RunManifestLike) : undefined;
}

/**
 * Project a manifest onto the arm-facet vocabulary — the inverse of what an arm
 * declares. Memory rows collapse to the FIRST one; a study varying retrieval
 * across several mounted memories should declare `memory.id` and read the rows
 * itself rather than trust a projection to pick.
 */
export function armFacetsFromManifest(manifest: RunManifestLike): ArmFacets {
  const memory = manifest.memories?.[0];
  const provider = manifest.llm?.provider;
  const model = manifest.llm?.model;
  const reactMode = manifest.reactMode;
  const scorer = manifest.skillGraph?.scorer;
  const routing = manifest.skillGraph?.routing;
  const continuity = manifest.skillGraph?.continuity;
  const evidenceGate = manifest.evidenceGate;
  return {
    ...(provider !== undefined && { provider }),
    ...(model !== undefined && { model }),
    ...(isReactMode(reactMode) && { reactMode }),
    ...(manifest.window !== undefined && { window: manifest.window }),
    ...(scorer !== undefined && { scorer }),
    ...(isPosture(routing) && { routing }),
    ...(isContinuity(continuity) && { continuity }),
    ...(isPosture(evidenceGate) && { evidenceGate }),
    ...(memory !== undefined && { memory: { ...memory } }),
  };
}

/**
 * A stable label for a set of facets — sorted `key=value`, so two runs of one
 * configuration produce the same string whatever order the fields were written
 * in. Useful as a grouping key for N recorded runs.
 */
export function armLabel(facets: ArmFacets): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(facets)) {
    if (value === undefined) continue;
    if (key === 'memory') {
      for (const [mk, mv] of Object.entries(value as ManifestMemoryLike)) {
        if (mv !== undefined) parts.push(`memory.${mk}=${String(mv)}`);
      }
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  return parts.sort().join(',');
}

/**
 * Compare one arm's DECLARED facets against a run's manifest. Empty result =
 * the run agreed with everything the arm claimed.
 *
 * Only declared facets are compared. An arm is a claim about the facets it
 * names and says nothing about the rest — checking undeclared fields would fail
 * every arm for differing from the manifest in ways it never claimed.
 */
export function checkArmApplied(
  arm: StrategyArm,
  manifest: RunManifestLike,
): readonly ArmFacetMismatch[] {
  const facets = arm.facets;
  if (facets === undefined) return [];
  const out: ArmFacetMismatch[] = [];

  compare(out, 'provider', facets.provider, manifest.llm?.provider);
  compare(out, 'model', facets.model, manifest.llm?.model);
  compare(out, 'reactMode', facets.reactMode, manifest.reactMode);
  compare(out, 'window', facets.window, manifest.window);
  compare(out, 'skillGraph.scorer', facets.scorer, manifest.skillGraph?.scorer);
  compare(out, 'skillGraph.routing', facets.routing, manifest.skillGraph?.routing);
  compare(out, 'skillGraph.continuity', facets.continuity, manifest.skillGraph?.continuity);
  compare(out, 'evidenceGate', facets.evidenceGate, manifest.evidenceGate);

  const memory = facets.memory;
  if (memory !== undefined) {
    const rows = manifest.memories ?? [];
    if (memory.id !== undefined) {
      // Narrowed to ONE row: a missing row is a mismatch on the id itself, and
      // the remaining fields are then compared against that row alone.
      const row = rows.find((r) => r.id === memory.id);
      if (row === undefined) {
        out.push({
          facet: 'memory.id',
          declared: memory.id,
          ...(rows.length > 0 && { observed: rows.map((r) => r.id ?? '?').join(', ') }),
        });
      } else {
        for (const field of MEMORY_FIELDS) {
          compare(out, `memory.${field}`, memory[field], row[field]);
        }
      }
    } else if (!rows.some((row) => MEMORY_FIELDS.every((f) => matches(memory[f], row[f])))) {
      // Un-narrowed: ANY mounted memory satisfying every declared field counts.
      // Reported as ONE mismatch — naming a per-field winner across rows would
      // invent a memory that does not exist.
      out.push({
        facet: 'memory',
        declared: armLabel({ memory }),
        ...(rows.length > 0 && {
          observed: rows.map((row) => armLabel({ memory: row })).join(' | '),
        }),
      });
    }
  }
  return out;
}

/**
 * Which declared arm does this run belong to? The offline door: group N
 * recorded runs into arms by what each run's own manifest says.
 *
 * Rules, all conservative:
 * - only arms that DECLARE facets are candidates (an arm naming nothing matches
 *   every run and would swallow the whole study);
 * - a candidate matches when the manifest contradicts none of its facets;
 * - the MOST SPECIFIC match wins (most declared facets), and a tie returns
 *   `undefined` — two arms fitting one run equally well is an ambiguity, and
 *   guessing which the experimenter meant is exactly the bookkeeping this
 *   function replaces.
 */
export function matchArm(
  arms: readonly StrategyArm[],
  manifest: RunManifestLike,
): StrategyArm | undefined {
  const fits = arms
    .filter((arm) => declaredFacetCount(arm.facets) > 0)
    .filter((arm) => checkArmApplied(arm, manifest).length === 0)
    .map((arm) => ({ arm, specificity: declaredFacetCount(arm.facets) }))
    .sort((a, b) => b.specificity - a.specificity);
  if (fits.length === 0) return undefined;
  if (fits.length > 1 && fits[0].specificity === fits[1].specificity) return undefined;
  return fits[0].arm;
}

// ─── internals ───────────────────────────────────────────────────────

const MEMORY_FIELDS = ['type', 'strategy', 'retrieval', 'embedderId', 'flavor'] as const;

function matches(declared: string | undefined, observed: string | undefined): boolean {
  return declared === undefined || declared === observed;
}

function compare(
  out: ArmFacetMismatch[],
  facet: string,
  declared: string | undefined,
  observed: string | undefined,
): void {
  if (matches(declared, observed)) return;
  out.push({ facet, declared: declared as string, ...(observed !== undefined && { observed }) });
}

function isReactMode(
  value: string | undefined,
): value is 'classic' | 'dynamic' | 'dynamic-grouped' {
  return value === 'classic' || value === 'dynamic' || value === 'dynamic-grouped';
}

function isPosture(value: string | undefined): value is 'assist' | 'guard' | 'rails' {
  return value === 'assist' || value === 'guard' || value === 'rails';
}

function isContinuity(value: string | undefined): value is 'turn' | 'conversation' {
  return value === 'turn' || value === 'conversation';
}
