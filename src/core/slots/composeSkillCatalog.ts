import type { LLMToolSchema } from '../../provider-contract/types.js';
import { menuOutstanding, type TurnRoute } from '../../injection-engine/routingPolicy.js';
import { roleVisibleClaim } from '../agent/skillContext/toolVisibility.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';
import { partyOfClaim, type WireCandidate } from './wireCollisions.js';

/** Keep a static implementation's identity, using a visible claim if it is shared. */
export function staticSkillCandidates(
  schemas: readonly LLMToolSchema[],
  claimants: ReadonlyMap<string, readonly ToolClaim[]> | undefined,
  hiddenSkillIds: readonly string[] | undefined,
): WireCandidate[] {
  const hidden = hiddenSkillIds === undefined ? undefined : new Set(hiddenSkillIds);
  return schemas.flatMap((schema): WireCandidate[] => {
    const claims = claimants?.get(schema.name);
    const first = claims?.[0];
    if (first === undefined) return [{ schema, party: { channel: 'registry' } }];
    const chosen =
      hidden?.size === 0
        ? first
        : claims?.find((claim) => claim.tool === first.tool && roleVisibleClaim(claim, hidden));
    return chosen === undefined ? [] : [{ schema, party: partyOfClaim(chosen), tool: chosen.tool }];
  });
}

/**
 * `undefined` means the OFFER is withheld for this iteration: the schema
 * leaves the request and the model is not invited to call `read_skill`
 * (9.86.0 — a `.tree()` with no open skills, where every pick is refused
 * by construction). Dispatch is untouched, as the substitution note above
 * says: the name stays in `registryByName`, so a model that calls it from
 * a restored transcript still reaches the gate and reads its refusal.
 */
export type ReadSkillFor = (
  args: {
    readonly currentSkillId?: string;
    readonly hiddenSkillIds?: readonly string[];
    /** The turn-start MENU (SG-C), passed only while the turn's menu verdict
     *  is outstanding — see the Compose stage. */
    readonly menu?: {
      readonly candidates: ReadonlyArray<{ readonly id: string; readonly relevance?: number }>;
      readonly cursorId?: string;
      readonly stay?: boolean;
    };
  },
  treeWithheld?: (ids: readonly string[]) => void,
) => LLMToolSchema | undefined;

/**
 * The static list drops a tool when every declaring skill is hidden from
 * the caller's role in this iteration. Both strategies read the same
 * registration facts as the dispatch roster.
 */
export function composeSkillCatalog(
  tools: readonly LLMToolSchema[],
  readSkillFor: ReadSkillFor | undefined,
  resolvedHidden: readonly string[] | undefined,
  currentSkillId: string | undefined,
  turnRoute: TurnRoute | undefined,
  toolClaimants?: ReadonlyMap<string, readonly ToolClaim[]>,
) {
  if (toolClaimants !== undefined && resolvedHidden?.length !== 0) {
    const hidden = resolvedHidden === undefined ? undefined : new Set(resolvedHidden);
    tools = tools.filter((tool) => {
      const claims = toolClaimants.get(tool.name);
      return claims === undefined || claims.some((claim) => roleVisibleClaim(claim, hidden));
    });
  }
  // The turn-start MENU (SG-C) — composed from the SAME verdict the record
  // carries (`scope.turnRoute`, threaded by the mount mappers), and only
  // while it is OUTSTANDING: once an accepted pick moves the cursor, the
  // description stops offering a menu the turn has already resolved.
  // `menuOutstanding` is the one shared implementation (routingPolicy.ts).
  // Advisory relevance rides beside each candidate when the scorer ranked it.
  const menu =
    turnRoute?.offered !== undefined && menuOutstanding(turnRoute, currentSkillId)
      ? {
          candidates: turnRoute.offered.map((id) => {
            const rel = turnRoute.relevance?.find((r) => r.id === id)?.relevance;
            return { id, ...(rel !== undefined && { relevance: rel }) };
          }),
          ...(currentSkillId !== undefined && { cursorId: currentSkillId }),
          ...(turnRoute.stayOffered === true && { stay: true }),
        }
      : undefined;

  // Per-iteration `read_skill` offer. The cursor arriving here is THIS iteration's:
  // the Injection Engine already advanced it and its outputMapper wrote it to the
  // parent before this slot mounts — the same value the read_skill gate will read
  // when the model answers. Substituted by name so nothing else in the list moves.
  let withheldSkillIds: readonly string[] | undefined;
  const schemas = readSkillFor
    ? tools.flatMap((t) => {
        if (t.name !== 'read_skill') return [t];
        // `undefined` = the offer is WITHHELD this iteration (see
        // `readSkillFor`): the schema comes off the wire, the name stays in
        // the dispatch map. Position governs the offer, never dispatch.
        const offered = readSkillFor(
          {
            ...(currentSkillId !== undefined && { currentSkillId: currentSkillId }),
            ...(resolvedHidden !== undefined && { hiddenSkillIds: resolvedHidden }),
            ...(menu !== undefined && { menu }),
          },
          (ids) => {
            withheldSkillIds = ids;
          },
        );
        return offered === undefined ? [] : [offered];
      })
    : tools;
  return { schemas, withheldSkillIds };
}
