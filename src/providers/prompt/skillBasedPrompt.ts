/**
 * skillBasedPrompt — PromptProvider that selects prompt fragments ("skills")
 * based on conversation context.
 *
 * A "skill" is a prompt fragment with a matcher function. On each turn the
 * provider evaluates all skills, selects the ones whose `match` returns true,
 * and composes them into a single system prompt.
 *
 * Usage:
 *   const prompt = skillBasedPrompt([
 *     { id: 'code', content: 'You write clean code.', match: (ctx) => ctx.message.includes('code') },
 *     { id: 'math', content: 'You solve math problems.', match: (ctx) => ctx.message.includes('math') },
 *   ], { base: 'You are a helpful assistant.' });
 */

import type { PromptProvider, PromptContext } from '../../core';

// ── Types ────────────────────────────────────────────────────

export interface Skill {
  /** Unique identifier for this skill. */
  readonly id: string;
  /** The prompt fragment to include when this skill matches. */
  readonly content: string;
  /** Returns true if this skill should be active for the given context. */
  readonly match: (ctx: PromptContext) => boolean;
}

export interface SkillBasedPromptOptions {
  /** Base prompt prepended before all selected skills. */
  readonly base?: string;
  /** Separator between prompt fragments. Defaults to '\n\n'. */
  readonly separator?: string;
  /** Fallback prompt when no skills match and no base is provided. */
  readonly fallback?: string;
}

// ── Factory ──────────────────────────────────────────────────

export function skillBasedPrompt(
  skills: readonly Skill[],
  options: SkillBasedPromptOptions = {},
): PromptProvider {
  const { base, separator = '\n\n', fallback = '' } = options;

  return {
    resolve: (ctx: PromptContext) => {
      const matched = skills.filter((s) => s.match(ctx));
      const parts: string[] = [];

      if (base) parts.push(base);
      for (const skill of matched) {
        parts.push(skill.content);
      }

      const value = parts.length === 0 ? fallback : parts.join(separator);
      const matchedIds = matched.map((s) => s.id);
      return {
        value,
        chosen: matchedIds.length > 0 ? `skills: ${matchedIds.join(', ')}` : 'fallback',
        rationale: matchedIds.length > 0 ? `${matchedIds.length} skills matched` : 'no skills matched',
      };
    },
  };
}
