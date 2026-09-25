/**
 * Earlier answers' tool results that were IN FRONT OF THE MODEL when it
 * answered — proven by the record's witness, never by end-of-run state.
 *
 * The witness rule, in typed terms:
 *   N = the `iteration` of the LAST `stream.llm_start` before `turn_end` (the
 *       answering iteration). Context assembly for an iteration PRECEDES its
 *       `iteration_start`, and `context.injected` carries no iteration of its
 *       own, so the rule keys on the compose STAGE:
 *   the witnesses are the `context.injected` rows with `slot: 'messages'`,
 *   `source: 'tool-result'`, `sourceId: <toolCallId>` whose
 *   `meta.runtimeStageId` equals that of the `context.slot_composed` with
 *   `slot: 'messages'` and `iteration: N`.
 * The content is parsed from the matching `history` message (by `toolCallId`).
 *
 * Only EARLIER answers' results: `distance` (user messages after the result, up
 * to and including the current one) must be at least 1, and a call of this run
 * is never "in view" — on the flagship recording the answering compose also
 * witnesses this run's own `get_array_inventory` result (`events[68]`), which
 * must never become an in-view line.
 */

import type { InViewFact } from '../types.js';
import { isRecord, num, str, type RecordingView, type ViewEvent } from '../view.js';
import {
  at,
  historyAt,
  historyOf,
  readEmptiness,
  type EmptinessReading,
  type ReadContext,
} from './common.js';

/** At most this many in-view results are listed, newest first. */
export const MAX_IN_VIEW = 3;

export interface InViewRead {
  readonly fact: InViewFact;
  readonly witness: ViewEvent;
  readonly historyIndex: number;
  readonly reading: EmptinessReading;
}

/** N — the answering iteration. `undefined` when no `llm_start` is recorded. */
export function answeringIteration(view: RecordingView): number | undefined {
  const end = view.last('agent.turn_end');
  const starts = view
    .ofType('stream.llm_start')
    .filter((e) => end === undefined || e.index < end.index);
  return num(starts[starts.length - 1]?.payload.iteration);
}

/** The witness rows of the answering iteration's messages compose. */
export function witnessesOf(view: RecordingView, iteration: number | undefined): ViewEvent[] {
  if (iteration === undefined) return [];
  const composed = view
    .ofType('context.slot_composed')
    .filter((e) => e.payload.slot === 'messages' && e.payload.iteration === iteration);
  const stage = str(composed[composed.length - 1]?.meta.runtimeStageId);
  if (stage === undefined) return [];
  return view
    .ofType('context.injected')
    .filter(
      (e) =>
        e.meta.runtimeStageId === stage &&
        e.payload.slot === 'messages' &&
        e.payload.source === 'tool-result' &&
        typeof e.payload.sourceId === 'string',
    );
}

export interface InViewAll {
  /** Every in-view result, newest first — the checks read all of them. */
  readonly all: readonly InViewRead[];
  readonly listed: readonly InViewRead[];
  /** In view but past `MAX_IN_VIEW`. */
  readonly more: number;
}

export function readInView(ctx: ReadContext, callIds: ReadonlySet<string>): InViewAll {
  const history = historyOf(ctx.view);
  const windowed = typeof ctx.view.first('agent.run_configured')?.payload.window === 'string';
  const reads: InViewRead[] = [];
  for (const witness of witnessesOf(ctx.view, ctx.answeringIteration)) {
    const id = witness.payload.sourceId as string;
    if (callIds.has(id)) continue;
    const historyIndex = history.findIndex(
      (m) => isRecord(m) && m.role === 'tool' && m.toolCallId === id,
    );
    if (historyIndex < 0) continue;
    const message = history[historyIndex] as Record<string, unknown>;
    const toolName = str(message.toolName);
    if (toolName === undefined) continue;
    const distance = history
      .slice(historyIndex + 1)
      .filter((m) => isRecord(m) && m.role === 'user').length;
    if (distance < 1) continue;
    const reading = readEmptiness(message.content, toolName, ctx.declarations, false);
    reads.push({
      fact: {
        toolName,
        toolCallId: id,
        distance,
        windowed,
        emptiness: reading.emptiness,
        ...(reading.rows !== undefined && { rows: reading.rows }),
        ...(reading.source !== undefined && { emptinessSource: reading.source }),
        pointers: [at(witness, 'sourceId'), historyAt(historyIndex, '/toolName', id)],
      },
      witness,
      historyIndex,
      reading,
    });
  }
  // Newest first: the result nearest the current question.
  reads.sort((a, b) => b.historyIndex - a.historyIndex);
  return {
    all: reads,
    listed: reads.slice(0, MAX_IN_VIEW),
    more: Math.max(0, reads.length - MAX_IN_VIEW),
  };
}
