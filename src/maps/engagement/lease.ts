/**
 * The lease machine — engagement advances one pass at a time, by evidence.
 *
 * Pattern: pure reducer. `advanceEngagement(plan, prior, pass)` returns the
 *          next state, the injection ids to suppress this pass, and the
 *          standing changes for the record. No I/O, no clock, no model.
 * Role:    the kernel's law. A TENTATIVE engagement (a regex or classifier
 *          guess) is renewed only by concrete evidence — the map's own tool
 *          called, the cursor routed by the system, the model asking by
 *          name. Without corroboration for `renewalGrace` consecutive
 *          passes it is PARKED: its cursor stays exactly where the map put
 *          it, and its prompt and tools simply stop riding the next calls.
 *          An engagement backed by explicit or structural evidence stands.
 *
 * Recovery is evidence too: any explicit or structural evidence while parked
 * re-engages the map on the spot — the model's accepted `read_skill` pick is
 * the shipped recovery door, so parking is never a trap.
 *
 * Measured grounding: in the recorded 30-call stuck turn (an entry regex
 * matched a noun), the map's four tools were never called and 29 of 30 moves
 * were "stay". Under grace 3 this reducer parks it on call four, saving the
 * remaining ~26 calls from re-serving ~7k characters of the wrong map.
 */

import {
  isTentative,
  renewalEvidenceOf,
  strengthOfMove,
  strongerOf,
  strongestOf,
  type EngagementPass,
} from './evidence.js';
import type {
  EngagementChange,
  EngagementPlan,
  MapEngagement,
  MapEngagementRecord,
  MountedMap,
} from './types.js';

/** What one pass of the reducer hands back. */
export interface EngagementAdvance {
  /** Next engagement state — write it back to scope under the alias key. */
  readonly next: MapEngagement;
  /** Injection ids whose contributions are suppressed THIS pass (parked maps' members). */
  readonly parkedInjectionIds: readonly string[];
  /** Standing changes this pass, for the typed events. Empty on a quiet pass. */
  readonly changes: readonly EngagementChange[];
}

/**
 * Advance every mounted map's engagement by one pass.
 *
 * Laws, in order:
 * 1. A map first earns a record when its cursor lands on a member or a member
 *    activates; the founding strength is the winning clause's strength.
 * 2. Renewal evidence resets `idle` and may UPGRADE the standing's strength
 *    (never downgrade — a guess later confirmed by the system stops decaying).
 * 3. A tentative engagement with no evidence, while the model called other
 *    tools, counts one idle pass; at `renewalGrace` it parks. All three
 *    clauses of the idle test matter: contributions served, none used, and
 *    the turn went somewhere else — a pass with no tool calls at all counts
 *    nothing (the model was thinking, not ignoring).
 * 4. `nonParkable` maps never park, whatever the count.
 * 5. Explicit or structural evidence re-engages a parked map immediately.
 */
export function advanceEngagement(
  plan: EngagementPlan,
  prior: MapEngagement | undefined,
  pass: EngagementPass,
): EngagementAdvance {
  const nextRecords: MapEngagementRecord[] = [];
  const changes: EngagementChange[] = [];
  const parkedInjectionIds: string[] = [];
  const priorByMap = new Map((prior ?? []).map((r) => [r.mapId, r]));

  for (const map of plan.maps) {
    const record = advanceOne(map, priorByMap.get(map.id), pass, plan.renewalGrace, changes);
    if (record !== undefined) {
      nextRecords.push(record);
      if (record.standing === 'parked') parkedInjectionIds.push(...map.memberIds);
    }
  }

  return { next: nextRecords, parkedInjectionIds, changes };
}

function advanceOne(
  map: MountedMap,
  prior: MapEngagementRecord | undefined,
  pass: EngagementPass,
  renewalGrace: number,
  changes: EngagementChange[],
): MapEngagementRecord | undefined {
  const evidence = renewalEvidenceOf(map, pass);
  const strongest = strongestOf(evidence);

  // ── No record yet: does this pass found one? ──────────────────────────
  if (prior === undefined) {
    const cursorInMap = pass.currentNode !== undefined && map.memberIds.includes(pass.currentNode);
    if (!cursorInMap && strongest === undefined) return undefined; // nothing to manage yet
    // Founding strength: the strongest evidence, else the clause that placed
    // the cursor (an entry regex founds a LEXICAL engagement — a guess).
    const by =
      strongest ?? (pass.moveBy !== undefined ? strengthOfMove(pass.moveBy) : 'structural');
    const record: MapEngagementRecord = {
      mapId: map.id,
      standing: 'engaged',
      by,
      since: pass.iteration,
      idle: 0,
      ...(pass.witness !== undefined && { witness: pass.witness }),
    };
    changes.push({
      kind: 'engaged',
      mapId: map.id,
      iteration: pass.iteration,
      by,
      ...(pass.witness !== undefined && { witness: pass.witness }),
    });
    return record;
  }

  // ── Parked: only re-engaging evidence changes anything. ───────────────
  if (prior.standing === 'parked') {
    if (strongest === 'explicit' || strongest === 'structural') {
      const record: MapEngagementRecord = {
        mapId: map.id,
        standing: 'engaged',
        by: strongest,
        since: pass.iteration,
        idle: 0,
        ...(pass.witness !== undefined && { witness: pass.witness }),
      };
      changes.push({
        kind: 'engaged',
        mapId: map.id,
        iteration: pass.iteration,
        by: strongest,
        reengaged: true,
        ...(pass.witness !== undefined && { witness: pass.witness }),
      });
      return record;
    }
    return prior; // stays parked; tentative evidence does not recover a park
  }

  // ── Engaged: renew, upgrade, or count idle. ───────────────────────────
  if (strongest !== undefined) {
    const by = strongerOf(prior.by, strongest);
    return by === prior.by && prior.idle === 0 ? prior : { ...prior, by, idle: 0 };
  }

  // No evidence. Idle counts ONLY when the turn actually went elsewhere:
  // at least one tool call landed and none of them was this map's.
  const calledElsewhere = pass.toolResults.length > 0;
  if (!calledElsewhere) return prior;

  const idle = prior.idle + 1;
  if (isTentative(prior.by) && idle >= renewalGrace && map.nonParkable !== true) {
    const record: MapEngagementRecord = {
      ...prior,
      standing: 'parked',
      since: pass.iteration,
      idle,
    };
    changes.push({
      kind: 'parked',
      mapId: map.id,
      iteration: pass.iteration,
      by: prior.by,
      idleCalls: idle,
      ...(prior.witness !== undefined && { witness: prior.witness }),
    });
    return record;
  }
  return { ...prior, idle };
}
