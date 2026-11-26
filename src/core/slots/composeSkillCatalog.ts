import type { LLMToolSchema } from '../../provider-contract/types.js';
import { menuOutstanding, type TurnRoute } from '../../injection-engine/routingPolicy.js';
import { visibleToRole } from '../../lib/spokenIds.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';

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
 * The skills that declare a static-list name, or `undefined` when any other
 * party (a `.tool()`, the framework) claims it too: then it is not a skill's.
 */
function skillOwners(claims: readonly ToolClaim[] | undefined): readonly string[] | undefined {
  if (claims === undefined || claims.some((claim) => claim.channel !== 'skill')) return undefined;
  return claims.flatMap((claim) => (claim.id === undefined ? [] : [claim.id]));
}

/**
 * `listedClaims` is present only under the `listed` skill context
 * (`core/agent/skillContext/`): every skill tool rides the static list there,
 * so the static list drops each tool EVERY declaring skill of which is hidden
 * from this caller's role — the dispatch roster's sole-owner rule
 * (`lib/spokenIds.ts` · `visibleToRole`), asked of the hidden set resolved for
 * THIS iteration. Absent, and the list is the one it always was.
 */
export function composeSkillCatalog(
  tools: readonly LLMToolSchema[],
  readSkillFor: ReadSkillFor | undefined,
  resolvedHidden: readonly string[] | undefined,
  currentSkillId: string | undefined,
  turnRoute: TurnRoute | undefined,
  listedClaims?: ReadonlyMap<string, readonly ToolClaim[]>,
) {
  if (listedClaims !== undefined && resolvedHidden !== undefined && resolvedHidden.length > 0) {
    const hidden = new Set(resolvedHidden);
    tools = tools.filter((tool) => visibleToRole(skillOwners(listedClaims.get(tool.name)), hidden));
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
