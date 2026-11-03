import { classifySkillTarget } from '../../../../../injection-engine/skillGraph.js';

/**
 * Is this `read_skill` target the cursor's own skill AND is that cursor
 * MOUNTED — the one owner of "this call would change nothing" (9.86.0).
 *
 * ── WHY POSITION ALONE IS NOT THE ANSWER ────────────────────────────────
 *
 * `classifySkillTarget` answers a question about POSITION: is the target where
 * the cursor stands? For most of the loop that settles it — the cursor's body
 * is in that call's system prompt and its tools are on that call's wire, so
 * asking to read it activates nothing, moves nothing and reveals nothing the
 * request did not already carry.
 *
 * A PARKED map breaks that. Parking suppresses a map's contribution and leaves
 * the cursor exactly where it was, so at a parked cursor the very same id is a
 * RE-ENGAGEMENT: the gate admits it, the map engages, and the member's body and
 * tools ride again on the next pass. That call moves something, which makes it
 * a capability, which makes it the policy's question to answer.
 *
 * The dispatch gate has known this since 9.59.0 — it tests re-engagement BEFORE
 * its self-call arm, which is this same fact written as two ordered arms. The
 * `skill_read` permission gate, 480 lines upstream, has no arms to order: it
 * asks one question and either spends the policy check or skips it, and it was
 * asking `classifySkillTarget` alone. So a role whose checker hid a skill could
 * have the model un-park and re-activate it. This function is the question that
 * gate now asks, over the parked set `parkedNow` hands both of them.
 *
 * @example
 * ```ts
 * atMountedCursor({ cursor: 'audit', target: 'audit' });                          // true  — a stay
 * atMountedCursor({ cursor: 'audit', target: 'audit', parked: new Set(['audit']) }); // false — a re-engagement
 * atMountedCursor({ cursor: 'audit', target: 'billing' });                        // false — a move
 * ```
 */
export function atMountedCursor(args: {
  /** Where the cursor stands. `undefined` = cold start (nothing is a stay). */
  readonly cursor?: string | undefined;
  /** The id the model asked for. */
  readonly target: string;
  /** Members of every map the kernel holds PARKED — `parkedMemberIds`. */
  readonly parked?: ReadonlySet<string> | undefined;
}): boolean {
  const stay =
    classifySkillTarget({
      ...(args.cursor !== undefined && { cursor: args.cursor }),
      target: args.target,
    }) === 'self';
  return stay && args.parked?.has(args.target) !== true;
}
