import type { TraceToolpackArtifacts, ResolvedToolpackOptions } from '../types.js';
import type { ToolpackIndex } from './packIndex.js';
import type { Tool } from '../../tools/tools.js';
import { defineTool } from '../../tools/tools.js';
import { TOOLPACK_HARD_CAPS } from '../types.js';
import { idProperty, keyProperty } from './parameterSchemas.js';
import { displayKey, clampParam, normalizeKey, displayText } from '../bounded.js';
import { unknownIdMessage } from './navigationHints.js';
import { causalChain, formatCausalChain } from 'foottrace';

// ── trace_slice ────────────────────────────────────────────────────────────

function buildTraceSlice(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
  opts: ResolvedToolpackOptions,
): Tool {
  return defineTool<
    { runtimeStageId: string; key?: string; maxDepth?: number; maxNodes?: number },
    string
  >({
    name: 'trace_slice',
    description:
      'The causal chain: which earlier steps produced the data at a step (backward ' +
      'read→write slice over the commit log, plus [control: rule] edges to the decisions ' +
      'that routed execution when available). Returns a compact indented tree of step ids — ' +
      'drill any (id) with trace_node, fetch values with get_value. Bounded by maxDepth ' +
      `(default ${opts.sliceMaxDepth}, max ${TOOLPACK_HARD_CAPS.sliceMaxDepth}) and maxNodes ` +
      `(default ${opts.sliceMaxNodes}, max ${TOOLPACK_HARD_CAPS.sliceMaxNodes}); truncation and ` +
      "incomplete-slice ⚠ markers are always shown. Pass 'key' to slice one state key only.",
    inputSchema: {
      type: 'object',
      properties: {
        runtimeStageId: idProperty(index, "The step to slice back from, e.g. 'approve#0'."),
        key: keyProperty(
          index,
          'Optional: restrict the slice to the chain that produced THIS state key.',
        ),
        maxDepth: {
          type: 'integer',
          description: `Optional slice depth (default ${opts.sliceMaxDepth}, hard cap ${TOOLPACK_HARD_CAPS.sliceMaxDepth}).`,
        },
        maxNodes: {
          type: 'integer',
          description: `Optional node budget (default ${opts.sliceMaxNodes}, hard cap ${TOOLPACK_HARD_CAPS.sliceMaxNodes}).`,
        },
      },
      required: ['runtimeStageId'],
      additionalProperties: false,
    },
    execute: ({ runtimeStageId, key, maxDepth, maxNodes }) => {
      if (!index.firstIdxOf.has(runtimeStageId)) {
        if (index.nodes.has(runtimeStageId)) {
          const reads = Object.keys(index.nodes.get(runtimeStageId)?.stageReads ?? {});
          return (
            `step '${runtimeStageId}' committed nothing — the commit-log slice cannot root there. ` +
            (reads.length > 0
              ? `It read: ${reads
                  .map(displayKey)
                  .join(', ')} — use who_wrote on each, or trace_slice from a downstream step.`
              : 'Use trace_node for its details, or trace_slice from a downstream step.')
          );
        }
        return unknownIdMessage(runtimeStageId, index);
      }

      const depth = clampParam(maxDepth, opts.sliceMaxDepth, 1, TOOLPACK_HARD_CAPS.sliceMaxDepth);
      const nodeBudget = clampParam(
        maxNodes,
        opts.sliceMaxNodes,
        2,
        TOOLPACK_HARD_CAPS.sliceMaxNodes,
      );

      const keysReadOf = (id: string): string[] => {
        const node = index.nodes.get(id);
        return node?.stageReads ? Object.keys(node.stageReads) : [];
      };
      const normalizedKey = key !== undefined ? normalizeKey(key, index.knownPaths) : undefined;
      const keysFn =
        normalizedKey !== undefined
          ? (id: string): string[] => (id === runtimeStageId ? [normalizedKey] : keysReadOf(id))
          : keysReadOf;

      const dag = causalChain(index.commitLog, runtimeStageId, keysFn, {
        maxDepth: depth,
        maxNodes: nodeBudget,
        ...(artifacts.controlDeps ? { controlDeps: artifacts.controlDeps } : {}),
      });
      if (!dag) return unknownIdMessage(runtimeStageId, index);

      const lines: string[] = [
        `CAUSAL SLICE from ${runtimeStageId}` +
          (normalizedKey !== undefined ? ` for key '${displayKey(normalizedKey)}'` : '') +
          ` (maxDepth ${depth}, maxNodes ${nodeBudget})`,
        'each line: Stage (stepId) ← via <the key it provided> [wrote: …]. Drill any (stepId) ' +
          'with trace_node; fetch values with get_value.',
        '',
        displayText(formatCausalChain(dag)),
      ];
      if (!artifacts.controlDeps) {
        lines.push(
          '⚠ control edges unavailable — artifacts carry no controlDeps lookup (attach ' +
            'controlDepRecorder() to the original run); decisions that routed execution are not shown.',
        );
      }
      if (!index.hasReadTracking) {
        lines.push(
          '⚠ artifacts carry no per-step read tracking — read→write edges cannot be followed; ' +
            'the slice may show only the start step.',
        );
      }
      return lines.join('\n');
    },
  });
}

export { buildTraceSlice };
