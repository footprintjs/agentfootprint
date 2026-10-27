import {
  callTraceTool,
  readStoredCauseArtifacts,
  traceCauseTools,
  type TraceCauseArtifacts,
} from '../../src/doors/observe.js';

/** A saved-only consumer needs no RuntimeSnapshot, bag assertion or custom graph. */
async function savedOnly(entries: Iterable<unknown>, runId: string): Promise<string> {
  const result = await readStoredCauseArtifacts(entries, { runId });
  if (result.status === 'unknown') {
    // @ts-expect-error An unknown result cannot be mounted as captured proof.
    const unproven: TraceCauseArtifacts = result.cause;
    void unproven;
    return result.reason;
  }
  const tools = traceCauseTools(result.cause, { maxNodes: 40, backward: { maxNodes: 32 } });
  // @ts-expect-error Stored admission is a read-only assessment, not host-set authority.
  result.cause.admission.native.status = 'admitted';
  return callTraceTool(tools, 'attention_list');
}

void savedOnly;
