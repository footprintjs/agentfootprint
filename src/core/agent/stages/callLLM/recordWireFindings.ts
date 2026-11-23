import type { TypedScope } from 'footprintjs';
import { wireViolationsOf } from '../../../../integrity/invariant-violation/wire.js';
import type { LLMRequest, LLMResponse } from '../../../../provider-contract/types.js';
import { fileIntegrityFindings } from '../../integrityFindings.js';
import type { AgentState } from '../../types.js';
import type { CallLLMStageDeps } from './types.js';

export function recordWireFindings(
  scope: TypedScope<AgentState>,
  llmRequest: LLMRequest,
  response: LLMResponse,
  provider: string,
  iteration: number,
  ledger: CallLLMStageDeps['integrityLedger'],
): void {
  // THE WIRE SEAM (9.60.0). The compose backstop reads the merged frame;
  // this reads what the ADAPTER says actually crossed — the manifest read
  // back from the serialized body — against the schemas this very call
  // assembled. The recorded defect lived exactly in that gap: a clean
  // frame, four retained schemas on the wire. No manifest stated → the
  // call is incomparable and nothing is guessed. Same seen-list rail as
  // the compose backstop, freshest copy first, so one defect files once
  // per run however many calls re-detect it.
  // The composed side is llmRequest — the exact object HANDED TO the
  // adapter, after the cache strategy's transform — so a strategy edit
  // is never blamed on the adapter.
  const wireFindings = wireViolationsOf(
    {
      names: (llmRequest.tools ?? []).map((t) => t.name),
      provenance: 'callLLM (assembled request)',
    },
    response.wireManifest === undefined
      ? undefined
      : { names: response.wireManifest.toolNames, provenance: provider },
    iteration,
  );
  // The disposition: a provider stating no manifest leaves this call
  // UNREACHABLE — the check could not see the wire, which is a different
  // fact from "the wire was clean", and the ledger keeps them apart.
  ledger?.current?.note(
    'invariant-violation',
    'wire',
    response.wireManifest === undefined
      ? 'unreachable'
      : wireFindings.length > 0
      ? 'checked-fail'
      : 'checked-pass',
    wireFindings.length > 0 ? Date.now() : undefined,
  );
  fileIntegrityFindings(scope, wireFindings, iteration, ledger);
}
