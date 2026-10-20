/** The library's immutable findings frame: cacheable by default, not an app cache request. */
import { defineInstruction } from '../../../injection-engine/factories/defineInstruction.js';
import { FINDINGS_INSTRUCTION_ID, findingsInstructionFor } from './reserved.js';

export function findingsInstruction(contingent: boolean, quoteFacts: boolean) {
  const instruction = defineInstruction({
    id: FINDINGS_INSTRUCTION_ID,
    activeWhen: () => true,
    cache: 'always',
    prompt:
      findingsInstructionFor({ contingent }) +
      (quoteFacts
        ? '\nWhen answering, copy values exactly from the facts assertions or a served tool result. Treat evidenceRefs as unsettled, omitted entries as unknown, and collapsed results as tickets without data. Never invent a value.'
        : ''),
  });
  return Object.freeze({
    ...instruction,
    metadata: Object.freeze({
      ...instruction.metadata,
      cachePolicySource: 'default' as const,
    }),
  });
}
