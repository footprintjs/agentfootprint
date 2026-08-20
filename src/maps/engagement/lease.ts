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
 * the recovery door, so parking is never a trap. That door is real as of
 * 9.59.0: the reachability gate used to refuse a pick of the node the cursor
 * already occupies, which for a single-member map (or any map parked where
 * the model wants to return) made parking permanent for the rest of the turn.
 * A pick is now routed by INTENT — of a PARKED map's member it is a
 * RE-ENGAGEMENT, which changes engagement and not position.
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
  EvidenceStrength,
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
  /**
   * Tool NAMES held off the wire this pass — every tool contributed by a
   * parked map's members (9.59.0).
   *
   * The engagement axis suppresses tools on its OWN authority, independently
   * of `scopeTools`. The two are orthogonal and always were: `scopeTools`
   * answers "do this map's tools follow the CURSOR?", parking answers "is this
   * map talking at all?". Before this field, parking answered only the first
   * half of its own promise — with `scopeTools` false (the default for flat
   * graphs until 10.0.0) a parked map's prompt stopped and all four of its
   * tool schemas kept riding, so the wire actively contradicted the park.
   */
  readonly parkedToolNames: readonly string[];
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
 *    An upgrade is a CHANGE: it emits, and `foundedBy`/`foundedAt` keep the
 *    cause the engagement actually started on.
 * 3. A tentative engagement with no evidence counts one idle pass when ALL
 *    THREE clauses hold: its contribution was served last pass, none of its
 *    tools was called, and the model called something else instead. At
 *    `renewalGrace` it parks. A pass with no tool calls at all counts nothing
 *    (the model was thinking, not ignoring), and neither does a pass where
 *    the map's contribution never reached the wire (it cannot be ignored if
 *    it was not there).
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
  const parkedToolNames: string[] = [];
  const priorByMap = new Map((prior ?? []).map((r) => [r.mapId, r]));

  for (const map of plan.maps) {
    const record = advanceOne(map, priorByMap.get(map.id), pass, plan.renewalGrace, changes);
    if (record !== undefined) {
      nextRecords.push(record);
      if (record.standing === 'parked') {
        parkedInjectionIds.push(...map.memberIds);
        // A parked map's tools come off the wire whatever the tool posture.
        parkedToolNames.push(...map.toolNames);
      }
    }
  }

  return { next: nextRecords, parkedInjectionIds, parkedToolNames, changes };
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
    //
    // An ABSENT clause founds `assumed`, not `structural` (9.59.0). Three
    // reachable ways in, all of them previously written down as the
    // strongest, non-decaying category:
    //   • the graph has no explain-next-skill hook, so no cause ever arrives
    //     (now also refused at mount — a kernel that can never park anything
    //     is decoration);
    //   • the cause was `'stay'` or `'none'`, which are not moves;
    //   • this is a later TURN: engagement state is per-run but the cursor is
    //     not, so turn one's mistaken regex entry arrived on turn two with no
    //     cause attached and was laundered into a permanent warrant.
    // `assumed` is tentative, so all three now decay and park honestly
    // instead of standing forever on a cause nobody stated.
    const by = strongest ?? (pass.moveBy !== undefined ? strengthOfMove(pass.moveBy) : 'assumed');
    // POSITION is recorded separately from ENGAGEMENT from the very first
    // pass, so the two can never be read off one another later.
    const positionBy = pass.moveBy !== undefined ? strengthOfMove(pass.moveBy) : 'assumed';
    const record: MapEngagementRecord = {
      mapId: map.id,
      standing: 'engaged',
      by,
      since: pass.iteration,
      foundedBy: by,
      foundedAt: pass.iteration,
      ...(cursorInMap && pass.currentNode !== undefined && { foundedOn: pass.currentNode }),
      ...(cursorInMap &&
        pass.currentNode !== undefined && {
          at: pass.currentNode,
          atBy: positionBy,
          atSince: pass.iteration,
        }),
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
        // The founding pair survives a park and a recovery: the question
        // "was this founded on a guess?" has ONE answer for the life of the
        // record, whatever the standing has done since.
        foundedBy: prior.foundedBy,
        foundedAt: prior.foundedAt,
        ...(prior.foundedOn !== undefined && { foundedOn: prior.foundedOn }),
        ...positionOf(map, prior, pass),
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
  const position = positionOf(map, prior, pass);
  const moved = position.at !== undefined && position.at !== prior.at;

  // ── TENANT CHANGE (9.59.0) — the cursor moved to a DIFFERENT member ────
  // Eligibility is re-derived from the new position's OWN evidence rather
  // than inherited from the old tenant's. The map is still engaged and its
  // founding cause is untouched; what changed is the SUBJECT of the claim.
  //
  // The case the ruling names: the user explicitly asked for A, a declared
  // edge then moved the cursor to B. Under the old single-`by` model the
  // record read `explicit` on B — a user request for a skill the person had
  // never mentioned, and `explicit` never decays, so the map rode every
  // remaining call of the turn on a warrant B never had. Now B rests on the
  // strength of the clause that actually produced it (a declared route is
  // `structural`; an entry regex is `lexical` and can therefore park), while
  // `foundedBy`/`foundedAt`/`foundedOn` keep saying, truthfully and forever,
  // that this engagement began explicitly on A at iteration N.
  //
  // Downgrading here does NOT violate "never downgrade because time passed":
  // no time passed, the subject changed.
  if (moved) {
    const by = strongerOf(position.atBy ?? 'assumed', strongest ?? 'assumed');
    changes.push({
      kind: 'engaged',
      mapId: map.id,
      iteration: pass.iteration,
      by,
      tenantChanged: true,
      at: position.at,
      foundedBy: prior.foundedBy,
      ...(pass.witness !== undefined && { witness: pass.witness }),
    });
    return { ...prior, ...position, by, idle: 0 };
  }

  if (strongest !== undefined) {
    const by = strongerOf(prior.by, strongest);
    if (by === prior.by) return prior.idle === 0 ? prior : { ...prior, ...position, idle: 0 };
    // An UPGRADE is a standing change, so it goes on the record and it
    // emits. `by` moves; `foundedBy`/`foundedAt` never do — overwriting the
    // founding cause in place (and silently) is how a record founded on a
    // regex came to read `structural since iteration 1`.
    changes.push({
      kind: 'engaged',
      mapId: map.id,
      iteration: pass.iteration,
      by,
      upgraded: true,
      foundedBy: prior.foundedBy,
      ...(prior.witness !== undefined && { witness: prior.witness }),
    });
    return { ...prior, ...position, by, idle: 0 };
  }

  // No evidence. Idle counts ONLY when all three documented clauses hold.
  //
  // (1) SERVED — this map's contribution actually reached the wire on the
  //     pass being judged. Implemented as of 9.59.0 from the previous pass's
  //     per-slot active set; before that it was asserted and never checked,
  //     including in the skip reason written onto the record. A contribution
  //     that never rode cannot have been ignored, so it earns no idle.
  // (2) NONE OF ITS TOOLS CALLED — by control flow: an owned-tool call is
  //     evidence, and evidence returned above.
  // (3) THE TURN WENT ELSEWHERE — at least one tool call landed. A pass with
  //     no tool calls at all counts nothing: the model was thinking.
  const served = pass.servedLastPass.some((id) => map.memberIds.includes(id));
  const calledElsewhere = pass.toolResults.length > 0;
  if (!served || !calledElsewhere) return prior;

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

/**
 * FACT 2 — where the cursor is, and why it is there.
 *
 * Observed from the pass, never set: the kernel reads a position it has no
 * power to move. When the cursor is outside this map (or unknown) the prior
 * position is kept rather than blanked — "I cannot see it right now" is not
 * "it moved", and blanking would fabricate a tenant change on the next pass.
 */
function positionOf(
  map: MountedMap,
  prior: MapEngagementRecord,
  pass: EngagementPass,
): { at?: string; atBy?: EvidenceStrength; atSince?: number } {
  const node = pass.currentNode;
  if (node === undefined || !map.memberIds.includes(node)) {
    return {
      ...(prior.at !== undefined && { at: prior.at }),
      ...(prior.atBy !== undefined && { atBy: prior.atBy }),
      ...(prior.atSince !== undefined && { atSince: prior.atSince }),
    };
  }
  if (node === prior.at) {
    // Same tenant: the arrival facts stand. Restating them each pass would
    // reset `atSince` and erase how long this member has held the cursor.
    return {
      at: node,
      ...(prior.atBy !== undefined && { atBy: prior.atBy }),
      ...(prior.atSince !== undefined && { atSince: prior.atSince }),
    };
  }
  return {
    at: node,
    atBy: pass.moveBy !== undefined ? strengthOfMove(pass.moveBy) : 'assumed',
    atSince: pass.iteration,
  };
}
