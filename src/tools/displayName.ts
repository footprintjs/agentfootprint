/** One-job session/key or validation owner; canonical exports remain with its facade. */
import { displayNameProblem } from '../lib/displayName.js';
/**
 * Refuse a `displayName` a person should not read, at definition time — the
 * rule (`lib/displayName.ts` · `displayNameProblem`) asked for a tool built by
 * `defineTool` and, at registration, for one assembled by hand.
 */
export function assertDisplayName(toolName: string, displayName: unknown): void {
  if (displayName === undefined) return;
  const problem = displayNameProblem(`defineTool('${toolName}'): \`displayName\``, displayName);
  if (problem !== undefined) throw new Error(problem);
}
