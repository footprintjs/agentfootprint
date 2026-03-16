/**
 * templatePrompt — PromptProvider that interpolates {{variables}} from context.
 *
 * **Syntax:** `{{variableName}}` only. Flat key replacement — no conditionals,
 * no nesting, no dot-paths (`{{user.name}}` won't work). This is intentionally
 * simple. For complex prompt assembly, implement `PromptProvider` directly.
 *
 * Unknown placeholders are preserved as-is (e.g. `{{unknown}}` stays `{{unknown}}`).
 *
 * Variable resolution order (last wins):
 *   1. PromptContext fields (message, turnNumber)
 *   2. Explicit vars passed to templatePrompt()
 *
 * Usage:
 *   agentLoop().promptProvider(templatePrompt(
 *     'You are {{role}}. The user has sent {{turnNumber}} messages.',
 *     { role: 'a code reviewer' },
 *   ))
 */

import type { PromptProvider, PromptContext } from '../../core';

export function templatePrompt(
  template: string,
  vars: Record<string, string | number> = {},
): PromptProvider {
  return {
    resolve: (ctx: PromptContext) => {
      const allVars: Record<string, string | number> = {
        message: ctx.message,
        turnNumber: ctx.turnNumber,
        ...vars,
      };
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = allVars[key];
        return val !== undefined ? String(val) : `{{${key}}}`;
      });
    },
  };
}
