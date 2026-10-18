import type { StageSnapshot } from 'footprintjs/advanced';
import { defineTool, type Tool } from '../tools/tools.js';
import type { TraceToolpackArtifacts } from './types.js';
import type { TraceCauseOperation, TraceCauseOptions, TraceCauseQuestion } from './causeTypes.js';
import { causeLimits, type CauseLimits } from './causeLimits.js';
import { causeGap } from './causeResponse.js';
import { loadCauseReader } from './causeLoad.js';

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
  return (Object.keys(CAUSE_OPERATIONS) as TraceCauseOperation[]).map((operation) =>
    defineTool<TraceCauseQuestion, string>({
      name: operation,
      ...CAUSE_OPERATIONS[operation],
      execute: async (question, context) => {
        const snapshotOnly = artifacts.cause === undefined;
        if (context.signal?.aborted) return causeGap(operation, 'cancelled', snapshotOnly);
        let limits: CauseLimits;
        try {
          limits = causeLimits(options);
        } catch {
          return causeGap(operation, 'invalid-data', snapshotOnly);
        }
        const deadline = performance.now() + limits.timeoutMs;
        try {
          const loaded = await loadCauseReader(deadline, context.signal);
          if ('gap' in loaded) return causeGap(operation, loaded.gap, snapshotOnly);
          return await loaded.reader.readCause(
            operation,
            artifacts,
            nodes,
            question,
            limits,
            deadline,
            context.signal,
          );
        } catch {
          // Includes bounded loader refusals. Never echo an exception or disclose a private path.
          return causeGap(
            operation,
            context.signal?.aborted
              ? 'cancelled'
              : performance.now() >= deadline
              ? 'timeout'
              : 'unavailable',
            snapshotOnly,
          );
        }
      },
    }),
  );
}
