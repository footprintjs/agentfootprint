import { str } from './record.js';
import {
  historyStartsWith,
  readHistoryCalls,
  uniqueHistoryCall,
  type HistoryCall,
} from './history.js';

interface RecordedEvent {
  readonly index: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, unknown>>;
}

export interface CallOccurrence<E extends RecordedEvent> {
  readonly providerId: string;
  readonly runtimeStageId?: string;
  readonly order: number;
  readonly start?: E;
  readonly end?: E;
  readonly history?: HistoryCall;
  eventsOf(type: string): readonly E[];
}

interface Bracket<E> {
  readonly providerId: string;
  readonly execution?: string;
  readonly runtimeStageId?: string;
  readonly start?: E;
  readonly end?: E;
}

const kind = (type: string): string => type.replace(/^agentfootprint\./, '');
const CALL_START = 'stream.tool_start';
const CALL_END = 'stream.tool_end';
const HISTORY = 'agent.iteration_end';
const RELATED = new Set([
  'artifacts.presented',
  'tools.absent',
  'tools.coverage_declared',
  'tools.semantics_declared',
  'findings.declared',
  'middleware.decision',
  'checkin.decision',
  'permission.check',
]);

function stageOf(event: RecordedEvent): string | undefined {
  const stage = str(event.meta.runtimeStageId);
  return stage === 'unknown#0' ? undefined : stage;
}

function executionOf(event: RecordedEvent): string | undefined {
  const stage = stageOf(event);
  return stage === undefined ? undefined : JSON.stringify([str(event.meta.runId) ?? null, stage]);
}

const firstIndex = (bracket: Bracket<RecordedEvent>): number =>
  Math.min(bracket.start?.index ?? Infinity, bracket.end?.index ?? Infinity);

function bracketsOf<E extends RecordedEvent>(events: readonly E[]): readonly Bracket<E>[] {
  const groups = new Map<
    string,
    { readonly key: string; readonly stage: string; readonly id: string; starts: E[]; ends: E[] }
  >();
  const brackets: Bracket<E>[] = [];
  for (const event of events) {
    const role = kind(event.type);
    if (role !== CALL_START && role !== CALL_END) continue;
    const id = str(event.payload.toolCallId);
    if (id === undefined) continue;
    const end = role === CALL_END;
    const stage = stageOf(event);
    const execution = executionOf(event);
    if (stage === undefined || execution === undefined) {
      brackets.push({ providerId: id, ...(end ? { end: event } : { start: event }) });
      continue;
    }
    const key = JSON.stringify([execution, id]);
    const group = groups.get(key) ?? {
      key: execution,
      stage,
      id,
      starts: [],
      ends: [],
    };
    (end ? group.ends : group.starts).push(event);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    let nextStart = 0;
    for (const end of group.ends) {
      const pending = group.starts[nextStart];
      const start = pending !== undefined && pending.index < end.index ? pending : undefined;
      if (start !== undefined) nextStart++;
      brackets.push({
        providerId: group.id,
        execution: group.key,
        runtimeStageId: group.stage,
        ...(start !== undefined && { start }),
        end,
      });
    }
    for (const start of group.starts.slice(nextStart)) {
      brackets.push({
        providerId: group.id,
        execution: group.key,
        runtimeStageId: group.stage,
        start,
      });
    }
  }
  return brackets.sort((a, b) => firstIndex(a) - firstIndex(b));
}

function historyRanges(events: readonly RecordedEvent[], final: readonly unknown[]) {
  const ranges = new Map<string, { from: number; to: number }>();
  let from = 0;
  for (const event of events) {
    if (kind(event.type) !== HISTORY) continue;
    const execution = executionOf(event);
    const projection: unknown = event.payload.history;
    if (
      execution === undefined ||
      !Array.isArray(projection) ||
      projection.length <= from ||
      !historyStartsWith(final, projection)
    ) {
      continue;
    }
    ranges.set(execution, { from: ranges.get(execution)?.from ?? from, to: projection.length });
    from = projection.length;
  }
  return ranges;
}

function historyLinks<E extends RecordedEvent>(
  brackets: readonly Bracket<E>[],
  events: readonly E[],
  history: readonly unknown[],
): ReadonlyMap<Bracket<E>, HistoryCall> {
  const calls = readHistoryCalls(history);
  const ranges = historyRanges(events, history);
  const links = new Map<Bracket<E>, HistoryCall>();
  const byId = new Map<string, Bracket<E>[]>();
  for (const bracket of brackets) {
    const group = byId.get(bracket.providerId) ?? [];
    group.push(bracket);
    byId.set(bracket.providerId, group);
  }
  const matchName = (bracket: Bracket<E>, call: HistoryCall): boolean => {
    const name = str(bracket.start?.payload.toolName ?? bracket.end?.payload.toolName);
    return name === undefined || call.toolName === undefined || name === call.toolName;
  };
  for (const [id, occurrences] of byId) {
    for (const bracket of occurrences) {
      if (bracket.end === undefined) continue;
      const range = bracket.execution === undefined ? undefined : ranges.get(bracket.execution);
      if (range !== undefined) {
        const ends = occurrences.filter((b) => b.end && b.execution === bracket.execution);
        const candidates = calls.filter(
          (c) => c.providerId === id && c.index >= range.from && c.index < range.to,
        );
        const candidate = candidates[ends.indexOf(bracket)];
        if (
          candidate !== undefined &&
          ends.length === candidates.length &&
          ends.every((b, i) => {
            const paired = candidates[i];
            return paired !== undefined && matchName(b, paired);
          })
        ) {
          links.set(bracket, candidate);
          continue;
        }
      }
      const unique = occurrences.length === 1 ? uniqueHistoryCall(calls, id) : undefined;
      if (unique !== undefined && matchName(bracket, unique)) links.set(bracket, unique);
    }
  }
  return links;
}

function associatedEvents<E extends RecordedEvent>(
  brackets: readonly Bracket<E>[],
  events: readonly E[],
): ReadonlyMap<Bracket<E>, ReadonlyMap<string, readonly E[]>> {
  const byId = new Map<string, Bracket<E>[]>();
  for (const bracket of brackets) {
    const group = byId.get(bracket.providerId) ?? [];
    group.push(bracket);
    byId.set(bracket.providerId, group);
  }
  const linked = new Map<Bracket<E>, Map<string, E[]>>();
  for (const event of events) {
    const type = kind(event.type);
    if (!RELATED.has(type)) continue;
    const execution = executionOf(event);
    const id = str(event.payload.toolCallId);
    if (id === undefined && type !== 'permission.check') continue;
    const candidates = id === undefined ? brackets : byId.get(id) ?? [];
    const inExecution = candidates.filter((b) => b.execution === execution);
    const inBracket = inExecution.filter(
      (b) =>
        event.index > (b.start?.index ?? -Infinity) && event.index < (b.end?.index ?? Infinity),
    );
    const matching =
      id === undefined
        ? inBracket.filter((b) => b.start?.payload.toolName === event.payload.target)
        : inBracket;
    let bracket = matching.length === 1 ? matching[0] : undefined;
    if (bracket === undefined && id !== undefined && type !== 'artifacts.presented') {
      if (inExecution.length === 1) bracket = inExecution[0];
      else if (type === 'findings.declared' && inExecution.length > 1 && matching.length === 0) {
        bracket = inExecution.find((b) => (b.start?.index ?? -Infinity) > event.index);
      } else if (
        candidates.length === 1 &&
        inExecution.length === 0 &&
        (execution === undefined || candidates[0]?.execution === undefined)
      ) {
        // Legacy auxiliary events can have their own emitter; only an otherwise
        // unique call can read one without an execution-local address.
        bracket = candidates[0];
      }
    }
    if (bracket === undefined) continue;
    const families = linked.get(bracket) ?? new Map<string, E[]>();
    const rows = families.get(type) ?? [];
    rows.push(event);
    families.set(type, rows);
    linked.set(bracket, families);
  }
  return linked;
}

/** Pair the k-th start with the k-th end for one ID and execution. */
export function readCallOccurrences<E extends RecordedEvent>(
  events: readonly E[],
  history: readonly unknown[],
): readonly CallOccurrence<E>[] {
  const brackets = bracketsOf(events);
  const links = historyLinks(brackets, events, history);
  const associated = associatedEvents(brackets, events);
  const counts = new Map<string, number>();
  return brackets.map((bracket) => {
    const key = bracket.execution ?? JSON.stringify(['unpaired', firstIndex(bracket)]);
    const order = counts.get(key) ?? 0;
    counts.set(key, order + 1);
    const committed = links.get(bracket);
    return {
      providerId: bracket.providerId,
      order,
      ...(bracket.runtimeStageId !== undefined && { runtimeStageId: bracket.runtimeStageId }),
      ...(bracket.start !== undefined && { start: bracket.start }),
      ...(bracket.end !== undefined && { end: bracket.end }),
      ...(committed !== undefined && { history: committed }),
      eventsOf: (type) => associated.get(bracket)?.get(kind(type)) ?? [],
    };
  });
}
