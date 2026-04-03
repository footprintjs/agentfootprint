/**
 * templatePrompt — PromptProvider that interpolates {{variables}} from context.
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
      const value = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = allVars[key];
        return val !== undefined ? String(val) : `{{${key}}}`;
      });
      return { value, chosen: 'template' };
    },
  };
}
