import { evaluateWithSkillDecision } from '../../injection-engine/evaluator.js';
import type { Injection, InjectionContext } from '../../injection-engine/types.js';
import type { Tool } from '../../tools/tools.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';
import type { ServedToolParties } from './commitServedTools.js';
import { providerOmissions } from './providerOmissions.js';

/** A build-time registration cannot prove a tool still belongs to this injection.
 * Compare the original callable objects without evaluating a schema or accessor. */
function stillRegistered(skill: Injection, registered: readonly Tool[]): boolean {
  try {
    const content = Object.getOwnPropertyDescriptor(skill, 'inject')?.value;
    if (!content || typeof content !== 'object') return false;
    const tools = Object.getOwnPropertyDescriptor(content, 'tools')?.value;
    if (
      !Array.isArray(tools) ||
      Object.getOwnPropertyDescriptor(tools, 'length')?.value !== registered.length
    )
      return false;
    return registered.every(
      (tool, index) => Object.getOwnPropertyDescriptor(tools, index)?.value === tool,
    );
  } catch {
    return false;
  }
}

/** Evaluate owns the decision. The component keeps callable objects private
 * until Compose and the accepted model request can attest to their omission. */
export function evaluateForToolSelection(
  owner: ServedToolParties,
  injections: readonly Injection[],
  ctx: InjectionContext,
  registrations: ReadonlyMap<Injection, readonly Tool[]>,
  claimants: ReadonlyMap<string, readonly ToolClaim[]>,
  hidden: readonly string[] | undefined,
) {
  delete owner.inactiveSkills;
  let collector: ReturnType<typeof providerOmissions> | undefined;
  const result = evaluateWithSkillDecision(injections, ctx, (skill) => {
    const tools = registrations.get(skill);
    if (!tools || hidden === undefined || !stillRegistered(skill, tools)) return;
    collector ??= providerOmissions(claimants, hidden);
    collector.observe({ kind: 'skill-scope', skillId: skill.id, tools });
  });
  const value = collector?.result();
  if (value) owner.inactiveSkills = { iteration: ctx.iteration, value };
  return result;
}
