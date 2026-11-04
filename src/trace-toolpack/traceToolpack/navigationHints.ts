import type { ToolpackIndex } from './packIndex.js';
import { stagePartOf } from './packIndex.js';
import { UNKNOWN_ID_SUGGESTION_CAP, KEY_SUGGESTION_CAP } from './structuralLimits.js';
import { displayKey } from '../bounded.js';

// ── Shared message helpers ─────────────────────────────────────────────────

function unknownIdMessage(id: string, index: ToolpackIndex): string {
  const home = index.homeMountOf(id);
  if (home !== undefined) return innerIdMessage(id, home);
  const stagePart = stagePartOf(id);
  const siblings = index.idsByStagePart.get(stagePart);
  if (siblings && siblings.length > 0) {
    return (
      `unknown runtimeStageId '${id}'. Stage '${stagePart}' has ${siblings.length} ` +
      `execution(s): ${siblings.slice(0, UNKNOWN_ID_SUGGESTION_CAP).join(', ')}` +
      (siblings.length > UNKNOWN_ID_SUGGESTION_CAP ? ', …' : '') +
      `. Retry with one of those ids.`
    );
  }
  const sample = index.orderedIds.slice(0, UNKNOWN_ID_SUGGESTION_CAP).join(', ');
  return (
    `unknown runtimeStageId '${id}'. Ids look like stageId#executionIndex` +
    (sample
      ? ` — known steps include: ${sample}${
          index.orderedIds.length > UNKNOWN_ID_SUGGESTION_CAP ? ', …' : ''
        }`
      : '') +
    `. Call run_overview to list every stage.`
  );
}

/** An id from a subflow's OWN log, pasted into a tool over the log above it. */
function innerIdMessage(id: string, mount: string): string {
  return (
    `'${id}' is a step INSIDE subflow mount ${mount} — an id of that subflow's own log, not ` +
    `of this one. Open it there: inspect_subflow({ mount: '${mount}', runtimeStageId: '${id}' }).`
  );
}

/** The one line a subflow mount carries: it can be opened, and how. */
function mountLine(index: ToolpackIndex, id: string): string {
  return index.subflowResults !== undefined && id in index.subflowResults
    ? `inside: inspect_subflow({ mount: '${id}' }) opens this subflow's own log.`
    : `inside: no own log kept for this mount — inspect_subflow({ mount: '${id}' }) says why.`;
}

function unknownKeySuffix(index: ToolpackIndex): string {
  if (index.knownPaths.size === 0) return '';
  const sample = [...index.knownPaths].slice(0, KEY_SUGGESTION_CAP).map(displayKey).join(', ');
  return ` Known keys include: ${sample}${
    index.knownPaths.size > KEY_SUGGESTION_CAP ? ', …' : ''
  }.`;
}

export { unknownIdMessage, mountLine, unknownKeySuffix };
