import { isDevMode } from 'footprintjs';
import { roleVisibleClaim } from '../agent/skillContext/toolVisibility.js';
import type { LLMToolSchema } from '../../provider-contract/types.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { sameToolParty, type ToolParty } from '../../tools/toolParty.js';
import type { Tool } from '../../tools/tools.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';

/** One schema put forward for the wire, by whom — and WHICH implementation. */
export interface WireCandidate {
  readonly schema: LLMToolSchema;
  readonly party: ToolParty;
  /**
   * The implementation behind the contract. Identity is by implementation:
   * two skills sharing ONE `Tool` reference (documented-legal) are one claim
   * however many routes it arrives by, and draw nothing. Absent only on a
   * chart with no claimant record (the message-API charts).
   */
  readonly tool?: Tool;
}

export const partyOfClaim = (c: ToolClaim): ToolParty => ({
  channel: c.channel,
  ...(c.id !== undefined && { id: c.id }),
});

interface ClaimIdentity {
  readonly party: ToolParty;
  readonly tool?: Tool;
}

export interface WireCollision {
  readonly name: string;
  readonly winner: ClaimIdentity;
  readonly competing: readonly ClaimIdentity[];
  readonly reserved: readonly ToolParty[];
}

/** The listing vouches for a provider candidate. A skill identity also needs the original role grant. */
function visible(
  identity: ClaimIdentity,
  claims: readonly ToolClaim[],
  hidden?: ReadonlySet<string>,
): boolean {
  const { party, tool } = identity;
  if (party.channel === 'skill')
    return claims.some(
      (claim) =>
        claim.channel === 'skill' &&
        claim.id === party.id &&
        claim.tool === tool &&
        roleVisibleClaim(claim, hidden),
    );
  const owners = claims.filter((claim) => claim.tool === tool);
  if (owners.length === 0 || owners.some((claim) => claim.channel !== 'skill')) return true;
  return owners.some((claim) => roleVisibleClaim(claim, hidden));
}

/** Both the event and the private selection read the same visible losers, in wire order. */
export function wireCollisions(
  byName: ReadonlyMap<string, readonly WireCandidate[]>,
  losers: ReadonlyMap<string, readonly WireCandidate[]>,
  registrations: ReadonlyMap<string, readonly ToolClaim[]> | undefined,
  hiddenSkillIds: readonly string[] | undefined,
): WireCollision[] {
  const hidden = hiddenSkillIds && new Set(hiddenSkillIds);
  const groups: WireCollision[] = [];
  for (const [name, putForward] of byName) {
    if (!losers.has(name) && !registrations?.get(name)?.length) continue;
    const winner = putForward[0];
    const claims = registrations?.get(name) ?? [];
    if (!visible(winner, claims, hidden)) continue;
    const seen = new Set<Tool>();
    const competing = (losers.get(name) ?? []).filter((candidate) => {
      if (!visible(candidate, claims, hidden)) return false;
      if (!candidate.tool) return true;
      if (seen.has(candidate.tool)) return false;
      seen.add(candidate.tool);
      return true;
    });
    // Reserved claims never competed. An implementation already put forward,
    // including one shared by two skills, cannot lose to itself.
    const reserved = claims
      .filter(
        (claim) =>
          visible({ party: partyOfClaim(claim), tool: claim.tool }, claims, hidden) &&
          !putForward.some(
            (candidate) =>
              candidate.tool === claim.tool || sameToolParty(candidate.party, partyOfClaim(claim)),
          ),
      )
      .map(partyOfClaim);
    if (competing.length || reserved.length) groups.push({ name, winner, competing, reserved });
  }
  return groups;
}

/** How a party is named in a sentence: `provider 'hub'`, `skill 'billing'`, `framework`. */
const describeParty = (p: ToolParty): string =>
  p.id === undefined ? p.channel : `${p.channel} '${p.id}'`;

/**
 * Report every tool name more than one party claimed this epoch (8.7.0;
 * re-subjected 9.92.0).
 *
 * The SUBJECT is the wire crossed with dispatch: for each name on the wire,
 * the party whose contract won it — which, since dispatch follows the offer,
 * is also the party that answers — against every other party that claimed
 * the name. Two kinds of loser, two events:
 *
 *   • a COMPETING loser put a contract forward this epoch and lost the merge
 *     (`losers`, from `mergeWire`). The name draws ONE
 *     `agentfootprint.tools.shadowed` naming the wire's party in both halves —
 *     the shipped event, kept truthful — and one `tools.claim_swallowed` per
 *     loser;
 *   • a RESERVED loser is a build-time claimant that never reached the merge
 *     (`claimants`, from `buildToolRegistry`): a scoped skill's tool while the
 *     skill is inactive, a held-out step tool, the framework's `skip_step`
 *     between tenures. Its name is held by somebody else this epoch and its
 *     implementation cannot be reached by any call, so it draws
 *     `tools.claim_swallowed` — and NOT `tools.shadowed`, because no contract of
 *     its competed for the wire.
 *
 * Until 9.92.0 this loop walked `activeInjections` against the pre-merge
 * provider list and ASSERTED `schemaFrom: 'provider'`, which could not see an
 * inactive skill, a static `.tool()` or a framework auto-attach, and named the
 * provider on epochs whose wire carried the skill's contract (recorded-not-
 * built, entries 1 and 2). Reading the merge's own record is what makes both
 * sentences true by construction.
 *
 * The events fire every iteration — that is the channel that reaches
 * production, where a dynamic provider can start a collision on iteration 9
 * of a run nobody is watching. The console line is dev-mode only and latched
 * per tool name per built chart, so a 20-iteration loop prints once.
 */
export function reportShadowedTools(
  scope: Parameters<typeof typedEmit>[0],
  iteration: number,
  collisions: readonly WireCollision[],
  warnedShadow: Set<string>,
): void {
  for (const group of collisions) {
    const { name: toolName, reserved } = group;
    const winner = group.winner.party;
    const competing = group.competing.map((candidate) => candidate.party);
    if (competing.length > 0) {
      typedEmit(scope, 'agentfootprint.tools.shadowed', {
        toolName,
        iteration,
        schemaFrom: winner.channel,
        ...(winner.id !== undefined && { schemaFromId: winner.id }),
        dispatchTo: winner.channel,
        ...(winner.id !== undefined && { dispatchToId: winner.id }),
      });
    }
    for (const lost of [...competing, ...reserved]) {
      typedEmit(scope, 'agentfootprint.tools.claim_swallowed', {
        toolName,
        iteration,
        lostBy: lost.channel,
        ...(lost.id !== undefined && { lostById: lost.id }),
        wonBy: winner.channel,
        ...(winner.id !== undefined && { wonById: winner.id }),
      });
    }
    if (!isDevMode() || warnedShadow.has(toolName)) continue;
    warnedShadow.add(toolName);
    const others = [...competing, ...reserved].map(describeParty).join(', ');
    // eslint-disable-next-line no-console
    console.warn(
      `agentfootprint tools: '${toolName}' is claimed by ${describeParty(winner)} AND by ` +
        `${others}. The model is shown ${describeParty(winner)}'s contract and ` +
        `${describeParty(winner)}'s implementation answers; the other claim answers no call ` +
        `while the name is held. Rename one of them, or drop the duplicate.`,
    );
  }
}
