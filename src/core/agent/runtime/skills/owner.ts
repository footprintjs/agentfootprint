import type { LLMToolSchema } from '../../../../provider-contract/types.js';
import { isDevMode } from 'footprintjs';
import { buildReadSkillTool } from '../../../../injection-engine/skillTools.js';
import { checkerGoverns } from '../../../../provider-contract/types.js';
import { readPermissionDecision } from '../../../../provider-contract/permissionDecision.js';
import { skillTarget } from '../../../../security/skillTarget.js';
import { memberIdentityIn } from '../../../memberRun.js';
import type { AgentContext } from '../contracts.js';

export function openSkillIds(this: Pick<AgentContext, 'configuration'>): readonly string[] {
  return this.configuration.injections
    .filter(
      (i) =>
        i.flavor === 'skill' &&
        i.trigger.kind === 'llm-activated' &&
        !this.configuration.skillGraphEdgeTargets.has(i.id),
    )
    .map((i) => i.id);
}

// FOLD (resolver) · assembles the ReadSkillOffer the read_skill DESCRIPTION (a Lens) is built from:
// grantable ← makeReachableSkills ∪ openSkillIds, cursor ← scope, hidden ← hiddenSkillIdsNow.
// It assembles; it never composes a sentence. The sentence is skillToolDescriptors.describeOffer.
/**
 * The per-iteration `read_skill` offer builder — or `undefined` to leave the tool
 * exactly as it has always been (8.5.0).
 *
 * `read_skill` enumerated every registered skill while the gate admitted only
 * `reachableSkills(cursor) ∪ open`, so under a graph the model was handed ids it
 * would be refused, every iteration, and could spend a whole run re-asking. The
 * OFFER is rebuilt here from the same two functions the gate itself calls — one
 * source of truth, so the menu cannot drift from the verdict.
 *
 * Two guards:
 *
 *   • no graph AND no per-role skill visibility → `undefined`. A plain
 *     `read_skill` agent has no cursor and no gate; every registered skill
 *     really is reachable, and the tool keeps its byte-identical description.
 *   • `reactMode: 'classic'` → `undefined` for the GRAPH menu, plus a dev-mode
 *     warning. Classic composes the tools slot on turn 1 ONLY (see the Context
 *     selector's `includeStatic`), so a cursor-scoped menu would freeze at the
 *     cold-start cursor and keep advertising it for the rest of the run — a
 *     worse lie than the honest full catalog. `.selfExplain()` refuses under
 *     classic for exactly this caching reason; here the full catalog is a
 *     correct fallback, so this warns instead of refusing.
 *
 * Per-role VISIBILITY (9.11.0) survives classic, and that is not an
 * inconsistency: a cursor moves every iteration, but who is asking does not
 * change inside one run. A filter computed on turn 1 is still exactly right
 * on turn 9.
 */
export function readSkillOfferFor(
  this: Pick<AgentContext, 'configuration' | 'governsSkillVisibility' | 'openSkillIds'>,
):
  | ((args: {
      readonly currentSkillId?: string;
      readonly hiddenSkillIds?: readonly string[];
      readonly menu?: {
        readonly candidates: ReadonlyArray<{ readonly id: string; readonly relevance?: number }>;
        readonly cursorId?: string;
        readonly stay?: boolean;
      };
    }) => LLMToolSchema | undefined)
  | undefined {
  const skills = this.configuration.injections.filter((i) => i.flavor === 'skill');
  if (skills.length === 0) return undefined;
  const filtersByRole = this.governsSkillVisibility();
  if (!this.configuration.skillGraphReachable && !filtersByRole) return undefined;
  let graphMenu = this.configuration.skillGraphReachable;
  if (graphMenu && this.configuration.reactMode === 'classic') {
    if (isDevMode()) {
      // eslint-disable-next-line no-console
      console.warn(
        "agentfootprint Agent: read_skill's menu is built at turn 1 under " +
          "reactMode: 'classic', which caches the tools slot — so it lists every " +
          'registered skill instead of the ones reachable from the cursor, and the ' +
          "model will be offered ids the graph will refuse. Use the default 'dynamic' " +
          "mode (or 'dynamic-grouped') for a cursor-tracking menu.",
      );
    }
    graphMenu = undefined;
    if (!filtersByRole) return undefined;
  }
  const open = this.openSkillIds();
  const reachable = graphMenu;
  // A decision `tree()` keeps no cursor, so every routing pick is refused by
  // construction (9.86.0). The descriptor withholds the tool entirely when
  // nothing is left to open, and explains the tree when something is.
  const treeRouted = reachable !== undefined && this.configuration.skillGraphIsTree;
  return (args) => {
    const grantable = reachable
      ? [...new Set([...reachable(args.currentSkillId), ...open])]
      : undefined;
    // `undefined` when the offer is WITHHELD — the tools slot then drops the
    // schema from the request. (`skills` is non-empty, so an empty catalog is
    // not one of the ways this can be undefined.)
    return buildReadSkillTool(skills, {
      ...(grantable !== undefined && { grantable }),
      ...(args.hiddenSkillIds !== undefined && { hiddenIds: args.hiddenSkillIds }),
      // WHERE THE MODEL STANDS (9.84.0) — unconditional, unlike the menu below.
      // The description names it, and stops listing it as unreachable.
      ...(args.currentSkillId !== undefined && { cursorId: args.currentSkillId }),
      // The turn-start menu (SG-C) — the tools slot passes it only while the
      // verdict is outstanding; describeOffer leads with it.
      ...(args.menu !== undefined && { menu: args.menu }),
      ...(treeRouted && { treeRouted: true }),
    })?.schema;
  };
}

/**
 * Does the configured checker ask to decide which skills this caller sees?
 * (9.11.0)
 *
 * Absence is NO — see `PermissionChecker.governs`. This is the ONE switch:
 * false and the menu, the resolver and the activation gate are all inert, so
 * an agent with a checker that predates 9.11.0 composes the same prompt it
 * always did.
 */
export function governsSkillVisibility(this: Pick<AgentContext, 'configuration'>): boolean {
  return checkerGoverns(this.configuration.permissionChecker, 'skill_read');
}

// FOLD (resolver) · computes "which skill ids may this caller be told about".
// The OWNER of the published fact is src/injection-engine/buildInjectionEngineSubflow.ts · hiddenSkillIdsOf
// (the engine's Gather stage), which resolves it once per iteration, before the cursor and the
// evaluator decide, and publishes it on scope; every model-facing composer reads THAT.
// Second caller: the turn router (stages/routeTurn.ts · resolveHidden) resolves it again, with different
// failure semantics, and publishes nothing — two sweeps of one policy question per turn.
/**
 * Which skills the caller's role may NOT see, asked once per iteration
 * (9.11.0).
 *
 * Per iteration rather than per run because the checker is a port: a
 * hub-backed one can legitimately answer differently as a grant is revoked
 * mid-conversation, and caching the first answer would keep a withdrawn skill
 * on the menu for the rest of the run. The cost is one `check()` per skill per
 * iteration, paid only by agents that opted in.
 *
 * A skill is hidden when the checker returns anything other than `'allow'` /
 * `'gate_open'` (`readPermissionDecision`, the reader the tool gate uses too,
 * so `'ask'` or `{}` hides here and refuses there) — and when the checker
 * THROWS, which is the fail-closed half:
 * a policy that did not answer did not say yes, and the same sentence governs
 * the tool gate.
 */
export function hiddenSkillIdsNow(
  this: Pick<AgentContext, 'configuration' | 'governsSkillVisibility' | 'native'>,
): ((scope: object) => Promise<readonly string[]>) | undefined {
  if (!this.governsSkillVisibility()) return undefined;
  const checker = this.configuration.permissionChecker;
  const skillIds = this.configuration.injections
    .filter((i) => i.flavor === 'skill')
    .map((i) => i.id);
  if (!checker || skillIds.length === 0) return undefined;
  return async (scope: object): Promise<readonly string[]> => {
    // The caller of THIS run: the instance's caller on its own run, the
    // member's run (never the instance's last caller) on a mount.
    const run = this.native.runExecution().forScope(scope);
    const identity = run.own ? run.value.identity : memberIdentityIn(scope);
    const hidden: string[] = [];
    for (const id of skillIds) {
      let allowed = false;
      try {
        const decision = await checker.check({
          capability: 'skill_read',
          actor: 'agent',
          target: skillTarget(id),
          ...(identity !== undefined && { identity }),
        });
        // The one reader of a checker's answer — the same rule the tool gate uses.
        allowed = readPermissionDecision(decision).kind === 'allow';
      } catch {
        // Fail closed. The refusal the model would read is the dispatch
        // gate's job; here the only decision is whether to advertise a skill
        // whose policy is unreachable, and advertising it would be a menu
        // built on a question nobody answered.
        allowed = false;
      }
      if (!allowed) hidden.push(id);
    }
    return hidden;
  };
}
