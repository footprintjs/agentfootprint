import { attentionList, explain } from 'foottrace/cause';
import type { StageSnapshot } from 'footprintjs/advanced';
import type { TraceToolpackArtifacts } from './types.js';
import type { TraceCauseOperation, TraceCauseQuestion } from './causeTypes.js';
import type { CauseLimits } from './causeLimits.js';
import { snapshotCauseArtifacts } from './causeSnapshot.js';
import { causeGap, causeResponse } from './causeResponse.js';

/** One public query, one cache/deadline/total ceiling. No model, rerun, storage URL or second walker. */
export async function readCause(
  operation: TraceCauseOperation,
  artifacts: TraceToolpackArtifacts,
  nodes: ReadonlyMap<string, StageSnapshot>,
  question: TraceCauseQuestion,
  limits: CauseLimits,
  deadline: number,
  signal?: AbortSignal,
): Promise<string> {
  const snapshotOnly = artifacts.cause === undefined ? true : undefined;
  if (signal?.aborted) return causeGap(operation, 'cancelled', snapshotOnly);
  if (performance.now() >= deadline) return causeGap(operation, 'timeout', snapshotOnly);
  const projection =
    artifacts.cause === undefined ? snapshotCauseArtifacts(artifacts, nodes) : undefined;
  const source = artifacts.cause ?? projection;
  if (source === 'truncated') return causeGap(operation, 'truncated', snapshotOnly);
  if (source === undefined) return causeGap(operation, 'not-collected', snapshotOnly);
  const capture = projection && projection !== 'truncated' ? projection.capture : undefined;
  const remaining = Math.floor(deadline - performance.now());
  if (signal?.aborted) return causeGap(operation, 'cancelled', capture);
  if (remaining < 1) return causeGap(operation, 'timeout', capture);
  const { maxChars, backward, impact, maxNodes, maxDepth, maxEdges, maxCalls } = limits;
  const options = { maxNodes, maxDepth, maxEdges, maxCalls, timeoutMs: remaining, signal };
  if (operation === 'attention_list') {
    const result = await attentionList(source.graph, {
      ...options,
      nodeIds: question.nodeIds ?? source.nodeIds,
    });
    // An empty legacy log has no node on which the reader could discover its missing capture.
    const finding =
      capture?.status === 'incomplete' && !result.gaps.some((gap) => gap.code === 'not-collected')
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
      capture,
    );
  }
  // Each invocation projects one bounded query. Separate root/impact calls do not share a result yet.
  if (question.nodeId === undefined) return causeGap(operation, 'invalid-data', capture);
  const finding = await explain(source.graph, question.nodeId, { ...options, backward, impact });
  if (operation === 'impact') {
    return causeResponse(
      operation,
      finding.impact,
      finding.impact.confidence === 'incomplete'
        ? 'Not sure of the full impact, because the returned gaps limit the recorded forward slice.'
        : 'Recorded reachable impact only; this does not prove effects in unrecorded services or unreached branches.',
      maxChars,
      capture,
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
    capture,
  );
}
