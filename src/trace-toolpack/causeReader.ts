import { attentionList, explain } from 'foottrace/cause';
import type { TraceCauseOperation, TraceCauseQuestion } from './causeTypes.js';
import type { CauseLimits } from './causeLimits.js';
import { snapshotCauseArtifacts } from './causeSnapshot.js';
import { causeGap, causeResponse } from './causeResponse.js';
import { causeContextAssessment, type CauseContext } from './causeContext.js';

/** One public query, one cache/deadline/total ceiling. No model, rerun, storage URL or second walker. */
export async function readCause(
  operation: TraceCauseOperation,
  context: CauseContext,
  question: TraceCauseQuestion,
  limits: CauseLimits,
  deadline: number,
  signal?: AbortSignal,
): Promise<string> {
  const assessed = causeContextAssessment(context);
  if (assessed.kind === 'invalid') return causeGap(operation, 'invalid-data');
  const snapshotOnly =
    context.kind === 'snapshot' && context.artifacts.cause === undefined ? true : undefined;
  const storedCapture = assessed.kind === 'stored' ? assessed.capture : undefined;
  const storage = assessed.kind === 'stored' ? assessed.admission.storage : undefined;
  if (signal?.aborted)
    return causeGap(
      operation,
      'cancelled',
      storedCapture ?? snapshotOnly,
      storage,
      limits.maxChars,
    );
  if (performance.now() >= deadline)
    return causeGap(operation, 'timeout', storedCapture ?? snapshotOnly, storage, limits.maxChars);
  const projection =
    context.kind === 'snapshot' && context.artifacts.cause === undefined
      ? snapshotCauseArtifacts(context.artifacts, context.nodes)
      : undefined;
  const source = context.kind === 'graph' ? context.cause : context.artifacts.cause ?? projection;
  if (source === 'truncated') return causeGap(operation, 'truncated', snapshotOnly);
  if (source === undefined) return causeGap(operation, 'not-collected', snapshotOnly);
  const capture =
    storedCapture ?? (projection && projection !== 'truncated' ? projection.capture : undefined);
  const remaining = Math.floor(deadline - performance.now());
  if (signal?.aborted) return causeGap(operation, 'cancelled', capture, storage, limits.maxChars);
  if (remaining < 1) return causeGap(operation, 'timeout', capture, storage, limits.maxChars);
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
      storage,
    );
  }
  // Each invocation projects one bounded query. Separate root/impact calls do not share a result yet.
  if (question.nodeId === undefined)
    return causeGap(operation, 'invalid-data', capture, storage, limits.maxChars);
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
      storage,
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
    storage,
  );
}
