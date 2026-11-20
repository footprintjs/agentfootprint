import type { SourceLinkRow } from 'foottrace/cause';
import type { TypedScope } from 'footprintjs';
import type { ArtifactMeta } from '../../../../../artifacts/types.js';
import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import {
  coverageInForce,
  privateFieldsInForce,
  runKeepsOut,
} from '../../../../../redaction/runRedaction.js';
import { statePointer } from '../../../assessment/pointer.js';
import { carriesPlacedTicket } from '../../../placedTickets.js';
import { appendSourceLinkWitnesses, sourceLinkInputFor } from '../../../sourceLinkWitness.js';
import type { AgentState } from '../../../types.js';
import type { DispatchCall } from '../contracts/batchCall.js';

const outputKey = 'llmLatestToolCalls';

/** Keep the successful read in the ToolCalls execution that made it. */
export function captureArtifactRedemption(
  scope: TypedScope<AgentState>,
  frame: {
    readonly runId: string | undefined;
    readonly tc: DispatchCall;
    readonly callIndex: number;
    readonly proposedArgs: DispatchCall['args'] | undefined;
    readonly history: readonly { readonly role: string; readonly content: string }[];
  },
) {
  const { runId, tc, callIndex, proposedArgs } = frame;
  if (
    runId === undefined ||
    proposedArgs === undefined ||
    !('sourceLinkConsumer' in scope) ||
    coverageInForce(scope).state !== 'declared-none' ||
    privateFieldsInForce(scope) !== undefined ||
    runKeepsOut(scope, outputKey) ||
    runKeepsOut(scope, 'history') ||
    runKeepsOut(scope, 'placedTickets') ||
    typeof readCallOccurrenceKey(tc) !== 'string' ||
    tc.callOccurrenceKey?.[4] !== callIndex
  )
    return undefined;
  const consumer = scope.sourceLinkConsumer;
  if (consumer?.runId !== runId || consumer.historyPositions.length === 0) return undefined;

  const refs = new Map<string, string>();
  return {
    recordRef(argName: string, ref: string) {
      // The original accepted proposal must contain the string the resolver used.
      if (Object.getOwnPropertyDescriptor(proposedArgs, argName)?.value === ref)
        refs.set(argName, ref);
    },
    commit(wanted: Readonly<Record<string, ArtifactMeta>> | undefined) {
      if (refs.size === 0 || wanted === undefined) return;
      const receipts = scope.placedTickets ?? [];
      const rows: SourceLinkRow[] = [];
      for (const [argName, ref] of refs) {
        const meta = wanted[argName];
        if (meta?.ref !== ref || meta.origin?.runId !== runId) continue;
        const matching = receipts.filter((ticket) => ticket.ref === ref);
        const receipt = matching.length === 1 ? matching[0] : undefined;
        const occurrence = receipt === undefined ? undefined : readCallOccurrenceKey(receipt);
        if (typeof occurrence !== 'string') continue;
        const input = sourceLinkInputFor(consumer, occurrence);
        if (
          input === undefined ||
          !carriesPlacedTicket(frame.history[input.element], occurrence, ref)
        )
          continue;
        const pointer = statePointer(outputKey, 'args', argName);
        if (pointer.kind !== 'state') continue;
        rows.push({
          kind: 'source-link',
          version: 1,
          linkBasis: 'reference',
          check: 'redeemed',
          consumer: consumer.consumer,
          output: { key: outputKey, checkedIn: 'read', element: callIndex, pointer: pointer.path },
          input,
        });
      }
      appendSourceLinkWitnesses(scope, rows);
    },
  };
}
