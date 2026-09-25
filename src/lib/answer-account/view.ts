/**
 * `recordingView` — ONE indexed pass over a recording, filtered to THIS run.
 *
 * Every reader of the account asks the view, never the raw `events` array, so
 * "which event is where" has one owner (and `failureCauses`, when it ships,
 * reuses it).
 *
 * Whose events: the rule `bridge/eventMeta.ts` · `eventBelongsToRun` owns (an
 * event that names a run belongs to that run; one that names none, to runs of
 * its session). The run is identified by the agentfootprint run id — NOT
 * `snapshot.runId`, which is footprintjs's executor id and a different id space
 * (filtering on it would drop every event). In order:
 *   1. `options.runId` — the stored artifact's `meta.origin.runId`;
 *   2. else the one run id on the recording's `agent.run_configured` events;
 *   3. with more than one (a shared-agent recording made before runs kept their
 *      own events): the run that owns `turn_end` — never simply the first;
 *   4. with none of these, NOTHING is filtered and `scope` says `'unfiltered'`.
 *
 * Tolerance: an event that is not an object with a string `type` and an object
 * `payload` is passed over and counted in `unread`. Indices are the RECORDING's
 * indices, so a pointer lands on the event the reader can open.
 */

import { eventBelongsToRun } from '../../bridge/eventMeta.js';

/** An event of the run, narrowed to what a reader may touch, at its recording index. */
export interface ViewEvent {
  readonly index: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, unknown>>;
}

export interface RecordingView {
  /** This run's events, in recording order. */
  readonly events: readonly ViewEvent[];
  /** The run id the filter keyed on (absent when `scope` is `'unfiltered'`). */
  readonly runId?: string;
  readonly sessionId?: string;
  readonly scope: 'own-run' | 'unfiltered';
  /** Events of another run — never read. */
  readonly foreign: number;
  /** Events passed over because their shape did not fit. */
  readonly unread: number;
  /** `snapshot.sharedState`, when it is an object. */
  readonly state?: Readonly<Record<string, unknown>>;
  /** Every event of one type (the agentfootprint prefix is optional). */
  ofType(type: string): readonly ViewEvent[];
  first(type: string): ViewEvent | undefined;
  last(type: string): ViewEvent | undefined;
}

const PREFIX = 'agentfootprint.';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

interface RawEvent {
  readonly index: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
}

function narrow(events: unknown): { readonly raw: RawEvent[]; readonly unread: number } {
  const raw: RawEvent[] = [];
  let unread = 0;
  if (!Array.isArray(events)) return { raw, unread };
  events.forEach((event: unknown, index) => {
    if (isRecord(event) && typeof event.type === 'string' && isRecord(event.payload)) {
      raw.push({
        index,
        type: event.type,
        payload: event.payload,
        meta: isRecord(event.meta) ? event.meta : {},
      });
    } else {
      unread += 1;
    }
  });
  return { raw, unread };
}

const CONFIGURED = `${PREFIX}agent.run_configured`;
const TURN_END = `${PREFIX}agent.turn_end`;

/** Pick the run id by the documented order; `undefined` = none is known. */
function chooseRunId(raw: readonly RawEvent[], given: string | undefined): string | undefined {
  if (given !== undefined && given.length > 0) return given;
  const configured = [
    ...new Set(
      raw
        .filter((e) => e.type === CONFIGURED)
        .map((e) => str(e.meta.runId))
        .filter((id): id is string => id !== undefined),
    ),
  ];
  if (configured.length === 1) return configured[0];
  if (configured.length === 0) return undefined;
  const owner = str(raw.find((e) => e.type === TURN_END)?.meta.runId);
  return owner !== undefined && configured.includes(owner) ? owner : undefined;
}

export function recordingView(
  recording: { readonly events?: unknown; readonly snapshot?: unknown },
  options: { readonly runId?: string } = {},
): RecordingView {
  const { raw, unread } = narrow(recording.events);
  const runId = chooseRunId(raw, options.runId);
  const sessionId =
    runId === undefined
      ? undefined
      : str(raw.find((e) => e.type === CONFIGURED && e.meta.runId === runId)?.meta.sessionId);
  const own =
    runId === undefined
      ? raw
      : raw.filter((e) =>
          eventBelongsToRun(
            {
              ...(str(e.meta.runId) !== undefined && { runId: str(e.meta.runId) }),
              ...(str(e.meta.sessionId) !== undefined && { sessionId: str(e.meta.sessionId) }),
            },
            { runId, ...(sessionId !== undefined && { sessionId }) } as Parameters<
              typeof eventBelongsToRun
            >[1],
          ),
        );
  const byType = new Map<string, ViewEvent[]>();
  for (const event of own) {
    const list = byType.get(event.type) ?? [];
    list.push(event);
    byType.set(event.type, list);
  }
  const full = (type: string): string => (type.startsWith(PREFIX) ? type : `${PREFIX}${type}`);
  const ofType = (type: string): readonly ViewEvent[] => byType.get(full(type)) ?? [];
  const snapshot = isRecord(recording.snapshot) ? recording.snapshot : undefined;
  const state = snapshot && isRecord(snapshot.sharedState) ? snapshot.sharedState : undefined;
  return {
    events: own,
    ...(runId !== undefined && { runId }),
    ...(sessionId !== undefined && { sessionId }),
    scope: runId === undefined ? 'unfiltered' : 'own-run',
    foreign: raw.length - own.length,
    unread,
    ...(state !== undefined && { state }),
    ofType,
    first: (type) => ofType(type)[0],
    last: (type) => {
      const list = ofType(type);
      return list[list.length - 1];
    },
  };
}
