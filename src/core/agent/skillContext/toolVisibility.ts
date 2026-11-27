import type { ToolClaim } from '../buildToolRegistry.js';
import type { Tool } from '../../../tools/tools.js';

/** A live role view can explicitly lack an answer. An absent override uses the stage view. */
export interface SkillRoleView {
  readonly hiddenSkillIds: readonly string[] | undefined;
}

/** A visible skill claim needs a known role view. Other channels have their own admission. */
export function roleVisibleClaim(
  claim: ToolClaim,
  hidden: ReadonlySet<string> | undefined,
): boolean {
  return (
    claim.channel !== 'skill' ||
    (claim.id !== undefined && hidden !== undefined && !hidden.has(claim.id))
  );
}

/** One role judgement for the registered implementation's actual claims. */
export function roleVisibleImplementation(
  tool: Tool,
  claims: readonly ToolClaim[],
  hidden: ReadonlySet<string> | undefined,
): boolean {
  return claims.some((claim) => claim.tool === tool && roleVisibleClaim(claim, hidden));
}

export function hasSkillClaim(tool: Tool, claims: readonly ToolClaim[]): boolean {
  return claims.some((claim) => claim.tool === tool && claim.channel === 'skill');
}
