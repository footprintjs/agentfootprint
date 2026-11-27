import type { ToolExecutionContext } from './tools.js';

/** Private execution-time access for the library's skill-list adapter. */
interface SkillListingAccess {
  readonly hiddenIdsFor?: (
    ids: readonly string[],
    signal: AbortSignal | undefined,
  ) => Promise<readonly string[]>;
  record(ids: readonly string[], text: string): void;
}

const access = Symbol('agentfootprint.skillListingAccess');

export function bindSkillListingAccess(value: SkillListingAccess): object {
  return { [access]: value };
}

export function skillListingAccess(
  context: ToolExecutionContext | undefined,
): SkillListingAccess | undefined {
  return (context as (ToolExecutionContext & { [access]?: SkillListingAccess }) | undefined)?.[
    access
  ];
}
