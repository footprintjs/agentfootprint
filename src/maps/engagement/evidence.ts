/**
 * The renewal feed — who used which map's contribution this pass.
 *
 * Pattern: pure functions over one pass's facts. No state.
 * Role:    the counter the lease machine acts on. An earlier design round
 *          shipped "a parking machine nothing ever tells to park" — this file
 *          is the telling: it joins the previous batch's tool calls, the
 *          cursor move, and the model's own picks to the map that owns them,
 *          and answers with typed renewal evidence.
 *
 * The join keys already exist in the run: served tool schemas are tagged by
 * the contributing injection id, cursor moves carry the clause that won, and
 * an accepted `read_skill` pick names its skill. Nothing here guesses.
 */

import type { EvidenceStrength, MountedMap } from './types.js';

/** The one slice of a pass the feed reads. All fields are plain data. */
export interface EngagementPass {
  readonly iteration: number;
  /** The map node the cursor stands on AFTER this pass's advance (skill maps: the skill id). */
  readonly currentNode?: string;
  /**
   * The clause that won this pass's cursor advance — mirrors the skill map's
   * `CursorMove.by` vocabulary. Absent when the map holds no cursor.
   */
  readonly moveBy?: string;
  /** The matched text, when the winning clause carried one (already bounded upstream). */
  readonly witness?: string;
  /** The PREVIOUS iteration's whole tool batch, in call order. */
  readonly toolResults: readonly { readonly toolName: string }[];
  /** The `read_skill` pick the gate accepted last iteration, if any. */
  readonly pendingSkillPick?: string;
  /**
   * The `read_skill` picks the gate accepted ON THE PREVIOUS PASS — hops,
   * open skills and re-engagements alike. PER-PASS, and that word is the
   * whole fix (9.59.0).
   *
   * It replaces `activatedInjectionIds`, which was the turn-cumulative
   * activation list: it is cleared only at run start, and a mounted map's
   * member list is every node in the graph, so ONE accepted `read_skill`
   * anywhere produced "explicit evidence" on every pass for the rest of the
   * turn. Twelve passes after an unrelated pick, a record could read
   * `standing: engaged, by: 'explicit', idle: 0` while the wrong 7,000-
   * character fragment rode every call. The same lever that recovers a parked
   * map silently switched the kernel off.
   *
   * Renewal must be FRESH evidence. That an `llm-activated` skill stays
   * active turn-long is true, but it is the *served* condition, not the
   * renewal one — a map riding forever without being used is exactly what the
   * kernel exists to park.
   */
  readonly acceptedSkillPicks: readonly string[];
  /**
   * The injection ids this map's contribution actually reached the wire
   * through on the PREVIOUS pass (9.59.0) — the previous pass's per-slot
   * active set, flattened.
   *
   * The idle test's first documented clause, and until now the unimplemented
   * one: "the map's contribution was actually served". It is honestly
   * knowable for the pass the idle test judges — the idle test is about the
   * previous pass, and the previous pass's active set is already a boundary
   * argument at the stage that runs the advance.
   */
  readonly servedLastPass: readonly string[];
}

/** One piece of renewal evidence, typed by what produced it. */
export type RenewalEvidence =
  | { readonly kind: 'owned-tool-called'; readonly toolName: string }
  | { readonly kind: 'cursor-moved'; readonly by: string }
  | { readonly kind: 'explicit-pick'; readonly skillId: string }
  | { readonly kind: 'member-activated'; readonly skillId: string };

/**
 * Classify a cursor-move clause into an evidence strength. Mirrors the skill
 * map's `CursorMoveCause` vocabulary.
 *
 * Two defaults, and the difference matters (9.59.0):
 * - `'stay'` and `'none'` are NOT MOVES. They answer `assumed`: the cursor is
 *   where it already was and nothing explains why. Staying is exactly what
 *   the recorded stuck turn did 29 times out of 30 — classifying it as
 *   system evidence is how that turn would have been renewed forever.
 * - Any OTHER unrecognized clause counts as `structural`, unchanged: a future
 *   clause is presumed to be a real routing decision, and there a wrongly
 *   strong reading merely delays a park while a wrongly weak one parks a map
 *   the system itself just routed to.
 */
export function strengthOfMove(by: string): EvidenceStrength {
  switch (by) {
    case 'model-pick':
      return 'explicit';
    case 'route':
    case 'tool-proposal':
    case 'continuity':
      return 'structural';
    case 'intent':
    case 'decider':
      return 'semantic';
    case 'entry':
      return 'lexical';
    case 'stay':
    case 'none':
      return 'assumed';
    default:
      return 'structural';
  }
}

/** Rank for upgrades: a stronger renewal upgrades a weaker engagement. */
const STRENGTH_RANK: Readonly<Record<EvidenceStrength, number>> = {
  explicit: 4,
  structural: 3,
  semantic: 2,
  lexical: 1,
  assumed: 0,
};

export function strongerOf(a: EvidenceStrength, b: EvidenceStrength): EvidenceStrength {
  return STRENGTH_RANK[a] >= STRENGTH_RANK[b] ? a : b;
}

/**
 * A guess decays without corroboration; system- and model-backed standings do
 * not. `assumed` — nobody said why — decays too: an unknown cause is the
 * weakest thing on the record, not the strongest.
 */
export function isTentative(strength: EvidenceStrength): boolean {
  return strength === 'lexical' || strength === 'semantic' || strength === 'assumed';
}

/**
 * All renewal evidence one map earned this pass. Empty array = no
 * corroboration (which is a fact the lease machine counts, not an error).
 */
export function renewalEvidenceOf(map: MountedMap, pass: EngagementPass): RenewalEvidence[] {
  const evidence: RenewalEvidence[] = [];
  const members = new Set(map.memberIds);
  const owned = new Set(map.toolNames);

  for (const r of pass.toolResults) {
    if (owned.has(r.toolName)) evidence.push({ kind: 'owned-tool-called', toolName: r.toolName });
  }
  // A cursor move BETWEEN this map's nodes (or into it) is the system routing
  // within the map — its warrant is live. A 'stay' is not a move and earns
  // nothing: staying is exactly what the stuck turn did 29 times.
  if (
    pass.moveBy !== undefined &&
    pass.moveBy !== 'stay' &&
    pass.moveBy !== 'none' &&
    pass.currentNode !== undefined &&
    members.has(pass.currentNode)
  ) {
    evidence.push({ kind: 'cursor-moved', by: pass.moveBy });
  }
  if (pass.pendingSkillPick !== undefined && members.has(pass.pendingSkillPick)) {
    evidence.push({ kind: 'explicit-pick', skillId: pass.pendingSkillPick });
  }
  // PER-PASS picks only. The turn-cumulative activation list used to be read
  // here, which made one pick anywhere disarm the kernel for the rest of the
  // turn (see `EngagementPass.acceptedSkillPicks`).
  for (const id of pass.acceptedSkillPicks) {
    if (members.has(id)) evidence.push({ kind: 'member-activated', skillId: id });
  }
  return evidence;
}

/** The strength of one piece of evidence. */
export function strengthOfEvidence(e: RenewalEvidence): EvidenceStrength {
  switch (e.kind) {
    case 'explicit-pick':
    case 'member-activated':
      return 'explicit';
    case 'owned-tool-called':
      return 'structural';
    case 'cursor-moved':
      return strengthOfMove(e.by);
  }
}

/** The strongest strength across a pass's evidence, or undefined when none. */
export function strongestOf(evidence: readonly RenewalEvidence[]): EvidenceStrength | undefined {
  let best: EvidenceStrength | undefined;
  for (const e of evidence) {
    const s = strengthOfEvidence(e);
    best = best === undefined ? s : strongerOf(best, s);
  }
  return best;
}
