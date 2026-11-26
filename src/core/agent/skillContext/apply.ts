/**
 * Where the skill-context decision takes effect, at configuration time.
 *
 * Under `listed`, a skill that `read_skill` activates (trigger
 * `llm-activated`) and that has a body is served with `surfaceMode:
 * 'tool-only'`: the body is that call's result and the system slot leaves it
 * out (`core/slots/buildSystemPromptSlot.ts`, `injection-engine/
 * skillToolDescriptors.ts` · `resolveReadSkillDescriptor`), so the system
 * prompt does not change when it loads. The other three effects read
 * `configuration.skillContext` where they happen: the registry lists every
 * scoped tool (`buildToolRegistry` · `listedScopedTools`), the `read_skill`
 * description stays the catalog (`runtime/skills/owner.ts` ·
 * `readSkillOfferFor`), and a call to a scoped tool whose skill is not active
 * is refused (`stages/toolCalls/execution/callStart.ts`).
 *
 * A skill the GRAPH activates (a route target, an entry, a tree leaf) has no
 * `read_skill` result to carry its body, so its body keeps the channel it
 * declared: the system prompt from the first request it is active on.
 */
import type { Injection } from '../../../injection-engine/types.js';
import {
  decideSkillContext,
  type SkillContextDecision,
  type SkillContextInputs,
} from './decide.js';

/** The skills `listed` serves through the `read_skill` result. */
function servedByRead(injection: Injection): boolean {
  return (
    injection.flavor === 'skill' &&
    injection.trigger.kind === 'llm-activated' &&
    (injection.inject.systemPrompt ?? '').length > 0
  );
}

/** The final injection list under `listed`: each read-activated body travels as its `read_skill` result. */
export function listedInjections(injections: readonly Injection[]): readonly Injection[] {
  return injections.map((injection) =>
    injection.flavor !== 'skill'
      ? injection
      : {
          ...injection,
          // `skillContext` lets the `read_skill` description say where a body goes.
          metadata: Object.freeze({
            ...injection.metadata,
            skillContext: 'listed',
            ...(servedByRead(injection) && { surfaceMode: 'tool-only' }),
          }),
        },
  );
}

/**
 * Decide, keep the decision on the configuration, and apply the body channel.
 * An agent with no skill keeps `skillContext` undefined and its list untouched.
 */
export function applySkillContext(
  config: { injections: readonly Injection[]; skillContext?: SkillContextDecision },
  provider: SkillContextInputs['provider'],
  model: string,
  stated: unknown,
  brains: SkillContextInputs['brains'],
): void {
  const decision = decideSkillContext({
    provider,
    model,
    stated,
    ...(brains !== undefined && { brains }),
    injections: config.injections,
  });
  config.skillContext = decision;
  if (decision?.strategy === 'listed') config.injections = listedInjections(config.injections);
}
