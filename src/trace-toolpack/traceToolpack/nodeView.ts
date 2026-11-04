import type { TraceToolpackArtifacts, ResolvedToolpackOptions } from '../types.js';
import type { ToolpackIndex } from './packIndex.js';
import type { Tool } from '../../tools/tools.js';
import { defineTool } from '../../tools/tools.js';
import { idProperty } from './parameterSchemas.js';
import { unknownIdMessage, mountLine } from './navigationHints.js';
import { stagePartOf, anchorIdxFor } from './packIndex.js';
import { NODE_WRITE_CAP, NODE_READ_CAP, OVERVIEW_ERROR_CAP } from './structuralLimits.js';
import { boundedPreview, displayKey, displayText, renderPreview } from '../bounded.js';
import { commitValueAt, findLastWriterWithBasis } from 'foottrace';
import { redactionNote, honestyLine, untrackedSourcesOf } from './valueLines.js';
import type { HonestyCode } from 'foottrace';

// ── trace_node ─────────────────────────────────────────────────────────────

function buildTraceNode(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
  opts: ResolvedToolpackOptions,
): Tool {
  return defineTool<{ runtimeStageId: string }, string>({
    name: 'trace_node',
    description:
      'Inspect ONE execution step by runtimeStageId: name + description, what it wrote ' +
      '(bounded previews + true sizes), what it read, its parents (which step provided each ' +
      'input, plus the decision that routed to it when known), errors, and ⚠ honesty markers. ' +
      'The drill-down primitive — use ids from run_overview, trace_slice, or who_wrote.',
    inputSchema: {
      type: 'object',
      properties: {
        runtimeStageId: idProperty(index, "The step to inspect, e.g. 'normalize#0'."),
      },
      required: ['runtimeStageId'],
      additionalProperties: false,
    },
    execute: ({ runtimeStageId }) => {
      const node = index.nodes.get(runtimeStageId);
      const bundles = index.bundlesOf.get(runtimeStageId);
      if (!node && !bundles) return unknownIdMessage(runtimeStageId, index);

      const lines: string[] = [];
      const flags = [
        node?.isDecider ? ' [decision]' : '',
        node?.subflowId ? ' [subflow]' : '',
      ].join('');
      const name = node?.name ?? bundles?.[0]?.stage ?? stagePartOf(runtimeStageId);
      lines.push(`STEP ${runtimeStageId} — "${name}"${flags}`);
      if (node?.description) lines.push(`description: ${node.description}`);
      if (node?.subflowId && index.subflowDoor) lines.push(mountLine(index, runtimeStageId));

      // Writes — verb-aware values via commitValueAt (delta-mode safe).
      const writes = new Map<string, string>(); // path → verb (last wins)
      for (const bundle of bundles ?? []) {
        for (const entry of bundle.trace) writes.set(entry.path, entry.verb);
      }
      if (writes.size === 0) {
        lines.push('wrote: nothing committed');
      } else {
        lines.push(`wrote (${writes.size}):`);
        const lastIdx = index.lastIdxOf.get(runtimeStageId) ?? index.commitLog.length - 1;
        let shown = 0;
        for (const [path, verb] of writes) {
          if (shown >= NODE_WRITE_CAP) {
            lines.push(`…and ${writes.size - NODE_WRITE_CAP} more keys (output capped)`);
            break;
          }
          const preview = boundedPreview(
            commitValueAt(index.commitLog, lastIdx, path),
            opts.previewChars,
          );
          const dotted = displayKey(path);
          lines.push(
            `- ${dotted} (${verb}): ${displayText(
              renderPreview(preview, `get_value('${runtimeStageId}', '${dotted}') for full`),
            )}${redactionNote(bundles, path)}`,
          );
          shown++;
        }
      }

      // Reads + parents.
      const reads = node?.stageReads ? Object.keys(node.stageReads) : [];
      if (reads.length === 0) {
        lines.push(
          index.hasReadTracking
            ? 'read: no tracked reads recorded'
            : 'read: no tracked reads recorded ⚠ (artifacts carry no read tracking)',
        );
      } else {
        const shownReads = reads.slice(0, NODE_READ_CAP).map(displayKey).join(', ');
        lines.push(
          `read (${reads.length}): ${shownReads}${
            reads.length > NODE_READ_CAP ? ', … (output capped)' : ''
          }`,
        );
      }

      const parentLines: string[] = [];
      const parentCodes: HonestyCode[] = [];
      const anchorIdx = anchorIdxFor(runtimeStageId, index);
      for (const key of reads.slice(0, NODE_READ_CAP)) {
        const { writer, basis } = findLastWriterWithBasis(index.commitLog, key, anchorIdx);
        parentLines.push(
          writer
            ? `- data: ${displayKey(key)} ← ${writer.runtimeStageId} "${writer.stage}"` +
                (basis.length > 0 ? ` ⚠ ${basis.join(', ')}` : '')
            : `- data: ${displayKey(key)} ← (no tracked writer ⚠ ${basis.join(', ')})`,
        );
        parentCodes.push(...basis);
      }
      const controlDep = artifacts.controlDeps?.(runtimeStageId);
      if (controlDep) {
        parentLines.push(
          `- control: routed here by ${controlDep.deciderId}` +
            (controlDep.label ? ` — rule "${controlDep.label}"` : ''),
        );
      }
      if (parentLines.length > 0) {
        lines.push('parents:');
        lines.push(...parentLines);
        for (const code of new Set(parentCodes)) lines.push(honestyLine(index, code));
      }
      if (!artifacts.controlDeps) {
        lines.push(
          '⚠ control-dependence lookup not provided — the decision that routed here is unknown.',
        );
      }

      const untracked = untrackedSourcesOf(bundles);
      if (untracked.length > 0) {
        lines.push(
          `⚠ this step also consumed ${untracked.join('/')} — NOT in the parents list. ` +
            honestyLine(index, 'incomplete-sources'),
        );
      }

      // The tool boundary, named honestly: the agent chart's tool-execution
      // stage runs CONSUMER code (DB calls, services). The trace records the
      // envelope — args in, results out — never the internals. Gated on the
      // agent-chart signature (a call-llm stage exists) so a generic chart
      // with a coincidental 'tool-calls' stage gets no false marker.
      const isAgentChart = [...index.idsByStagePart.keys()].some(
        (part) => part.split('/').pop() === 'call-llm',
      );
      if (isAgentChart && stagePartOf(runtimeStageId).split('/').pop() === 'tool-calls') {
        lines.push(
          '⚠ boundary: tool execution happens in consumer systems — the trace records ' +
            'arguments in / results out; tool internals are not traced unless the tool ' +
            'returns its own diagnostic refs.',
        );
      }

      const errorKeys = Object.keys(node?.errors ?? {});
      if (errorKeys.length > 0) {
        lines.push(`errors (${errorKeys.length}):`);
        for (const key of errorKeys.slice(0, OVERVIEW_ERROR_CAP)) {
          const preview = boundedPreview((node?.errors ?? {})[key], opts.previewChars);
          lines.push(`- ⚠ ${key}: ${displayText(renderPreview(preview))}`);
        }
      }

      return lines.join('\n');
    },
  });
}

export { buildTraceNode };
