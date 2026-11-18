import type { Injection } from '../../../../injection-engine/types.js';

/**
 * Refuse an `llm-activated` trigger whose `viaToolName` is not `'read_skill'` (8.7.0).
 *
 * `viaToolName` reads as a promise the library never kept: name a tool, and that tool
 * activates the skill. No such tool has ever been created. The one consumer of an
 * `llm-activated` trigger is the evaluator, which matches on
 * `ctx.activatedInjectionIds.includes(inj.id)` and never looks at the field
 * (`evaluator.ts`); the only writer of that array is `read_skill`. So a skill carrying
 * `viaToolName: 'open_playbook'` activated by `read_skill` exactly like every other
 * skill, and the declaration meant nothing at all — a configuration that was never
 * read is worse than one that is refused, because it looks like it worked.
 *
 * Refused HERE because `injection()` is the one funnel every flavor passes through:
 * `defineSkill`, `skillsFromDir`, `.skill()`, `.skills(registry)`, `.skillGraph()`
 * and a hand-built Injection all arrive at this line.
 *
 * 9.0.0 removed the `viaToolName` OPTION from `defineSkill` and `skillsFromDir`
 * (both now refuse it by name at the factory), but the TRIGGER field stays and so
 * does this check: a hand-built `Injection` literal can still carry an
 * `llm-activated` trigger with any string in it, and that is the one path with no
 * factory in front of it.
 */
function assertReadSkillActivation(injection: Injection): void {
  const trigger = injection.trigger;
  if (trigger.kind !== 'llm-activated') return;
  if (trigger.viaToolName === 'read_skill') return;
  throw new Error(
    `Agent.injection('${injection.id}'): viaToolName is '${trigger.viaToolName}', but ` +
      `'read_skill' is the only activation tool this library builds — nothing reads the field, ` +
      `and no tool named '${trigger.viaToolName}' is ever offered to the model. This skill would ` +
      `have activated through read_skill like every other one, so the name was decoration on a ` +
      `door that does not exist. Drop \`viaToolName\` (skills already share one activation tool ` +
      `and the model picks WHICH skill by id), or gate the skill on something the engine does ` +
      `read — a \`rule\` trigger, or a skillGraph() edge. The \`viaToolName\` OPTION on ` +
      `defineSkill()/skillsFromDir() was removed in 9.0.0; this trigger field is all that ` +
      `is left, and only a hand-built Injection can still set it.`,
  );
}

export { assertReadSkillActivation };
