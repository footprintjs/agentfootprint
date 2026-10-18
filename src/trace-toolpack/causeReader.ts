import { attentionList, explain } from 'foottrace/cause';
import type { StageSnapshot } from 'footprintjs/advanced';
import type { TraceToolpackArtifacts } from './types.js';
import type { TraceCauseOperation, TraceCauseQuestion } from './causeTypes.js';
import type { causeLimits } from './causeLimits.js';
import { snapshotCauseArtifacts } from './causeSnapshot.js';
import { causeGap, causeResponse } from './causeResponse.js';

/** One public query, one cache/deadline/total ceiling. No model, rerun, storage URL or second walker. */
export async function readCause(
  operation: TraceCauseOperation,
  artifacts: TraceToolpackArtifacts,
  nodes: ReadonlyMap<string, StageSnapshot>,
  question: TraceCauseQuestion,
  limits: ReturnType<typeof causeLimits>,
  deadline: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) return causeGap(operation, 'cancelled');
  if (performance.now() >= deadline) return causeGap(operation, 'timeout');
  const source = artifacts.cause ?? snapshotCauseArtifacts(artifacts, nodes);
  if (source === undefined) return causeGap(operation, 'not-collected');
  const remaining = Math.floor(deadline - performance.now());
  if (signal?.aborted) return causeGap(operation, 'cancelled');
  if (remaining < 1) return causeGap(operation, 'timeout');
  const { maxChars, backward, impact, maxNodes, maxDepth, maxEdges, maxCalls } = limits;
  const options = { maxNodes, maxDepth, maxEdges, maxCalls, timeoutMs: remaining, signal };
  if (operation === 'attention_list') {
    const result = await attentionList(source.graph, {
      ...options,
      nodeIds: question.nodeIds ?? source.nodeIds,
    });
    // An empty legacy log has no node on which the reader could discover its missing capture.
    const finding =
      artifacts.cause === undefined && !result.gaps.some((gap) => gap.code === 'not-collected')
        ? {
            ...result,
            confidence: 'incomplete' as const,
            gaps: [...result.gaps, { code: 'not-collected' as const, evidence: [] }],
          }
        : result;
    return causeResponse(
      operation,
      finding,
      finding.confidence === 'incomplete'
        ? 'Not sure, because coverage is incomplete. An absent mark is not proof of a healthy or reached step.'
        : 'Recorded attention within this query only. Cite the returned node and evidence IDs.',
      maxChars,
    );
  }
  // Both tools project the SAME bounded query, rather than independently spending two budgets.
  if (question.nodeId === undefined) return causeGap(operation, 'invalid-data');
  const finding = await explain(source.graph, question.nodeId, { ...options, backward, impact });
  if (operation === 'impact') {
    return causeResponse(
      operation,
      finding.impact,
      finding.impact.confidence === 'incomplete'
        ? 'Not sure of the full impact, because the returned gaps limit the recorded forward slice.'
        : 'Recorded reachable impact only; this does not prove effects in unrecorded services or unreached branches.',
      maxChars,
    );
  }
  return causeResponse(
    operation,
    finding,
    finding.rootCause !== undefined
      ? 'A unique recorded dependency root is supported. Cite its node ID and path; this is not proof of a provider-internal physical cause.'
      : finding.confidence === 'incomplete'
      ? 'Not sure, because the returned gaps prevent a unique supported root. Alternatives are not confirmed causes.'
      : 'No unique marked root in the checked graph. Cite alternatives without selecting one as fact.',
    maxChars,
  );
}
