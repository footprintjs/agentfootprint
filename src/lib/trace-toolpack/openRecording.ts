/**
 * openRecording — a saved run, reopened as evidence a model can navigate.
 *
 * Pattern: pure adapter. One shape in (`Recording`), one shape out
 *          (`TraceToolpackArtifacts`). No engine, no agent, no I/O.
 * Role:    the door between the two halves of this library that already
 *          knew about each other's data and had no way to say so.
 *
 * `recordRun(agent)` freezes a run into `{ snapshot, events, structure }` —
 * the shape a viewer reads. The trace toolpack reads a different shape.
 * Until now, a team with a recording on disk from last Tuesday and a
 * question about it had to reassemble the bag by hand, which meant
 * reassembling it differently in every integration and losing the
 * narrative and the events on the way.
 *
 *   const recording = JSON.parse(fs.readFileSync('run.json', 'utf8'));
 *   const tools = traceToolpack(openRecording(recording));
 *   await callTraceTool(tools, 'run_overview');
 *
 * WHAT SURVIVES THE ROUND TRIP, AND WHAT DOES NOT
 * ───────────────────────────────────────────────
 * A recording is JSON. Everything the toolpack needs from the snapshot
 * survives that (the commit log, the execution tree, shared state, the
 * mode discriminants) and so do the events. Two things do not:
 *
 *   - `controlDeps` is a LOOKUP FUNCTION built by a recorder that watched
 *     the run happen. A function does not serialize, and nothing in a
 *     finished recording can rebuild one. So slices opened over a
 *     recording carry the toolpack's existing "⚠ control edges
 *     unavailable" marker — the honest answer, already written.
 *   - The narrative survives only if it was ATTACHED. `recordRun`
 *     deliberately attaches no narrative recorder (see its header), so a
 *     recording made without `narrative()` has none, and `read_narrative`
 *     is simply not mounted. This function lifts it from the snapshot's
 *     recorder rows when it IS there.
 *
 * `structure` — the build-time chart — has no reader in the toolpack: the
 * toolpack navigates what a run DID, and the chart says what it COULD do.
 * It is left on the recording for the viewers that draw it.
 */

import type { RuntimeSnapshot } from 'footprintjs';

import type { AgentfootprintEvent } from '../../events/registry.js';
import type { TraceToolpackArtifacts } from './types.js';

/**
 * The recording shape — structurally the `Recording` that `recordRun`
 * produces, restated here so this module stays a leaf (it must not pull
 * the recorder layer into a pure adapter's import graph). A `Recording`
 * satisfies it by construction.
 */
export interface OpenableRecording {
  readonly snapshot: unknown;
  readonly events?: readonly unknown[];
  readonly structure?: unknown;
}

/** A recorder row as it rides `snapshot.recorders`. */
interface RecorderRow {
  readonly id?: string;
  readonly name?: string;
  readonly data?: unknown;
}

/** The narrative recorder's row: `data` is an array of `{ text, depth }`. */
function narrativeFrom(snapshot: { recorders?: readonly RecorderRow[] }): string[] | undefined {
  const rows = snapshot.recorders;
  if (!Array.isArray(rows)) return undefined;
  for (const row of rows) {
    const data = row?.data;
    if (!Array.isArray(data) || data.length === 0) continue;
    // Identify by SHAPE, not by id. A consumer may attach `narrative({ id })`
    // under any id they like, and a row whose entries carry `text` + `depth`
    // is a narrative whatever it calls itself.
    const first = data[0] as { text?: unknown; depth?: unknown } | undefined;
    if (typeof first?.text !== 'string' || typeof first?.depth !== 'number') continue;
    return (data as { text?: unknown }[]).map((entry) =>
      typeof entry?.text === 'string' ? entry.text : '',
    );
  }
  return undefined;
}

/**
 * Reopen a saved recording as toolpack artifacts.
 *
 * @param recording the `{ snapshot, events, structure }` bundle from
 *                  `recordRun(...).toRecording()` — live, or parsed back
 *                  from JSON.
 * @throws when the recording carries no usable snapshot. A toolpack over
 *         an empty bag would answer every question with "nothing
 *         happened", which is the one answer a debugging session must
 *         never be given by mistake.
 */
export function openRecording(recording: OpenableRecording): TraceToolpackArtifacts {
  const snapshot = recording?.snapshot as
    | (RuntimeSnapshot & { recorders?: readonly RecorderRow[] })
    | undefined;

  if (snapshot === null || typeof snapshot !== 'object') {
    throw new Error(
      'openRecording: this recording has no snapshot. A recording is ' +
        '{ snapshot, events, structure } and the snapshot is the part the trace tools read — ' +
        'without it there is no commit log, no execution tree, and nothing to explain. ' +
        'Produce one with `recordRun(agent)` BEFORE the run and `toRecording()` after it; a ' +
        'bundle assembled by hand after the fact cannot contain one.',
    );
  }
  if (!Array.isArray(snapshot.commitLog) || snapshot.executionTree === undefined) {
    const missing = [
      Array.isArray(snapshot.commitLog) ? undefined : 'commitLog',
      snapshot.executionTree === undefined ? 'executionTree' : undefined,
    ]
      .filter(Boolean)
      .join(' and ');
    throw new Error(
      `openRecording: the snapshot in this recording is missing ${missing} — the trace tools ` +
        'navigate a run by what each step wrote (commitLog) and what each step was ' +
        '(executionTree), so neither is optional. This usually means the object handed in is ' +
        'not a footprintjs run snapshot (a partial log, a UI view model, an older format). ' +
        'The producer is `recordRun(agent).toRecording()`, whose `snapshot` is ' +
        '`agent.getLastSnapshot()` verbatim.',
    );
  }

  const narrative = narrativeFrom(snapshot);
  const events = recording.events;
  return {
    snapshot,
    // controlDeps is deliberately absent — see the header. The toolpack
    // already says "⚠ control edges unavailable" rather than pretending.
    ...(narrative !== undefined && { narrative }),
    ...(Array.isArray(events) && { events: events as readonly AgentfootprintEvent[] }),
  };
}
