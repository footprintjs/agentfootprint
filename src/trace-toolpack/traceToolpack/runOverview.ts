import type { ToolpackIndex } from './packIndex.js';
import type { TraceToolpackArtifacts } from '../types.js';
import type { Tool } from '../../tools/tools.js';
import { defineTool } from '../../tools/tools.js';
import {
  OVERVIEW_STAGE_CAP,
  OVERVIEW_DESCRIPTION_CAP,
  OVERVIEW_ERROR_CAP,
  OVERVIEW_KEY_CAP,
} from './structuralLimits.js';
import { truncateText, committedFinal } from './valueLines.js';
import { displayKey } from '../bounded.js';
import { findLastWriter } from 'foottrace';

// ── run_overview ───────────────────────────────────────────────────────────

/**
 * ONE line, only when the run mounted subflows: their inner steps are not in
 * this log, and here is the door. By reference — nothing from inside a
 * subflow is printed until the model asks for it.
 */
function overviewSubflowLine(index: ToolpackIndex): string | undefined {
  if (!index.subflowDoor) return undefined;
  const mounts = index.groups.filter((group) => group.isSubflow).flatMap((group) => group.ids);
  if (mounts.length === 0) return undefined;
  const results = index.subflowResults;
  const openable = mounts.find((id) => results !== undefined && id in results);
  return openable !== undefined
    ? `[subflow] steps ran their own log: inspect_subflow({ mount: '${openable}' }) opens one.`
    : `[subflow] steps kept no own log here — inspect_subflow({ mount }) says why.`;
}

function buildRunOverview(artifacts: TraceToolpackArtifacts, index: ToolpackIndex): Tool {
  return defineTool<Record<string, never>, string>({
    name: 'run_overview',
    description:
      'Start here. One bounded summary of the completed run: status, step counts, every ' +
      'stage (id + name + description), loop counts, where errors appeared, and honesty notes. ' +
      "Step ids look like 'stageId#executionIndex' (e.g. 'normalize#0'); every other trace " +
      'tool accepts them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => {
      const lines: string[] = ['TRACE RUN OVERVIEW'];
      lines.push(
        index.errorSteps.length > 0
          ? `status: ⚠ completed with ${index.errorSteps.length} step error(s) — see ERRORS below`
          : 'status: no step errors recorded',
      );
      lines.push(
        `execution steps: ${index.orderedIds.length} · distinct stages: ${index.groups.length} · ` +
          `commit-log mode: ${artifacts.snapshot.commitValues}`,
      );
      const example = index.orderedIds[0] ?? 'stageId#0';
      lines.push(
        `step ids look like stageId#executionIndex (e.g. '${example}') — pass them to ` +
          `trace_node / trace_slice / get_value.`,
      );

      lines.push('', `STAGES (${index.groups.length} distinct, first-execution order):`);
      for (const group of index.groups.slice(0, OVERVIEW_STAGE_CAP)) {
        const flags = [
          group.isDecider ? ' [decision]' : '',
          group.isSubflow ? ' [subflow]' : '',
        ].join('');
        const name = group.name !== undefined ? ` — "${group.name}"` : '';
        const description =
          group.description !== undefined
            ? `: ${truncateText(group.description, OVERVIEW_DESCRIPTION_CAP)}`
            : '';
        const errors =
          group.errorIds.length > 0
            ? ` ⚠ errors in ${group.errorIds.slice(0, 3).join(', ')}${
                group.errorIds.length > 3 ? ', …' : ''
              }`
            : '';
        lines.push(
          `- ${group.stagePart} ×${group.ids.length}${flags}${name}${description}${errors}`,
        );
      }
      if (index.groups.length > OVERVIEW_STAGE_CAP) {
        lines.push(`…and ${index.groups.length - OVERVIEW_STAGE_CAP} more stages (output capped)`);
      }
      const subflowHint = overviewSubflowLine(index);
      if (subflowHint !== undefined) lines.push(subflowHint);

      const loops = index.groups.filter((g) => g.ids.length > 1);
      if (loops.length > 0) {
        const top = [...loops]
          .sort((a, b) => b.ids.length - a.ids.length)
          .slice(0, 5)
          .map((g) => `${g.stagePart} ×${g.ids.length}`)
          .join(' · ');
        lines.push('', `LOOPS: ${top}`);
      }

      if (index.errorSteps.length > 0) {
        lines.push('', 'ERRORS:');
        for (const step of index.errorSteps.slice(0, OVERVIEW_ERROR_CAP)) {
          lines.push(
            `- ⚠ ${step.id}: ${step.keys.join(', ')} (drill with trace_node('${step.id}'))`,
          );
        }
        if (index.errorSteps.length > OVERVIEW_ERROR_CAP) {
          lines.push(`…and ${index.errorSteps.length - OVERVIEW_ERROR_CAP} more error steps`);
        }
      }

      if (index.untrackedStepCount > 0) {
        lines.push(
          '',
          `HONESTY: ⚠ ${index.untrackedStepCount} step(s) consumed untracked inputs (args/env/silent ` +
            `reads) — causal slices through them may be incomplete; trace_node marks each one.`,
        );
      }

      const stateKeys = Object.keys(artifacts.snapshot.sharedState ?? {});
      const shown = stateKeys.slice(0, OVERVIEW_KEY_CAP).map(displayKey);
      lines.push(
        '',
        `SHARED STATE KEYS (${stateKeys.length}): ${shown.join(', ')}` +
          (stateKeys.length > OVERVIEW_KEY_CAP
            ? `, … +${stateKeys.length - OVERVIEW_KEY_CAP} more`
            : '') +
          ' — values via who_wrote / get_value.',
      );

      // COST — only when the run actually priced itself. `cumEstimatedUsd`
      // is seeded to 0 on every agent run and only ever moves under a
      // configured `pricingTable`, so a zero here means "this run was not
      // priced", and printing "$0.00" for it would be a number that lies.
      const spend = committedFinal(index, 'cumEstimatedUsd');
      if (typeof spend === 'number' && spend > 0) {
        const tokensIn = committedFinal(index, 'cumTokensInput');
        const tokensOut = committedFinal(index, 'cumTokensOutput');
        const writer = findLastWriter(index.commitLog, 'cumEstimatedUsd');
        lines.push(
          '',
          `COST: ~$${spend.toFixed(6)} (in ${typeof tokensIn === 'number' ? tokensIn : '?'} / out ${
            typeof tokensOut === 'number' ? tokensOut : '?'
          } tokens) — estimated by the ` +
            `run's pricing table, not a bill` +
            (writer ? ` — via get_value('${writer.runtimeStageId}', 'cumEstimatedUsd').` : '.'),
        );
      }

      if (artifacts.narrative !== undefined) {
        lines.push(
          `NARRATIVE: ${artifacts.narrative.length} line(s) available via read_narrative.`,
        );
      }
      lines.push(
        `SEARCH: find_in_trace('<text>') locates any phrase in this record and hands back ids.`,
      );

      return lines.join('\n');
    },
  });
}

export { buildRunOverview };
