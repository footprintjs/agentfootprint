/**
 * The tool calls of THIS run — one `ToolCallFact` each, in call order.
 *
 * Outcome, from typed fields only (never a `why` prose):
 *   - `not-dispatched` — `tool_end.notDispatched` (a batch settled on a pause);
 *   - `declined`       — a person was asked and declined: a before-tool deny on
 *                        the call a RESUMED leg answers (its start is in the
 *                        earlier leg), or a `checkin.decision` with
 *                        `approved: false`;
 *   - `refused`        — BEFORE-tool only: `tool_end.notExecuted`, a deny
 *                        `middleware.decision` with `moment: 'before-tool'`, or a
 *                        `permission.check` for this call that did not allow;
 *   - `failed`         — `tool_end.error`;
 *   - `unknown`        — a start with no recorded end;
 *   - `ran`            — otherwise. An AFTER-tool deny keeps `ran` and sets
 *                        `withheldBy`: the tool ran and the model read the
 *                        rule's refusal (`notExecuted` covers before-tool rules
 *                        only, and its absence proves nothing).
 *
 * Emptiness is read from what the MODEL read — `modelResult ?? result` — and
 * never judged on a withheld result. The reader is the ONE emptiness reader
 * (`core/agent/coverage/emptiness.ts` · `readEmptiness`), handed the door this
 * record holds for the call: its absence (the delivered status, `tools.absent`),
 * its boundary (`tools.coverage_declared`) and its described envelope
 * (`tools.semantics_declared`).
 */

import { strip } from '../../../core/agent/coverage/read.js';
import { v } from '../render.js';
import type { RecordPointer, SentenceVar, ToolCallFact } from '../types.js';
import { isKeptOut, isRecord, keptOut, str, type ViewEvent } from '../view.js';
import {
  at,
  countedFields,
  derived,
  historyAt,
  historyOf,
  readEmptiness,
  rowsAtOf,
  stateAt,
  type EmptinessReading,
  type ReadContext,
} from './common.js';

/** A text value a call's FACT carries is cut here (the sentence that prints it carries up to 2,000). */
export const FACT_TEXT_CHARS = 200;

/**
 * At most this many calls are LISTED in `facts.calls`; the rest are counted.
 * A cap on what is listed, never on what is judged: the checks, the error
 * counts and the withheld count read every call (`CallsRead.all`).
 */
export const MAX_CALLS = 50;

export type CoverageSectionKey = 'checked' | 'notChecked' | 'cannotCover';

export interface CoverageItemRead {
  readonly section: CoverageSectionKey;
  /** The item's words — `''` when the record keeps them out (`keptOut`, below). */
  readonly what: string;
  readonly short?: string;
  readonly kind?: 'existence' | 'scope';
  /**
   * Present and `true` when the record keeps the item's WORDS out (a
   * redaction policy left its placeholder on `what` — under the vocabulary,
   * the value-kind rule, `redaction/knownStrings.ts`): the item exists, with
   * its `kind`, and a reader says its words are kept out, never prints them.
   */
  readonly keptOut?: true;
  /**
   * Pointer base: the declaration that holds the item — its event
   * (`tools.absent` / `tools.coverage_declared`), or, for a call before a
   * pause, its row of the committed `coverageDeclared` state.
   */
  readonly base: (...keys: readonly (string | number)[]) => RecordPointer;
  readonly position: number;
}

export interface CoverageRead {
  readonly kind: 'absent' | 'coverage';
  /** The declaration's events — empty when it was read from the committed state. */
  readonly events: readonly ViewEvent[];
  /** Where the declaration's head is: its tool name when the record holds one, else its call id. */
  readonly head: RecordPointer;
  readonly lookedFor?: { readonly text: string; readonly pointer: RecordPointer };
  /** EVERY declared item — the checks judge them all; the rows print what the item budget allows. */
  readonly items: readonly CoverageItemRead[];
  readonly tryInsteadTool?: { readonly tool: string; readonly pointer: RecordPointer };
}

/** One call, as the row readers need it (the fact plus the events behind it). */
export interface CallRead {
  readonly fact: ToolCallFact;
  readonly start?: ViewEvent;
  readonly end?: ViewEvent;
  /** The decision or permission row that refused / withheld it. */
  readonly ruleEvent?: ViewEvent;
  readonly coverage?: CoverageRead;
  /** The `tools.semantics_declared` row: the described envelope as the record keeps it. */
  readonly described?: ViewEvent;
  readonly emptiness: EmptinessReading;
  readonly findings?: ViewEvent;
  /** Where the tool's NAME is on the record (its start, its declaration, or its history message). */
  readonly toolPointer?: RecordPointer;
  /** The tool's name as a sentence var — clipped at `FACT_TEXT_CHARS`, pointing at the full name. */
  readonly tool: SentenceVar;
  /** The full tool name (`''` when unnamed) — for declaration lookups; never printed unclipped. */
  readonly toolName: string;
  /** No event of the call names its tool — counted as unread, never dropped. */
  readonly unnamed?: true;
}

export interface CallsRead {
  /** EVERY call of this run, in call order — what the checks and counts judge. */
  readonly all: readonly CallRead[];
  /** The first `MAX_CALLS` of them — what `facts.calls` lists. */
  readonly calls: readonly CallRead[];
  /** Calls past `MAX_CALLS`, counted, not listed. */
  readonly omitted: number;
  /** Ids of every call of this run (listed or not) — the in-view reader skips them. */
  readonly ids: ReadonlySet<string>;
}

const SECTIONS: readonly CoverageSectionKey[] = ['checked', 'notChecked', 'cannotCover'];

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** One pass per event type: toolCallId → its events, in recording order. */
type CallIndex = (type: string, id: string) => readonly ViewEvent[];

function indexByCall(ctx: ReadContext): CallIndex {
  const cache = new Map<string, Map<string, ViewEvent[]>>();
  return (type, id) => {
    let byId = cache.get(type);
    if (byId === undefined) {
      byId = new Map();
      for (const e of ctx.view.ofType(type)) {
        const key = str(e.payload.toolCallId);
        if (key === undefined) continue;
        const list = byId.get(key) ?? [];
        list.push(e);
        byId.set(key, list);
      }
      cache.set(type, byId);
    }
    return byId.get(id) ?? [];
  };
}

/** One declaration as a reader meets it: its fields, and where each leaf of it is on the record. */
interface DeclarationSource {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly base: (...keys: readonly (string | number)[]) => RecordPointer;
  readonly absent: boolean;
  /**
   * Whether the record keeps `value` — a leaf of this declaration — out: a
   * redaction policy's placeholder, in a record served under one. Asked of
   * every word before it is read as words.
   */
  readonly isKeptOut: (value: unknown) => boolean;
  /** Whether the record keeps the declaration's top-level `field` out — ASKED before it is read. */
  readonly keptOutField: (field: string) => boolean;
}

/**
 * The ONE reading of a tool's coverage declaration(s) — from its events for a
 * call of this run, or from its rows of the committed `coverageDeclared`
 * state for a call before a pause (`readStateCoverage`). Same fields, same
 * refusals; only the pointer base differs.
 */
function readDeclarations(
  sources: readonly DeclarationSource[],
  events: readonly ViewEvent[],
): CoverageRead | undefined {
  const first = sources[0];
  if (first === undefined) return undefined;
  const items: CoverageItemRead[] = [];
  let lookedFor: CoverageRead['lookedFor'];
  let tryInsteadTool: CoverageRead['tryInsteadTool'];
  for (const { fields, base, isKeptOut: wordsKeptOut, keptOutField } of sources) {
    // What the tool looked for, unless the record keeps those words out (then
    // the account says what it found without them — never the placeholder).
    const lf = keptOutField('lookedFor') ? undefined : str(fields.lookedFor);
    if (lookedFor === undefined && lf !== undefined && lf.length > 0 && !wordsKeptOut(lf))
      lookedFor = { text: lf, pointer: base('lookedFor') };
    const tit = fields.tryInsteadTool;
    if (tryInsteadTool === undefined && isRecord(tit) && typeof tit.tool === 'string') {
      tryInsteadTool = { tool: tit.tool, pointer: base('tryInsteadTool', 'tool') };
    }
    for (const section of SECTIONS) {
      const list = fields[section];
      if (!Array.isArray(list)) continue;
      list.forEach((item: unknown, position) => {
        if (!isRecord(item) || typeof item.what !== 'string') return;
        // The item's words kept out: it still exists, with its kind — said so, never printed.
        const kept = wordsKeptOut(item.what);
        const short =
          !kept && typeof item.short === 'string' && item.short.trim().length > 0
            ? item.short
            : undefined;
        // `kind` is refused on `checked` (a checked item is not a limit), read-never-repaired:
        // a hand-built envelope that puts one there gets no kind, no chip and no signal.
        const kind =
          section !== 'checked' && (item.kind === 'existence' || item.kind === 'scope')
            ? item.kind
            : undefined;
        items.push({
          section,
          what: kept ? '' : item.what,
          ...(short !== undefined && { short }),
          ...(kind !== undefined && { kind }),
          ...(kept && { keptOut: true as const }),
          base,
          position,
        });
      });
    }
  }
  const named = sources.find((src) => typeof src.fields.toolName === 'string');
  return {
    kind: sources.some((src) => src.absent) ? 'absent' : 'coverage',
    events,
    head: named !== undefined ? named.base('toolName') : first.base('toolCallId'),
    ...(lookedFor !== undefined && { lookedFor }),
    items,
    ...(tryInsteadTool !== undefined && { tryInsteadTool }),
  };
}

/**
 * A call's declaration(s) from its events. `served`: the record was served
 * under a redaction policy, so a placeholder in it is words kept out
 * (`view.ts` · `isKeptOut`) — never in any other record, where a tool may
 * have declared that string itself.
 */
function readCoverage(events: readonly ViewEvent[], served: boolean): CoverageRead | undefined {
  return readDeclarations(
    events.map((event) => ({
      fields: event.payload,
      base: (...keys: readonly (string | number)[]) => at(event, ...keys),
      absent: event.type.endsWith('tools.absent'),
      isKeptOut: (value: unknown) => served && isKeptOut(value),
      keptOutField: (field: string) => keptOut(event, field),
    })),
    events,
  );
}

/** The committed state's coverage key: every declaration the run's tools made, tracked. */
export const COVERAGE_STATE_KEY = 'coverageDeclared';

/**
 * A call's declaration as the committed state keeps it — its rows of
 * `coverageDeclared` (tracked state: a limit is a fact about the answer, so it
 * rides every recording, `core/agent/types.ts` · `coverageDeclared`).
 * What a call BEFORE a pause declared is read here: its events are in the
 * earlier leg, its rows are in this record's state.
 */
export function readStateCoverage(
  rows: readonly unknown[],
  toolCallId: string,
  served: boolean,
): CoverageRead | undefined {
  const sources: DeclarationSource[] = [];
  const wordsKeptOut = (value: unknown): boolean => served && isKeptOut(value);
  rows.forEach((row, index) => {
    if (!isRecord(row) || row.toolCallId !== toolCallId) return;
    sources.push({
      fields: row,
      base: (...keys: readonly (string | number)[]) => stateAt(COVERAGE_STATE_KEY, index, ...keys),
      absent: row.kind === 'absence',
      isKeptOut: wordsKeptOut,
      keptOutField: (field: string) => wordsKeptOut(row[field]),
    });
  });
  return readDeclarations(sources, []);
}

function toolNameFor(
  ctx: ReadContext,
  id: string,
  start?: ViewEvent,
  coverage?: CoverageRead,
): { readonly name: string; readonly pointer: RecordPointer } | undefined {
  const fromStart = str(start?.payload.toolName);
  if (start !== undefined && fromStart !== undefined)
    return { name: fromStart, pointer: at(start, 'toolName') };
  const declared = coverage?.events.find((e) => str(e.payload.toolName) !== undefined);
  if (declared !== undefined)
    return { name: str(declared.payload.toolName) as string, pointer: at(declared, 'toolName') };
  const history = historyOf(ctx.view);
  const index = history.findIndex(
    (m) => isRecord(m) && m.toolCallId === id && typeof m.toolName === 'string',
  );
  if (index < 0) return undefined;
  const message = history[index] as Record<string, unknown>;
  return { name: message.toolName as string, pointer: historyAt(index, '/toolName', id) };
}

/** The permission rows between this call's start and end that name its tool. */
function permissionRows(
  ctx: ReadContext,
  toolName: string,
  start?: ViewEvent,
  end?: ViewEvent,
): ViewEvent[] {
  if (start === undefined) return [];
  const upTo = end?.index ?? Number.POSITIVE_INFINITY;
  return ctx.view
    .ofType('permission.check')
    .filter((e) => e.index > start.index && e.index < upTo && e.payload.target === toolName);
}

/** The permission verdicts that stop a call before it runs. */
export const PERMISSION_REFUSALS: ReadonlySet<unknown> = new Set(['deny', 'halt']);

interface Outcome {
  readonly outcome: ToolCallFact['outcome'];
  readonly refusedBy?: string;
  readonly withheldBy?: string;
  readonly ruleEvent?: ViewEvent;
}

/** The `tool_end` fields that say how a call ended — read by `outcomeOf`. */
const OUTCOME_FIELDS = ['notDispatched', 'notExecuted', 'error'] as const;

function outcomeOf(
  ctx: ReadContext,
  byCall: CallIndex,
  id: string,
  toolName: string,
  start?: ViewEvent,
  end?: ViewEvent,
): Outcome {
  const decisions = byCall('middleware.decision', id);
  const beforeDeny = decisions.find(
    (e) => e.payload.moment === 'before-tool' && e.payload.outcome === 'deny',
  );
  const afterDeny = decisions.find(
    (e) => e.payload.moment === 'after-tool' && e.payload.outcome === 'deny',
  );
  // Only `deny` and `halt` stop a call. `gate_open` lets it run (`core/Agent.ts`: allowed =
  // allow || gate_open), so it is never a refusal.
  const permissionDeny = permissionRows(ctx, toolName, start, end).find((e) =>
    PERMISSION_REFUSALS.has(e.payload.result),
  );
  const checkInDeclined = byCall('checkin.decision', id).find((e) => e.payload.approved === false);
  const pausedId = str(ctx.view.state?.pausedToolCallId);
  const isPausedCall =
    ctx.resumedLeg && ((pausedId !== undefined && pausedId === id) || start === undefined);

  // The record keeps out a field that says how the call ended (a redaction
  // policy's placeholder): how it ended cannot be told, so it is not guessed.
  if (end !== undefined && OUTCOME_FIELDS.some((field) => keptOut(end, field)))
    return { outcome: 'unknown' };
  if (end?.payload.notDispatched !== undefined)
    return { outcome: 'not-dispatched', ruleEvent: end };
  if (checkInDeclined !== undefined) return { outcome: 'declined', ruleEvent: checkInDeclined };
  if (beforeDeny !== undefined && isPausedCall)
    return { outcome: 'declined', ruleEvent: beforeDeny };
  if (beforeDeny !== undefined) {
    const by = str(beforeDeny.payload.middleware);
    return {
      outcome: 'refused',
      ruleEvent: beforeDeny,
      ...(by !== undefined && { refusedBy: by }),
    };
  }
  if (permissionDeny !== undefined) {
    const by = str(permissionDeny.payload.policyRuleId);
    return {
      outcome: 'refused',
      ruleEvent: permissionDeny,
      ...(by !== undefined && { refusedBy: by }),
    };
  }
  if (end?.payload.notExecuted === true) return { outcome: 'refused', ruleEvent: end };
  if (end?.payload.error === true) return { outcome: 'failed' };
  if (end === undefined) return { outcome: 'unknown' };
  const by = str(afterDeny?.payload.middleware);
  return afterDeny !== undefined
    ? { outcome: 'ran', ruleEvent: afterDeny, ...(by !== undefined && { withheldBy: by }) }
    : { outcome: 'ran' };
}

/** The one leaf on `tool_end` that says how the call ended, as the account read it. */
export function endPointer(end: ViewEvent, emptiness: EmptinessReading): RecordPointer {
  if (isRecord(end.payload.notDispatched)) {
    return at(end, 'notDispatched', 'pausedCall', 'toolCallId');
  }
  for (const key of ['notExecuted', 'error', 'status'] as const) {
    if (end.payload[key] !== undefined) return at(end, key);
  }
  return emptiness.emptiness === 'unknown' ? at(end, 'toolCallId') : derived(end, '#emptiness');
}

/**
 * Whether the result the emptiness would be read from is kept out of the
 * record: `modelResult` when the call has one, else `result` (a kept-out
 * field reads as absent, so a kept-out `modelResult` falls to the first arm).
 */
function resultIsKeptOut(end: ViewEvent): boolean {
  if (keptOut(end, 'modelResult')) return true;
  return !('modelResult' in end.payload) && keptOut(end, 'result');
}

function viewOf(end: ViewEvent): ToolCallFact['view'] {
  if (!('modelResult' in end.payload)) return 'result';
  return deepEqual(strip(end.payload.result), end.payload.modelResult)
    ? 'model-result-record-only'
    : 'model-result';
}

function readOne(ctx: ReadContext, byCall: CallIndex, id: string): CallRead {
  const start = byCall('stream.tool_start', id)[0];
  const ends = byCall('stream.tool_end', id);
  const end = ends[ends.length - 1];
  const coverageEvents = [...byCall('tools.absent', id), ...byCall('tools.coverage_declared', id)];
  const coverage = readCoverage(coverageEvents, ctx.view.servedUnderPolicy);
  const described = byCall('tools.semantics_declared', id)[0];
  const named = toolNameFor(ctx, id, start, coverage);
  // A call no event names is still a call: counted as unread, judged, and said to be unnamed.
  if (named === undefined) ctx.noteUnread();
  const toolName = named?.name ?? '';
  const outcome = outcomeOf(ctx, byCall, id, toolName, start, end);
  const judged = outcome.outcome === 'ran' && outcome.withheldBy === undefined && end !== undefined;
  // The door THIS record holds for the call — its events — decides what was declared; a marker
  // in the bytes the run did not recognize (an envelope returned as JSON text) is plain data.
  // A result the record keeps out (a redaction policy left its placeholder
  // there — `view.ts` · `keptOut`) is not judged: whether it was empty cannot be
  // read, and the account says why instead of reading the placeholder.
  const resultKeptOut = judged && resultIsKeptOut(end);
  const emptiness: EmptinessReading = resultKeptOut
    ? { emptiness: 'unknown', undeclaredShape: false, rowsUnread: 'redacted' }
    : judged
    ? readEmptiness('modelResult' in end.payload ? end.payload.modelResult : end.payload.result, {
        ...(rowsAtOf(ctx.declarations, toolName) !== undefined && {
          rowsAt: rowsAtOf(ctx.declarations, toolName),
        }),
        // A served record's rows key holding the placeholder is kept out, never "no list".
        ...(ctx.view.servedUnderPolicy && { keptOut: isKeptOut }),
        door: {
          absent: end.payload.status === 'absent' || coverage?.kind === 'absent',
          bounded: coverageEvents.some((e) => e.type.endsWith('tools.coverage_declared')),
          ...(described !== undefined && { described: described.payload.semantics }),
        },
      })
    : { emptiness: 'unknown', undeclaredShape: false };
  const findings = byCall('findings.declared', id)[0];
  const basis = str(findings?.payload.basis);
  const expect = str(findings?.payload.expect);
  const idPointer = start ? at(start, 'toolCallId') : end ? at(end, 'toolCallId') : undefined;
  const namePointer = named?.pointer ?? idPointer;
  const pointers: RecordPointer[] = [
    ...(namePointer ? [namePointer] : []),
    ...(end ? [endPointer(end, emptiness)] : []),
  ];
  const fact: ToolCallFact = {
    toolCallId: id.slice(0, FACT_TEXT_CHARS),
    toolName: toolName.slice(0, FACT_TEXT_CHARS),
    ...(named === undefined && { unnamed: true as const }),
    outcome: outcome.outcome,
    ...(outcome.refusedBy !== undefined && { refusedBy: outcome.refusedBy }),
    ...(outcome.withheldBy !== undefined && { withheldBy: outcome.withheldBy }),
    emptiness: emptiness.emptiness,
    ...countedFields(emptiness),
    ...(emptiness.described !== undefined && { described: emptiness.described }),
    ...(emptiness.bounded === true && { bounded: true as const }),
    ...(judged && !resultKeptOut && { view: viewOf(end) }),
    ...(coverage !== undefined && {
      coverage: {
        kind: coverage.kind,
        ...(coverage.lookedFor !== undefined && {
          lookedFor: coverage.lookedFor.text.slice(0, FACT_TEXT_CHARS),
        }),
        checked: coverage.items.filter((i) => i.section === 'checked').length,
        notChecked: coverage.items.filter((i) => i.section === 'notChecked').length,
        cannotCover: coverage.items.filter((i) => i.section === 'cannotCover').length,
        kinds: coverage.items.filter((i) => i.kind !== undefined).length,
        ...(coverage.tryInsteadTool !== undefined && {
          tryInsteadTool: coverage.tryInsteadTool.tool.slice(0, FACT_TEXT_CHARS),
        }),
      },
    }),
    ...(basis !== undefined && {
      expectation: { basis, ...(expect !== undefined && { expect }) },
    }),
    pointers,
  };
  return {
    fact,
    ...(start !== undefined && { start }),
    ...(end !== undefined && { end }),
    ...(outcome.ruleEvent !== undefined && { ruleEvent: outcome.ruleEvent }),
    ...(coverage !== undefined && { coverage }),
    ...(described !== undefined && { described }),
    emptiness,
    ...(findings !== undefined && { findings }),
    ...(namePointer !== undefined && { toolPointer: namePointer }),
    tool: named
      ? v(named.name, 'library', named.pointer, FACT_TEXT_CHARS)
      : v(id, 'library', idPointer, FACT_TEXT_CHARS),
    toolName,
    ...(named === undefined && { unnamed: true as const }),
  };
}

/** Every call of this run, first-seen order (a resumed leg's paused call has only an end). */
export function readCalls(ctx: ReadContext): CallsRead {
  const firstSeen = new Map<string, number>();
  for (const type of ['stream.tool_start', 'stream.tool_end']) {
    for (const e of ctx.view.ofType(type)) {
      const id = str(e.payload.toolCallId);
      if (id !== undefined && !firstSeen.has(id)) firstSeen.set(id, e.index);
    }
  }
  const ids = [...firstSeen.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const byCall = indexByCall(ctx);
  const calls = ids.map((id) => readOne(ctx, byCall, id));
  return {
    all: calls,
    calls: calls.slice(0, MAX_CALLS),
    omitted: Math.max(0, calls.length - MAX_CALLS),
    ids: new Set(ids),
  };
}

/** The declaration's head: its tool name when the row holds one, else the call id it was joined by. */
export function coverageHead(coverage: CoverageRead): RecordPointer {
  return coverage.head;
}

/** Pointer to one coverage item's leaf. */
export const itemAt = (item: CoverageItemRead, field: 'what' | 'short' | 'kind'): RecordPointer =>
  item.base(item.section, item.position, field);
