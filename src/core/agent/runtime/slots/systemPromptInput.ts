import type { ActiveInjection } from '../../../../injection-engine/types.js';
import { withMemoryRecall } from '../../memoryRecallInjections.js';

/** Shared flat and grouped mount input for the system-prompt slot. */
export function systemPromptInput(
  parent: Readonly<Record<string, unknown>>,
  memoryIds: Parameters<typeof withMemoryRecall>[2],
  priorSystemSkillBodies: unknown,
) {
  return {
    userMessage: parent.userMessage as string | undefined,
    iteration: parent.iteration as number | undefined,
    // Seed committed the configured prompt. Runs without an override
    // preserve their earlier input shape.
    ...(parent.resolvedInstructions !== undefined && {
      instructions: parent.resolvedInstructions as string,
    }),
    ...(priorSystemSkillBodies !== undefined && {
      priorSystemSkillBodies,
      hiddenSkillIds: parent.hiddenSkillIds,
    }),
    activeInjections: withMemoryRecall(
      parent.activeInjections as readonly ActiveInjection[] | undefined,
      parent,
      memoryIds,
    ),
  };
}
