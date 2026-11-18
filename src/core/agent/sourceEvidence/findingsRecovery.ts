import type { ToolParty } from '../../../tools/toolParty.js';
import { SOURCE_EVIDENCE_KIND } from '../../../artifacts/sourceEvidence/guards.js';

/** Recovery changes no admission: an artifact ref or stale ID never becomes a findings witness. */
export function withSourceFindingsRecovery(
  refusal: string | undefined,
  offered: ReadonlyMap<string, ToolParty | null> | undefined,
): string | undefined {
  if (refusal === undefined) return undefined;
  const readersOffered = ['find_source_evidence', 'read_source_evidence'].every(
    (name) => offered?.get(name)?.channel === 'registry',
  );
  const original = JSON.parse(refusal) as Record<string, unknown>;
  return JSON.stringify({
    ...original,
    instruction:
      'No tool was invoked for this refused proposal. Retry the intended call with unavailable previous entries omitted; findings references identify executed tool results in the request, not stored artifact receipts.',
    recovery: {
      retry: { previous: 'omit-unavailable-entries' },
      currentReferences: {
        source: 'current-request',
        kind: 'executed-tool_result-id',
        artifactRefs: false,
      },
      ...(readersOffered && {
        retainedSource: {
          when: 'tools-offered',
          find: {
            tool: 'find_source_evidence',
            query: 'exact-declared-subject-operation-scope',
            unknownFilters: 'omit',
          },
          read: {
            tool: 'read_source_evidence',
            refFrom: 'find_source_evidence.candidates[].ref',
            refKind: SOURCE_EVIDENCE_KIND,
          },
          refresh: 'never-automatic',
        },
      }),
    },
  });
}
