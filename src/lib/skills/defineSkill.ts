/**
 * defineSkill — type-narrowing factory for a `Skill<TDecision>`.
 *
 * Mirrors `defineInstruction()` — a pure passthrough that gives
 * callers crisp inference for `TDecision` in downstream predicates
 * (`activeWhen(d) => ...` types `d` as `TDecision`).
 */
import type { Skill } from './types';

export function defineSkill<TDecision = unknown>(skill: Skill<TDecision>): Skill<TDecision> {
  // Dev-mode: warn on empty description (panel #3: descriptions ≤200 chars
  // are load-bearing for classification; empty strings are almost certainly
  // a bug).
  if (
    typeof process !== 'undefined' &&
    process.env?.['NODE_ENV'] !== 'production' &&
    skill.description.trim().length === 0
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[agentfootprint] defineSkill('${skill.id}'): empty description — the model classifies skills by description, an empty one will never be picked.`,
    );
  }
  return skill;
}
