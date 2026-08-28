/**
 * runbook/walk — the recorded walk: projection law, counters, mint.
 *
 * Pattern: pure projection (`projectWalk`) + one guarded side effect
 *          (`mintWalk`, which files the artifact and NEVER fails the answer).
 * Role:    core/runbook. The walk is not a debugging extra — a procedure that
 *          cannot show how it reached a verdict is a procedure somebody has
 *          to take on trust.
 * Emits:   nothing (the artifact capability emits its own `artifacts.*`).
 *
 * THE CAP LAW, and why a head slice is the wrong cap: in a chart walk the
 * per-key reads and writes come FIRST and the decisions come LAST, so a
 * naive head slice over a fleet sweep keeps four hundred writes and drops
 * every decision — a walk with the walking taken out. When the whole thing
 * does not fit, the CONTROL FLOW survives (stages, forks, subflows, and
 * every `condition` entry carrying its decide() evidence) and the projection
 * is DECLARED, so a reader knows which of the two they are holding.
 */

import type { ToolExecutionContext } from '../tools.js';
import { CHART_WALK_ARTIFACT_KIND, chartWalkPutInput } from '../../artifacts/recordingArtifact.js';
import type { WalkDescriptor } from './types.js';

/** The default row cap — a readable artifact, not an archive. The count is
 *  always reported, so a truncated walk says it is truncated instead of
 *  looking like a short run. */
export const DEFAULT_WALK_CAP = 500;

/** A narrative entry as this module reads it. `rawValue` is deliberately NOT
 *  in the list: it is a LIVE reference into engine memory and has no business
 *  in a value checked into an artifact store. */
export interface NarrativeEntryView {
  readonly type: string;
  readonly text: string;
  readonly depth: number;
  readonly stageName?: string;
  readonly stageId?: string;
  readonly runtimeStageId?: string;
  readonly subflowId?: string;
}

/** One walk row — plain data by construction (every field projected). */
export interface WalkRow {
  readonly step: number;
  readonly type: string;
  readonly depth: number;
  readonly stage: string | null;
  readonly stage_id: string | null;
  readonly runtime_stage_id: string | null;
  readonly subflow: string | null;
  readonly text: string;
}

/** The pure projection result — rows plus truthful counters. */
export interface ProjectedWalk {
  readonly rows: readonly WalkRow[];
  readonly projection: 'full' | 'control-flow';
  readonly shown: number;
  readonly total: number;
  readonly complete: boolean;
}

function toWalkRow(entry: NarrativeEntryView, step: number): WalkRow {
  return {
    step,
    type: entry.type,
    depth: entry.depth,
    stage: entry.stageName ?? null,
    stage_id: entry.stageId ?? null,
    runtime_stage_id: entry.runtimeStageId ?? null,
    subflow: entry.subflowId ?? null,
    text: entry.text,
  };
}

/** Apply the cap law. Counters are about the WHOLE narrative (`total`), so a
 *  projected walk cannot read as a short run. */
export function projectWalk(entries: readonly NarrativeEntryView[], cap: number): ProjectedWalk {
  const full = entries.length <= cap;
  const projection: 'full' | 'control-flow' = full ? 'full' : 'control-flow';
  const chosen = full ? entries : entries.filter((entry) => entry.type !== 'step');
  const rows = chosen.slice(0, cap).map(toWalkRow);
  return {
    rows,
    projection,
    shown: rows.length,
    total: entries.length,
    complete: rows.length === entries.length,
  };
}

/** The descriptor's standing sentence, plus the projection clause when the
 *  control flow is what survived. */
function walkNote(projection: 'full' | 'control-flow'): string {
  return (
    "The chart's own walk, one row per execution step. The `condition` rows carry the " +
    'rule that matched, the values it compared and the branch it chose — that is where a ' +
    'verdict can be checked rather than taken on trust.' +
    (projection === 'control-flow'
      ? ' This one is the CONTROL-FLOW projection: the walk did not fit, so the stages, ' +
        'forks, subflows and decisions are here and the per-key reads and writes are not.'
      : '')
  );
}

/** What the mint needs from the call. */
export interface WalkMintFacts {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly runId?: string;
  readonly stepsExecuted: number;
}

/**
 * File the walk and build the descriptor. THE SPINE ALWAYS GETS A
 * DESCRIPTOR: with no store attached, or when the mint fails, the counters
 * still travel and the note names why there is no ticket — a failed mint
 * costs the TICKET, never the answer and never the counts.
 */
export async function mintWalk(
  ctx: ToolExecutionContext,
  projected: ProjectedWalk,
  facts: WalkMintFacts,
): Promise<WalkDescriptor> {
  const base = {
    rows: projected.rows.length,
    steps_executed: facts.stepsExecuted,
    projection: projected.projection,
    shown: projected.shown,
    total: projected.total,
    complete: projected.complete,
    walk_segment: 'full' as const,
  };
  if (!ctx.hasArtifacts || projected.rows.length === 0) {
    return {
      ...base,
      note:
        projected.rows.length === 0
          ? 'The run produced no narrative entries, so there was no walk to file.'
          : walkNote(projected.projection) +
            ' No artifact store is attached to this run, so the walk was recorded but not ' +
            'filed — the counters above are still the truth about it.',
    };
  }
  try {
    const meta = await ctx.artifacts.put(
      chartWalkPutInput([...projected.rows], {
        toolName: facts.toolName,
        toolCallId: facts.toolCallId,
        ...(facts.runId !== undefined && { runId: facts.runId }),
      }),
    );
    return {
      ref: meta.ref,
      kind: CHART_WALK_ARTIFACT_KIND,
      ...base,
      note: walkNote(projected.projection),
    };
  } catch (err) {
    return {
      ...base,
      note:
        walkNote(projected.projection) +
        ` The walk could not be filed (${err instanceof Error ? err.message : String(err)}) — ` +
        'the mint failure cost the ticket, never the answer.',
    };
  }
}
