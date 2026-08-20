/**
 * The park card — what the MODEL is told when a map is parked.
 *
 * Pattern: pure function over plain data. No I/O, no scope, no engine.
 * Role:    the kernel's model-visible surface. Everything else the kernel
 *          produces lands on the RECORD (skip reasons, `map.parked` events),
 *          which a human reads afterwards. The model reads none of it.
 *
 * ── The defect this exists for (9.59.0) ──────────────────────────────────
 * Parking was invisible on the wire, and on the default posture it was worse
 * than invisible — it was CONTRADICTED. `.maps()` documents that parking stops
 * "the prompt fragment AND tools"; with `scopeTools` false (the default for
 * flat graphs until 10.0.0) only the fragment stopped, and every one of the
 * parked map's tool schemas kept riding. So the model saw four tools it was
 * being invited to call, belonging to a skill whose instructions had silently
 * vanished, with nothing anywhere saying why or how to get them back.
 *
 * A door the model cannot see is not a door. Re-engagement was reachable in
 * principle and unreachable in practice, because nothing told the model that
 * re-picking a skill it appears to already be in means anything at all.
 *
 * ── What the card says, and why each part is there ───────────────────────
 * CURSOR and ENGAGEMENT are printed as SEPARATE fields. That is the whole
 * teaching move: the model is shown the distinction rather than left to infer
 * a contradiction from a skill that is both "where I am" and "not talking".
 * Then the REASON, so the state is not arbitrary. Then the WAY BACK, named as
 * a concrete call, with the one sentence that stops it being read as a cursor
 * move: it changes engagement, not position.
 *
 * Kept to a few lines on purpose. This rides every call while a map is parked,
 * and a verbose status block would spend the tokens parking just saved.
 */

import type { EngagementPlan, MapEngagement, MapEngagementRecord, MountedMap } from './types.js';

/** One line per parked map, plus the header that names what these lines are. */
const HEADER = 'Map status (the framework is telling you this; it is not part of the task):';

/**
 * Why this map is parked, in the model's own terms.
 *
 * Deliberately does NOT restate the idle arithmetic — the model cannot act on
 * "idle 3 of 3" and the record already carries it. It states the one thing the
 * model can act on: nothing currently justifies serving this map.
 */
function reasonOf(record: MapEngagementRecord): string {
  return record.by === 'assumed'
    ? 'nothing on this turn explains why it is loaded'
    : 'no recent evidence that it is the right map for this turn';
}

/**
 * Render the model-visible card for a set of parked maps.
 *
 * Returns `undefined` when nothing is parked — the caller then adds nothing to
 * the prompt at all, which keeps the unparked path byte-identical.
 */
export function parkCard(
  plan: EngagementPlan,
  engagement: MapEngagement | undefined,
): string | undefined {
  if (engagement === undefined || engagement.length === 0) return undefined;
  const byId = new Map<string, MountedMap>(plan.maps.map((m) => [m.id, m]));
  const lines: string[] = [];

  for (const record of engagement) {
    if (record.standing !== 'parked') continue;
    const map = byId.get(record.mapId);
    if (map === undefined) continue;

    // The cursor is named, and named as UNCHANGED. A model that reads
    // "engagement: parked" beside a skill id needs to be told in the same
    // breath that its position did not move, or the obvious inference is that
    // it was thrown out of the skill.
    const cursor = record.at ?? '(unknown)';
    const members = map.memberIds.join(', ');
    lines.push(
      `  - ${map.id} — cursor: ${cursor} (unchanged) · engagement: PARKED · ` +
        `reason: ${reasonOf(record)} · re-engage: available`,
    );
    lines.push(
      `    Its instructions and its tools are not being sent right now. To bring them ` +
        `back, call read_skill for any of: ${members}. That is allowed even for the ` +
        `skill the cursor is already on — it changes ENGAGEMENT (whether this map is ` +
        `sent to you), not POSITION (where the cursor is). If this map is not what ` +
        `this turn needs, ignore this and carry on.`,
    );
  }

  return lines.length === 0 ? undefined : `${HEADER}\n${lines.join('\n')}`;
}

/**
 * The injection id the card is served under.
 *
 * A stable, reserved id so the card is one identifiable row on the record
 * (composition, budget, the context ledger) rather than an anonymous string
 * appended to somebody else's fragment.
 */
export const PARK_CARD_ID = 'agentfootprint:map-status';
