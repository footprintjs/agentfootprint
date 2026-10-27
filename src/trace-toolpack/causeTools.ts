import type { StageSnapshot } from 'footprintjs/advanced';
import { defineTool, type Tool } from '../tools/tools.js';
import type { TraceToolpackArtifacts } from './types.js';
import type {
  TraceCauseArtifacts,
  TraceCauseOperation,
  TraceCauseOptions,
  TraceCauseQuestion,
} from './causeTypes.js';
import { causeLimits, type CauseLimits } from './causeLimits.js';
import { causeGap } from './causeResponse.js';
import { loadCauseReader } from './causeLoad.js';
import { causeContextAssessment, type CauseContext } from './causeContext.js';

const nodeId = {
  type: 'string',
  minLength: 1,
  maxLength: 2048,
  description:
    'An opaque node ID returned by attention_list in THIS artifact scope, not an outer/inner stage ID.',
};
const nodeQuestion = {
  type: 'object',
  properties: { nodeId },
  required: ['nodeId'],
  additionalProperties: false,
};
const CAUSE_OPERATIONS: Record<
  TraceCauseOperation,
  Pick<Tool['schema'], 'description' | 'inputSchema'>
> = {
  attention_list: {
    description:
      'Find recorded abnormal nodes and proof IDs in this authorized graph, bounded and read-only. Start here; missing capture is unknown, never healthy.',
    inputSchema: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: nodeId, maxItems: 100 } },
      additionalProperties: false,
    },
  },
  root_cause: {
    description:
      'Explain one recorded node using public Foottrace cause analysis. Cite root/path/evidence IDs. Gaps mean not sure; alternatives are not proven roots. No provider internals are inferred.',
    inputSchema: nodeQuestion,
  },
  impact: {
    description:
      'Read the recorded forward impact of one node, with explicit gaps. Uses one bounded Foottrace query; it never reruns business work.',
    inputSchema: nodeQuestion,
  },
};

/** Model questions select IDs only. The host owns all resource controls. */
export function buildCauseTools(
  artifacts: TraceToolpackArtifacts,
  nodes: ReadonlyMap<string, StageSnapshot>,
  options?: TraceCauseOptions,
): Tool[] {
  return toolsForContext({ kind: 'snapshot', artifacts, nodes }, options);
}

/**
 * Serve the three read-only cause questions over one host-authorized graph.
 * Saved evidence must be the exact object returned by `readStoredCauseArtifacts`;
 * copied display assessments do not grant saved-history authority.
 * No snapshot is indexed, no storage is fetched and no business work is rerun.
 */
export function traceCauseTools(cause: TraceCauseArtifacts, options?: TraceCauseOptions): Tool[] {
  return toolsForContext({ kind: 'graph', cause }, options);
}

function toolsForContext(context: CauseContext, options?: TraceCauseOptions): Tool[] {
  return (Object.keys(CAUSE_OPERATIONS) as TraceCauseOperation[]).map((operation) =>
    defineTool<TraceCauseQuestion, string>({
      name: operation,
      ...CAUSE_OPERATIONS[operation],
      execute: async (question, execution) => {
        const assessed = causeContextAssessment(context);
        if (assessed.kind === 'invalid') return causeGap(operation, 'invalid-data');
        const capture =
          assessed.kind === 'stored'
            ? assessed.capture
            : context.kind === 'snapshot' && context.artifacts.cause === undefined
            ? true
            : undefined;
        const storage = assessed.kind === 'stored' ? assessed.admission.storage : undefined;
        if (execution.signal?.aborted && storage === undefined)
          return causeGap(operation, 'cancelled', capture);
        let limits: CauseLimits;
        try {
          limits = causeLimits(options);
        } catch {
          return causeGap(operation, 'invalid-data', capture, storage, 512);
        }
        if (execution.signal?.aborted)
          return causeGap(operation, 'cancelled', capture, storage, limits.maxChars);
        const deadline = performance.now() + limits.timeoutMs;
        try {
          const loaded = await loadCauseReader(deadline, execution.signal);
          if ('gap' in loaded)
            return causeGap(operation, loaded.gap, capture, storage, limits.maxChars);
          return await loaded.reader.readCause(
            operation,
            context,
            question,
            limits,
            deadline,
            execution.signal,
          );
        } catch {
          // Includes bounded loader refusals. Never echo an exception or disclose a private path.
          return causeGap(
            operation,
            execution.signal?.aborted
              ? 'cancelled'
              : performance.now() >= deadline
              ? 'timeout'
              : 'unavailable',
            capture,
            storage,
            limits.maxChars,
          );
        }
      },
    }),
  );
}
