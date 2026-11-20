import type { SourceLinkRow } from 'foottrace/cause';
import type { TypedScope } from 'footprintjs';
import type { ArtifactMeta } from '../../../../../artifacts/types.js';
import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import {
  canRecordSourceLinkPath,
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
    typeof readCallOccurrenceKey(tc) !== 'string' ||
    tc.callOccurrenceKey?.[4] !== callIndex
  )
    return undefined;
  const consumer = scope.sourceLinkConsumer;
  if (consumer?.runId !== runId) return undefined;
  const historyProtected = consumer.historyProtected === true;
  if (
    !historyProtected &&
    (coverageInForce(scope).state !== 'declared-none' ||
      privateFieldsInForce(scope) !== undefined ||
      runKeepsOut(scope, outputKey) ||
      runKeepsOut(scope, 'history') ||
      runKeepsOut(scope, 'placedTickets') ||
      (consumer.historyPositions.length === 0 && consumer.bounded !== true))
  )
    return undefined;

  const permitsOutput = (argName: string) =>
    canRecordSourceLinkPath(scope, [outputKey, String(callIndex), 'args', argName]);
  const refs = new Map<string, string>();
  return {
    recordRef(argName: string, ref: string) {
      // The original accepted proposal must contain the string the resolver used.
      if (
        permitsOutput(argName) &&
        Object.getOwnPropertyDescriptor(proposedArgs, argName)?.value === ref
      )
        refs.set(argName, ref);
    },
    commit(wanted: Readonly<Record<string, ArtifactMeta>> | undefined) {
      if (refs.size === 0 || wanted === undefined) return;
      const receipts = historyProtected ? undefined : scope.placedTickets ?? [];
      const rows: SourceLinkRow[] = [];
      for (const [argName, ref] of refs) {
        const meta = wanted[argName];
        if (meta?.ref !== ref || !permitsOutput(argName)) continue;
        const pointer = statePointer(outputKey, 'args', argName);
        if (pointer.kind !== 'state') continue;
        const row: SourceLinkRow = {
          kind: 'source-link',
          version: 1,
          linkBasis: 'reference',
          check: 'redeemed',
          consumer: consumer.consumer,
          output: { key: outputKey, checkedIn: 'read', element: callIndex, pointer: pointer.path },
        };
        // The successful redemption is already public. Omit the protected input
        // without consulting its receipt, origin, or history.
        if (receipts === undefined) {
          rows.push({ ...row, leafWithheld: true });
          continue;
        }
        if (meta.origin?.runId !== runId) continue;
        const matching = receipts.filter((ticket) => ticket.ref === ref);
        const receipt = matching.length === 1 ? matching[0] : undefined;
        const occurrence = receipt === undefined ? undefined : readCallOccurrenceKey(receipt);
        if (typeof occurrence !== 'string') continue;
        const input = sourceLinkInputFor(consumer, occurrence);
        if (input === undefined) {
          // After the positions cap, the index cannot settle a missing source.
          if (consumer.bounded === true) rows.push({ ...row, bounded: true });
          continue;
        }
        if (!carriesPlacedTicket(frame.history[input.element], occurrence, ref)) continue;
        rows.push({ ...row, input });
      }
      appendSourceLinkWitnesses(scope, rows);
    },
  };
}
