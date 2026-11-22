import type { AssessmentToolWords } from './types.js';

const ATTRIBUTION: Readonly<Record<AssessmentToolWords['entries'][number]['kind'], string>> = {
  notChecked: 'did not check',
  cannotCover: 'cannot cover',
  tryInstead: 'suggested',
};

/** Append only the tool's admitted words, with the declaration attached to its reason. */
export function declaredStandingClause(
  clause: string,
  namedClause: (displayName: string) => string,
  words: AssessmentToolWords,
  displayNames: ReadonlyMap<string, string>,
): string {
  // A declaration retains its writer even when the result leaves the history window.
  const sharedTool = words.entries[0]?.toolName;
  const oneTool = words.entries.every(({ toolName }) => toolName === sharedTool);
  const name = oneTool && sharedTool !== undefined ? displayNames.get(sharedTool) : undefined;
  const fragments = words.entries.map(({ kind, text, toolName }) => {
    const display = toolName === undefined ? undefined : displayNames.get(toolName);
    const actor = oneTool ? '' : `${display ?? 'a tool'} `;
    return `${actor}${ATTRIBUTION[kind]} “${text}”`;
  });
  if (words.omitted > 0) fragments.push(`${words.omitted} more in the run record`);
  return `${name === undefined ? clause : namedClause(name)} (${fragments.join('; ')})`;
}
