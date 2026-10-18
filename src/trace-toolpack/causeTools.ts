import type { StageSnapshot } from 'footprintjs/advanced';
import { defineTool, type Tool } from '../tools/tools.js';
import type { TraceToolpackArtifacts } from './types.js';
import type { TraceCauseOperation, TraceCauseOptions, TraceCauseQuestion } from './causeTypes.js';
import { CAUSE_TOOL_CAPS, causeLimits } from './causeLimits.js';
import { causeGap } from './causeResponse.js';
import { loadCauseReader } from './causeLoad.js';

const workProperties = {
  maxNodes: { type: 'integer', minimum: 1, maximum: CAUSE_TOOL_CAPS.maxNodes },
  maxDepth: { type: 'integer', minimum: 0, maximum: CAUSE_TOOL_CAPS.maxDepth },
  maxEdges: { type: 'integer', minimum: 1, maximum: CAUSE_TOOL_CAPS.maxEdges },
  maxCalls: { type: 'integer', minimum: 1, maximum: CAUSE_TOOL_CAPS.maxCalls },
};
const direction = { type: 'object', properties: workProperties, additionalProperties: false };
const nodeId = {
  type: 'string',
  minLength: 1,
  maxLength: 2048,
  description:
    'An opaque node ID returned by attention_list in THIS artifact scope, not an outer/inner stage ID.',
};

/** The schemas are cheap. The public cause reader is loaded only when one of these tools executes. */
export function buildCauseTools(
  artifacts: TraceToolpackArtifacts,
  nodes: ReadonlyMap<string, StageSnapshot>,
  defaults?: TraceCauseOptions,
): Tool[] {
  return (['attention_list', 'root_cause', 'impact'] as const).map(
    (operation: TraceCauseOperation) =>
      defineTool<TraceCauseQuestion, string>({
        name: operation,
        description:
          operation === 'attention_list'
            ? 'Find recorded abnormal nodes and proof IDs in this authorized graph, bounded and read-only. Start here; missing capture is unknown, never healthy.'
            : operation === 'root_cause'
            ? 'Explain one recorded node using public Foottrace cause analysis. Cite root/path/evidence IDs. Gaps mean not sure; alternatives are not proven roots. No provider internals are inferred.'
            : 'Read the recorded forward impact of one node, with explicit gaps. Uses one bounded Foottrace query; it never reruns business work.',
        inputSchema: {
          type: 'object',
          properties: {
            ...(operation === 'attention_list'
              ? { nodeIds: { type: 'array', items: nodeId, maxItems: 100 } }
              : { nodeId }),
            ...workProperties,
            timeoutMs: { type: 'integer', minimum: 1, maximum: CAUSE_TOOL_CAPS.timeoutMs },
            maxChars: { type: 'integer', minimum: 512, maximum: CAUSE_TOOL_CAPS.maxChars },
            ...(operation === 'attention_list' ? {} : { backward: direction, impact: direction }),
          },
          ...(operation === 'attention_list' ? {} : { required: ['nodeId'] }),
          additionalProperties: false,
        },
        execute: async (question, context) => {
          if (context.signal?.aborted) return causeGap(operation, 'cancelled');
          let limits: ReturnType<typeof causeLimits>;
          try {
            limits = causeLimits(defaults, question);
          } catch {
            return causeGap(operation, 'invalid-data');
          }
          const deadline = performance.now() + limits.timeoutMs;
          try {
            const loaded = await loadCauseReader(deadline, context.signal);
            if ('gap' in loaded) return causeGap(operation, loaded.gap);
            const { readCause } = loaded.reader;
            return await readCause(
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
            );
          }
        },
      }),
  );
}
