/**
 * Where the skill-context decision takes effect, at configuration time.
 *
 * Under `listed` a body `read_skill` loads is that call's result and the
 * system slot leaves it out while the result is in the history (see
 * `listedInjections`), so the system prompt does not change when a skill
 * loads. The other effects read
 * `configuration.skillContext` where they happen: the registry lists every
 * scoped tool (`buildToolRegistry` · `listedScopedTools`), the `read_skill`
 * description stays the catalog (`runtime/skills/owner.ts` ·
 * `readSkillOfferFor`), and a call to a scoped tool whose skill is not active
 * is refused (`stages/toolCalls/execution/callStart.ts`).
 *
 * A skill the GRAPH activates without a `read_skill` call (an entry, a tree
 * leaf, a declared edge) has no result to carry its body: it keeps the channel
 * it declared, the system prompt from the first request it is active on.
 */
import type { Injection } from '../../../injection-engine/types.js';
import type { ResolvedEvidenceGate } from '../evidence/types.js';
import { skillBodiesOf } from './bodies.js';
import {
  decideSkillContext,
  type SkillContextDecision,
  type SkillContextInputs,
} from './decide.js';

/**
 * The final injection list under `listed`: every skill is stamped
 * `metadata.skillContext: 'listed'`. Two readers act on it: `read_skill`
 * returns the body of any skill it loads, a graph target's included
 * (`skillToolDescriptors.ts`), and the projection serves a body `tool-only`
 * exactly while that result is in the history this request sends
 * (`injection-engine/skillContext.ts` · `servedSurfaceMode`); without it, the skill's own
 * declaration (the system prompt by default), so a body is never lost.
 */
export function listedInjections(injections: readonly Injection[]): readonly Injection[] {
  return injections.map((injection) =>
    injection.flavor !== 'skill'
      ? injection
      : {
          ...injection,
          metadata: Object.freeze({ ...injection.metadata, skillContext: 'listed' }),
        },
  );
}

/**
 * Decide, keep the decision on the configuration, and apply the body channel.
 * An agent with no skill keeps `skillContext` undefined and its list untouched.
 */
export function applySkillContext(
  config: {
    injections: readonly Injection[];
    skillContext?: SkillContextDecision;
    evidenceGate?: ResolvedEvidenceGate;
  },
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
  if (decision?.strategy !== 'listed') return;
  config.injections = listedInjections(config.injections);
  // The evidence gate reads a body result as the app's text (`honestyView.ts`).
  if (config.evidenceGate !== undefined)
    config.evidenceGate = { ...config.evidenceGate, skillBodies: skillBodiesOf(config.injections) };
}
