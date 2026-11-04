import type { TraceToolpackArtifacts, ResolvedToolpackOptions } from '../types.js';
import type { ToolpackIndex } from './packIndex.js';
import type { Tool } from '../../tools/tools.js';
import { defineTool } from '../../tools/tools.js';
import { TOOLPACK_HARD_CAPS } from '../types.js';
import { keyProperty } from './parameterSchemas.js';
import {
  normalizeKey,
  displayKey,
  renderPreview,
  boundedPreview,
  clampParam,
  displayText,
} from '../bounded.js';
import { elementProvenance, arrayProvenance, sliceForKey, formatSlice } from 'foottrace';
import { honestyLine, basisLines } from './valueLines.js';

// ── who_wrote ──────────────────────────────────────────────────────────────

// ── backtrack — variable-first triage (the follow-up question shape) ──────

/**
 * `trace_slice` is STEP-addressed ("what fed step X?"). Follow-up questions
 * arrive VARIABLE-addressed ("why did you say the quote is 11.88?" → "why is
 * `quote` what it is?") — and for agent history, ELEMENT-addressed ("where
 * did message 7 come from?"). This tool is that address translation, built
 * on footprintjs' slice layer (`sliceForKey` / `elementProvenance`): anchor
 * at the variable's last writer, walk backwards; or name one array element's
 * birth step. Same honesty contracts as the rest of the pack — a missing
 * slice states WHY (initial state / frozen args / a closure), element
 * attribution carries its basis (append-verb exact vs prefix-inference),
 * and reads-coverage warns when read tracking was off.
 */
function buildBacktrack(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
  opts: ResolvedToolpackOptions,
): Tool {
  return defineTool<
    { variable: string; element?: number; before?: number; maxDepth?: number; maxNodes?: number },
    string
  >({
    name: 'backtrack',
    description:
      "Why is a state VARIABLE what it is? Anchors at the variable's last writer and walks the " +
      'backward dependency chain (variable-first — you do not need a step id). For array ' +
      "variables (e.g. 'history'), pass 'element' to ask which step produced element N instead. " +
      "Optional 'before' (commit index) time-travels: the value as it stood before that point. " +
      `Bounded by maxDepth (default ${opts.sliceMaxDepth}, max ${TOOLPACK_HARD_CAPS.sliceMaxDepth}) ` +
      `and maxNodes (default ${opts.sliceMaxNodes}, max ${TOOLPACK_HARD_CAPS.sliceMaxNodes}).`,
    inputSchema: {
      type: 'object',
      properties: {
        variable: keyProperty(index, "The state key to explain, e.g. 'quote' or 'history'."),
        element: {
          type: 'integer',
          description:
            'Optional array index: ask which step PRODUCED this element (birth attribution) ' +
            'instead of slicing the whole variable.',
        },
        before: {
          type: 'integer',
          description:
            'Optional exclusive commit index — explain the value as it stood BEFORE this point ' +
            "(chain from an element birth with: element_birth's commitIdx + 1).",
        },
        maxDepth: {
          type: 'integer',
          description: `Optional slice depth (default ${opts.sliceMaxDepth}, hard cap ${TOOLPACK_HARD_CAPS.sliceMaxDepth}).`,
        },
        maxNodes: {
          type: 'integer',
          description: `Optional node budget (default ${opts.sliceMaxNodes}, hard cap ${TOOLPACK_HARD_CAPS.sliceMaxNodes}).`,
        },
      },
      required: ['variable'],
      additionalProperties: false,
    },
    execute: ({ variable, element, before, maxDepth, maxNodes }) => {
      const key = normalizeKey(variable, index.knownPaths);

      // ── element mode: birth attribution ─────────────────────────────────
      if (element !== undefined) {
        const birth = elementProvenance(index.commitLog, key, element, {
          ...(before !== undefined && { atIdx: before - 1 }),
        });
        if (!birth) {
          const prov = arrayProvenance(index.commitLog, key, {
            ...(before !== undefined && { atIdx: before - 1 }),
          });
          if (prov.missing === 'not-an-array') {
            return (
              `'${displayKey(key)}': ${honestyLine(index, 'not-an-array')}` +
              basisLines(index, prov.basis ?? []) +
              `\nCall backtrack without 'element' to slice it.`
            );
          }
          if (prov.missing !== undefined) {
            return `'${displayKey(key)}': ${honestyLine(index, prov.missing)}`;
          }
          return (
            `element ${element} is out of range for '${displayKey(key)}' ` +
            `(length ${prov.length}). Valid indices: 0..${(prov.length ?? 1) - 1}.`
          );
        }
        return (
          `'${displayKey(key)}'[${birth.index}] = ${renderPreview(
            boundedPreview(birth.value, opts.previewChars),
          )} — ` +
          `born at ${birth.runtimeStageId} ("${birth.stageName}", verb: ${birth.verb}, ` +
          `attribution: ${birth.basis}${
            birth.basis === 'append-verb' ? ' — engine-recorded, exact' : ''
          }). ` +
          `Drill the producer with trace_node('${birth.runtimeStageId}'), or ask why it wrote this ` +
          `with backtrack({variable: '${displayKey(key)}', before: ${birth.commitIdx + 1}}).` +
          // Only an INFERRED birth says why; an exact one keeps its bytes.
          (birth.basis === 'prefix-inference' ? basisLines(index, [birth.basis]) : '')
        );
      }

      // ── slice mode: variable-first backward slice ────────────────────────
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
      const slice = sliceForKey(index.commitLog, key, keysReadOf, {
        maxDepth: depth,
        maxNodes: nodeBudget,
        ...(before !== undefined && { before }),
        ...(artifacts.controlDeps ? { controlDeps: artifacts.controlDeps } : {}),
      });

      const lines: string[] = [
        displayText(formatSlice(slice)),
        '',
        'drill any (stepId) with trace_node; fetch values with get_value; array variables take ' +
          "'element' for per-element attribution.",
      ];
      if (slice.root !== undefined && !artifacts.controlDeps) {
        lines.push(
          '⚠ control edges unavailable — artifacts carry no controlDeps lookup; decisions that ' +
            'routed execution are not shown.',
        );
      }
      if (slice.root !== undefined && !index.hasReadTracking) {
        lines.push(
          '⚠ artifacts carry no per-step read tracking — the slice may show only the writer step.',
        );
      }
      return lines.join('\n');
    },
  });
}

export { buildBacktrack };
