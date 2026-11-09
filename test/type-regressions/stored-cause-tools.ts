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
  const prefix = result.cause.admission.native.closedPrefix;
  if (prefix) {
    const failed: 'failed' = prefix.boundary;
    void failed;
    // @ts-expect-error A saved failed prefix cannot be rewritten as a successful run.
    prefix.boundary = 'completed';
    // @ts-expect-error The exact selected invocation is immutable display evidence.
    prefix.selectedFailure.attemptId = 'different';
  }
  // @ts-expect-error Stored admission is a read-only assessment, not host-set authority.
  result.cause.admission.native.status = 'admitted';
  return callTraceTool(tools, 'attention_list');
}

void savedOnly;
