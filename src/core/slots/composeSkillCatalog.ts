import type { LLMToolSchema } from '../../provider-contract/types.js';
import { menuOutstanding, type TurnRoute } from '../../injection-engine/routingPolicy.js';

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

export function composeSkillCatalog(
  tools: readonly LLMToolSchema[],
  readSkillFor: ReadSkillFor | undefined,
  resolvedHidden: readonly string[] | undefined,
  currentSkillId: string | undefined,
  turnRoute: TurnRoute | undefined,
) {
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
