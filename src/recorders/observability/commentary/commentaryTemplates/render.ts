/**
 * Render a template by substituting `{{name}}` placeholders from the
 * vars bag. Missing keys render as empty string — keeps prose
 * forgiving when an optional field isn't present.
 *
 * Non-recursive: a substituted value is NOT itself processed for
 * placeholders. Compose sub-templates upstream (see
 * `extractCommentaryVars`).
 */
export function renderCommentary(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '');
}
