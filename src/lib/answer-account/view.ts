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
 *
 * A REDACTED recording (a run under an agent's `redact`) holds a placeholder
 * where the policy selected a value: `[REDACTED]` for a payload field (or for a
 * whole payload, under `emitPatterns`), and `REDACTED` for a state key. Its
 * snapshot says it was served under a policy (`redaction/marker.ts`); in such
 * a record — and ONLY there; a tool can return the string `'REDACTED'` too —
 * a placeholder is NO value: a field or key that holds one reads as absent,
 * never as a result to judge or a pause to report — and it is NAMED
 * (`ViewEvent.redacted`, `RecordingView.stateKeptOut`), so a fact that would
 * otherwise say "not recorded" can say "kept out" (`keptOut`,
 * `RecordingView.isStateKeptOut`). An event whose whole payload is kept out
 * is still an event of the run: its type and meta are read, its payload is
 * empty.
 *
 * THE GUARD. A reader that touches a kept-out field without asking about it
 * would state a fact about a placeholder ("no tool ran" from a kept-out
 * `toolCallId`). So the view watches: every kept-out field or state key a
 * reader TOUCHES (reads, or tests with `in`) is noted, and so is every one it
 * ASKS about; `keptOutRead()` lists the touched ones never asked about, and
 * the account refuses to tell over them (`account.ts` · `notToldAccount`).
 * An unredacted recording is read through no guard at all.
 */

import { eventBelongsToRun } from '../../bridge/eventMeta.js';
import { isPlaceholder, servedUnderPolicy } from '../../redaction/marker.js';

/** An event of the run, narrowed to what a reader may touch, at its recording index. */
export interface ViewEvent {
  readonly index: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, unknown>>;
  /**
   * What the record keeps out of this payload (a redaction policy left its
   * placeholder there): the names of the fields that hold it, or `'whole'`
   * when the policy kept the whole payload out. A kept-out field reads as
   * absent in `payload`; ask {@link keptOut} before saying a value does not
   * exist. Absent when nothing was kept out.
   */
  readonly redacted?: readonly string[] | 'whole';
}

/**
 * Whether the record keeps `field` of `event`'s payload out (see
 * `ViewEvent.redacted`) — and a reader that asks has handled it, so touching
 * the field afterwards is not a read of a placeholder (the view's guard).
 */
export function keptOut(event: ViewEvent | undefined, field: string): boolean {
  const redacted = event?.redacted;
  if (event === undefined || redacted === undefined) return false;
  noteName(ASKED, event, field);
  return redacted === 'whole' || redacted.includes(field);
}

/** Per event (or per state): the kept-out names a reader touched, and the ones it asked about. */
const TOUCHED = new WeakMap<object, Set<string>>();
const ASKED = new WeakMap<object, Set<string>>();

function noteName(map: WeakMap<object, Set<string>>, owner: object, name: string): void {
  const names = map.get(owner) ?? new Set<string>();
  names.add(name);
  map.set(owner, names);
}

/** `record` behind a guard that notes, on `owner`, every kept-out name a reader touches. */
function guarded<T extends object>(owner: object, record: T, isKept: (name: string) => boolean): T {
  const touch = (key: string | symbol): void => {
    if (typeof key === 'string' && isKept(key)) noteName(TOUCHED, owner, key);
  };
  return new Proxy(record, {
    get: (target, key, receiver) => (touch(key), Reflect.get(target, key, receiver)),
    has: (target, key) => (touch(key), Reflect.has(target, key)),
  });
}

/** The kept-out names `owner`'s readers touched and never asked about. */
function unasked(owner: object): string[] {
  const asked = ASKED.get(owner);
  return [...(TOUCHED.get(owner) ?? [])].filter((name) => asked?.has(name) !== true);
}

/** An event as readers see it: a payload that keeps something out is read through the guard. */
function asViewEvent(event: RawEvent): ViewEvent {
  const redacted = event.redacted;
  if (redacted === undefined) return event;
  const isKept = redacted === 'whole' ? () => true : (name: string) => redacted.includes(name);
  const view: { -readonly [K in keyof ViewEvent]: ViewEvent[K] } = { ...event };
  view.payload = guarded(view, event.payload, isKept);
  return view;
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
  /**
   * The record was SERVED under a redaction policy — its snapshot carries the
   * marker (`redaction/marker.ts`). Only then is a placeholder a value the
   * record keeps out; in any other record it is a value like any other.
   */
  readonly servedUnderPolicy: boolean;
  /** `snapshot.sharedState`, when it is an object — without the keys it keeps out. */
  readonly state?: Readonly<Record<string, unknown>>;
  /** The state keys the record keeps out (they hold the redaction placeholder). */
  readonly stateKeptOut: readonly string[];
  /** Whether the record keeps state `key` out — asking handles it (the view's guard). */
  isStateKeptOut(key: string): boolean;
  /**
   * `snapshot.sharedState` exactly as the record holds it, placeholders and
   * all — for a reader that judges kept-out keys itself (the standing fold,
   * `core/agent/assessment/assess.ts` · `assessAnswer`). Every other reader
   * reads `state`.
   */
  readonly stateAsRecorded?: Readonly<Record<string, unknown>>;
  /**
   * `snapshot.initialState`, when it is an object with a `history` — on a
   * resumed leg, the state the run PAUSED with (a fresh run's is empty). The
   * part of the answer before the pause is read from it
   * (`facts/pausedLeg.ts`).
   */
  readonly pausedWith?: Readonly<Record<string, unknown>>;
  /** Every event of one type (the agentfootprint prefix is optional). */
  ofType(type: string): readonly ViewEvent[];
  /**
   * What readers read but the record keeps out: every kept-out payload field
   * (`<event type> · <field>`) and state key (`state · <key>`) a reader
   * touched without asking about it first (`keptOut`, `isStateKeptOut`). A
   * fact read from one would be a fact about a placeholder. Empty when there
   * is none — always, for a recording nothing was kept out of.
   */
  keptOutRead(): readonly string[];
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
  readonly redacted?: readonly string[] | 'whole';
}

/**
 * Whether `value` is a redaction placeholder — a value the record keeps out.
 * Asked only of a record SERVED under a policy (`redaction/marker.ts` ·
 * `servedUnderPolicy`): anywhere else the same string is a value a tool or a
 * person really produced.
 */
export const isKeptOut = isPlaceholder;

/** The names of `record`'s fields that hold a redaction placeholder. */
function placeholderFields(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => isKeptOut(record[key]));
}

/** `record` without the fields that hold a redaction placeholder — the SAME
 *  object when none does, so an unredacted recording is read as it always was. */
function withoutPlaceholders(record: Record<string, unknown>): Record<string, unknown> {
  const masked = placeholderFields(record);
  if (masked.length === 0) return record;
  return Object.fromEntries(Object.entries(record).filter(([key]) => !masked.includes(key)));
}

/**
 * The run's events, narrowed. `served` — the record was served under a policy
 * (its snapshot carries the marker) — is the only case a placeholder is read
 * as kept out; otherwise every payload is read exactly as before.
 */
function narrow(
  events: unknown,
  served: boolean,
): { readonly raw: RawEvent[]; readonly unread: number } {
  const raw: RawEvent[] = [];
  let unread = 0;
  if (!Array.isArray(events)) return { raw, unread };
  events.forEach((event: unknown, index) => {
    if (!isRecord(event) || typeof event.type !== 'string') {
      unread += 1;
      return;
    }
    const meta = isRecord(event.meta) ? event.meta : {};
    if (isRecord(event.payload)) {
      const redacted = served ? placeholderFields(event.payload) : [];
      raw.push({
        index,
        type: event.type,
        payload: redacted.length > 0 ? withoutPlaceholders(event.payload) : event.payload,
        meta,
        ...(redacted.length > 0 && { redacted }),
      });
    } else if (served && isKeptOut(event.payload)) {
      // The whole payload is kept out (`emitPatterns`): still an event of the run.
      raw.push({ index, type: event.type, payload: {}, meta, redacted: 'whole' });
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
  const snapshot = isRecord(recording.snapshot) ? recording.snapshot : undefined;
  // A placeholder is KEPT OUT only in a record a policy covered — the snapshot says so.
  const served = servedUnderPolicy(snapshot);
  const { raw, unread } = narrow(recording.events, served);
  const runId = chooseRunId(raw, options.runId);
  const sessionId =
    runId === undefined
      ? undefined
      : str(raw.find((e) => e.type === CONFIGURED && e.meta.runId === runId)?.meta.sessionId);
  const narrowed =
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
  const own = narrowed.map(asViewEvent);
  const byType = new Map<string, ViewEvent[]>();
  for (const event of own) {
    const list = byType.get(event.type) ?? [];
    list.push(event);
    byType.set(event.type, list);
  }
  const full = (type: string): string => (type.startsWith(PREFIX) ? type : `${PREFIX}${type}`);
  const ofType = (type: string): readonly ViewEvent[] => byType.get(full(type)) ?? [];
  const recorded = snapshot && isRecord(snapshot.sharedState) ? snapshot.sharedState : undefined;
  const stateKeptOut = recorded !== undefined && served ? placeholderFields(recorded) : [];
  // The state's guard is noted on this object (`TOUCHED` / `ASKED`), as an event's is on the event.
  const stateOwner = {};
  const stripped =
    recorded !== undefined && stateKeptOut.length > 0 ? withoutPlaceholders(recorded) : recorded;
  const state =
    stripped !== undefined && stateKeptOut.length > 0
      ? guarded(stateOwner, stripped, (key) => stateKeptOut.includes(key))
      : stripped;
  const initial = snapshot && isRecord(snapshot.initialState) ? snapshot.initialState : undefined;
  const pausedWith = initial !== undefined && Array.isArray(initial.history) ? initial : undefined;
  return {
    events: own,
    ...(runId !== undefined && { runId }),
    ...(sessionId !== undefined && { sessionId }),
    scope: runId === undefined ? 'unfiltered' : 'own-run',
    foreign: raw.length - own.length,
    unread,
    servedUnderPolicy: served,
    ...(state !== undefined && { state }),
    stateKeptOut,
    isStateKeptOut: (key) => {
      noteName(ASKED, stateOwner, key);
      return stateKeptOut.includes(key);
    },
    ...(recorded !== undefined && { stateAsRecorded: recorded }),
    ...(pausedWith !== undefined && { pausedWith }),
    ofType,
    keptOutRead: () =>
      [
        ...new Set([
          ...own.flatMap((e) => unasked(e).map((name) => `${e.type} · ${name}`)),
          ...unasked(stateOwner).map((key) => `state · ${key}`),
        ]),
      ].sort(),
    first: (type) => ofType(type)[0],
    last: (type) => {
      const list = ofType(type);
      return list[list.length - 1];
    },
  };
}
