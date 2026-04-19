/**
 * renderSkillBody — produce the tool-result text the model reads when
 * it calls `read_skill({ id })`.
 *
 * Panel #4 (Anthropic prompt engineer) specified the format:
 *   - First line is a recency anchor: "You are now following skill: X"
 *   - No "tools available" prose — tool availability is wired via
 *     activeWhen + AgentInstruction.tools, advertising it in text
 *     leads to hallucinated calls for unavailable tools.
 *   - Everything imperative, framed around the model.
 *   - `steps` as a numbered list (survives attention drift better
 *     than a paragraph).
 *
 * Panel #8 (security): escape `</memory>` AND `</tool_use>` in any
 * user-controlled field (title, description, steps, prompt) to prevent
 * tag-escape prompt injection.
 */
import type { Skill } from './types';

const TAG_REGEX = /<\/(memory|tool_use|skill)>/gi;

function escape(text: string): string {
  return text.replace(TAG_REGEX, (m) => `</m\u200D${m.slice(3)}`);
}

export function renderSkillBody<T>(skill: Skill<T>): string {
  const lines: string[] = [];
  lines.push(`You are now following skill: ${skill.id} (v${skill.version}).`);
  lines.push('');
  lines.push(`Title: ${escape(skill.title)}`);
  lines.push(`Purpose: ${escape(skill.description)}`);

  if (skill.steps && skill.steps.length > 0) {
    lines.push('');
    lines.push('Procedure:');
    for (let i = 0; i < skill.steps.length; i++) {
      lines.push(`${i + 1}. ${escape(skill.steps[i])}`);
    }
  }

  if (skill.prompt) {
    lines.push('');
    lines.push(`Guidance: ${escape(skill.prompt)}`);
  }

  return lines.join('\n');
}

/** Resolve the body override — string, async loader, or default render. */
export async function resolveSkillBody<T>(skill: Skill<T>): Promise<string> {
  if (typeof skill.body === 'string') return skill.body;
  if (typeof skill.body === 'function') {
    const result = skill.body();
    return result instanceof Promise ? await result : result;
  }
  return renderSkillBody(skill);
}
