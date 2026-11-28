/**
 * The tool calls of THIS run — one `ToolCallFact` each, in call order.
 *
 * Outcome, from typed fields only (never a `why` prose):
 *   - `not-dispatched` — `tool_end.notDispatched` (a batch settled on a pause);
 *   - `declined`       — a person was asked and declined: a check-in or a
 *                        middleware answer. Legacy records identify a decline
 *                        by an unphased before-tool denial on the paused call;
 *   - `refused`        — BEFORE-tool only: `tool_end.notExecuted`, a deny
 *                        `middleware.decision` with `moment: 'before-tool'`, or a
 *                        `permission.check` for this call that did not allow;
 *   - `not-executed`   — the tool's function was never entered and no rule
 *                        or person stopped it (`tool_end.entered: false`: an
 *                        unknown tool name, rejected arguments, a blocked
 *                        credential);
 *   - `failed`         — `tool_end.error` on a call whose tool ran
 *                        (`entered: true`);
 *   - `ended-in-error` — `tool_end.error` on a record that does not say
 *                        whether the tool ran (no `entered`: written before
 *                        that field existed) — never told as "it ran";
 *   - `unknown`        — a start with no recorded end;
 *   - `ran`            — otherwise. An AFTER-tool deny keeps `ran` and sets
 *                        `withheldBy`: the tool ran and the model read the
 *                        rule's refusal (`notExecuted` covers before-tool rules
 *                        only, and its absence proves nothing). The recorded
 *                        result status is a separate fact, `reportedStatus`.
 *
 * Emptiness is read from what the MODEL read — `modelResult ?? result` — and
 * never judged on a withheld result. The reader is the ONE emptiness reader
 * (`core/agent/emptiness.ts` · `readEmptiness`), handed the door this
 * record holds for the call: its absence (the delivered status, `tools.absent`),
 * its boundary (`tools.coverage_declared`) and its described envelope
 * (`tools.semantics_declared`).
 */

import {
  declarationOccurrences,
  indexResultRewrites,
  type ResultRewriteIndex,
  readCallOccurrences,
  type CallOccurrence,
  type HistoryCall,
} from '../../core/agent/recordedCalls.js';
import { strip } from '../../semantics/coverage/read.js';
import { readResultShape } from '../../semantics/resultShape.js';
import { deliveredDeclarationDoor } from '../../core/agent/emptiness.js';
import { reportedStatusOf } from '../../semantics/toolOutcome.js';
import { readNotDispatched } from '../../semantics/toolRan.js';
import { v } from '../render.js';
import { outcomeOf } from './callOutcome.js';
import type { RecordPointer, SentenceVar, ToolCallFact } from '../types.js';
import { isKeptOut, isRecord, keptOut, str, type ViewEvent } from '../view.js';
import {
  at,
  countedFields,
  derived,
  FACT_TEXT_CHARS,
  historyAt,
  historyOf,
  readEmptiness,
  rowsAtOf,
  stateAt,
  type EmptinessReading,
  type ReadContext,
} from './common.js';

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
  readonly historyIndex?: number;
  readonly presented?: true;
  readonly start?: ViewEvent;
  readonly end?: ViewEvent;
  /** The decision or permission row that refused / withheld it. */
  readonly ruleEvent?: ViewEvent;
  /** The recorded human approval before a policy recheck refused the call. */
  readonly approvalEvent?: ViewEvent;
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
  /** Committed result positions of the calls linked to this run. */
  readonly historyIndices: ReadonlySet<number>;
  readonly declarationAddresses?: ReadonlyMap<number, number>;
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
 * rides every recording, `core/agent/types/state/records.ts` · `coverageDeclared`).
 * What a call BEFORE a pause declared is read here: its events are in the
 * earlier leg, its rows are in this record's state.
 */
export function readStateCoverage(
  rows: readonly { readonly row: Readonly<Record<string, unknown>>; readonly index: number }[],
  served: boolean,
): CoverageRead | undefined {
  const sources: DeclarationSource[] = [];
  const wordsKeptOut = (value: unknown): boolean => served && isKeptOut(value);
  for (const { row, index } of rows) {
    sources.push({
      fields: row,
      base: (...keys: readonly (string | number)[]) => stateAt(COVERAGE_STATE_KEY, index, ...keys),
      absent: row.kind === 'absence',
      isKeptOut: wordsKeptOut,
      keptOutField: (field: string) => wordsKeptOut(row[field]),
    });
  }
  return readDeclarations(sources, []);
}

function toolNameFor(
  id: string,
  start: ViewEvent | undefined,
  coverage: CoverageRead | undefined,
  history: HistoryCall | undefined,
): { readonly name: string; readonly pointer: RecordPointer } | undefined {
  const fromStart = str(start?.payload.toolName);
  if (start !== undefined && fromStart !== undefined)
    return { name: fromStart, pointer: at(start, 'toolName') };
  const declared = coverage?.events.find((e) => str(e.payload.toolName) !== undefined);
  if (declared !== undefined)
    return { name: str(declared.payload.toolName) as string, pointer: at(declared, 'toolName') };
  const name = history?.toolName;
  return history !== undefined && name !== undefined
    ? { name, pointer: historyAt(history.index, '/toolName', id) }
    : undefined;
}

/** The one leaf on `tool_end` that says how the call ended, as the account read it. */
export function endPointer(end: ViewEvent, emptiness: EmptinessReading): RecordPointer {
  if (readNotDispatched(end.payload.notDispatched) === 'settled') {
    return at(end, 'notDispatched', 'pausedCall', 'toolCallId');
  }
  // A call whose tool never ran: the leaf that says so.
  if (end.payload.notExecuted !== true && end.payload.entered === false) return at(end, 'entered');
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

function readOne(
  ctx: ReadContext,
  occurrence: CallOccurrence<ViewEvent>,
  rewrites: ResultRewriteIndex,
): CallRead {
  const { providerId: id, start, end, eventsOf, history } = occurrence;
  const coverageEvents = [...eventsOf('tools.absent'), ...eventsOf('tools.coverage_declared')];
  const coverage = readCoverage(coverageEvents, ctx.view.servedUnderPolicy);
  const described = eventsOf('tools.semantics_declared')[0];
  const named = toolNameFor(id, start, coverage, history);
  // A call no event names is still a call: counted as unread, judged, and said to be unnamed.
  if (named === undefined) ctx.noteUnread();
  const toolName = named?.name ?? '';
  const outcome = outcomeOf(ctx, occurrence, toolName);
  const status = outcome.outcome === 'ran' ? reportedStatusOf(end?.payload.status) : undefined;
  const judged = outcome.outcome === 'ran' && outcome.withheldBy === undefined && end !== undefined;
  const rewrite =
    judged && typeof occurrence.occurrenceKey === 'string'
      ? rewrites.get(occurrence.occurrenceKey)
      : undefined;
  const rewriteName = rewrite?.kind === 'rewritten' ? rewrite.name : undefined;
  const rewrittenBy =
    rewriteName !== undefined &&
    rewriteName.length > 0 &&
    !(ctx.view.servedUnderPolicy && isKeptOut(rewriteName))
      ? rewriteName.slice(0, FACT_TEXT_CHARS)
      : undefined;
  const declarationDoor = deliveredDeclarationDoor(
    rewrite?.kind === 'rewritten' || history?.message.toolResultDisposition === 'rewritten',
    {
      absent: end?.payload.status === 'absent' || coverage?.kind === 'absent',
      bounded: coverageEvents.some((e) => e.type.endsWith('tools.coverage_declared')),
      ...(described !== undefined && { described: described.payload.semantics }),
    },
  );
  // The door THIS record holds for the call — its events — decides what was declared; a marker
  // in the bytes the run did not recognize (an envelope returned as JSON text) is plain data.
  // A result the record keeps out (a redaction policy left its placeholder
  // there — `view.ts` · `keptOut`) is not judged: whether it was empty cannot be
  // read, and the account says why instead of reading the placeholder.
  const resultKeptOut = judged && resultIsKeptOut(end);
  const evidence = end === undefined ? undefined : ctx.view.toolEventShape?.(end.index);
  const rowsAt = rowsAtOf(ctx.declarations, toolName);
  const emptiness: EmptinessReading = resultKeptOut
    ? { emptiness: 'unknown', undeclaredShape: false, rowsUnread: 'redacted' }
    : judged
    ? evidence !== undefined
      ? readResultShape(evidence, rowsAt)
      : readEmptiness('modelResult' in end.payload ? end.payload.modelResult : end.payload.result, {
          placement: { toolCallId: id, issued: ctx.view.issuedPlacements },
          ...(rowsAt !== undefined && { rowsAt }),
          // A served record's rows key holding the placeholder is kept out, never "no list".
          ...(ctx.view.servedUnderPolicy && { keptOut: isKeptOut }),
          ...(declarationDoor !== undefined && { door: declarationDoor }),
        })
    : { emptiness: 'unknown', undeclaredShape: false };
  const findings = eventsOf('findings.declared')[0];
  const basis = str(findings?.payload.basis);
  const expect = str(findings?.payload.expect);
  const idPointer = start ? at(start, 'toolCallId') : end ? at(end, 'toolCallId') : undefined;
  const namePointer = named?.pointer ?? idPointer;
  const pointers: RecordPointer[] = [
    ...(namePointer ? [namePointer] : []),
    ...(end ? [endPointer(end, emptiness)] : []),
    ...(rewrittenBy !== undefined && rewrite !== undefined
      ? [stateAt('middlewareDecisions', rewrite.index, 'middleware')]
      : []),
  ];
  const fact: ToolCallFact = {
    toolCallId: id.slice(0, FACT_TEXT_CHARS),
    toolName: toolName.slice(0, FACT_TEXT_CHARS),
    ...(named === undefined && { unnamed: true as const }),
    outcome: outcome.outcome,
    ...(status !== undefined && { reportedStatus: status }),
    ...(outcome.refusedBy !== undefined && { refusedBy: outcome.refusedBy }),
    ...(outcome.withheldBy !== undefined && { withheldBy: outcome.withheldBy }),
    ...(rewrittenBy !== undefined && { rewrittenBy }),
    emptiness: emptiness.emptiness,
    ...countedFields(emptiness),
    ...(emptiness.described !== undefined && { described: emptiness.described }),
    ...(emptiness.bounded === true && { bounded: true as const }),
    ...(judged &&
      !resultKeptOut && { view: evidence === undefined ? viewOf(end) : ('result' as const) }),
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
    ...(history !== undefined && { historyIndex: history.index }),
    ...(eventsOf('artifacts.presented').length > 0 && { presented: true as const }),
    ...(start !== undefined && { start }),
    ...(end !== undefined && { end }),
    ...(outcome.ruleEvent !== undefined && { ruleEvent: outcome.ruleEvent }),
    ...(outcome.approvalEvent !== undefined && { approvalEvent: outcome.approvalEvent }),
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
  const occurrences = readCallOccurrences(ctx.view.events, historyOf(ctx.view));
  const ledger =
    occurrences.length > 0 && ctx.view.state !== undefined
      ? (Object.getOwnPropertyDescriptor(ctx.view.state, 'middlewareDecisions')?.value as unknown)
      : undefined;
  const rewrites = indexResultRewrites(ledger);
  const calls = occurrences.map((occurrence) => readOne(ctx, occurrence, rewrites));
  const rows = ctx.view.stateAsRecorded?.coverageDeclared;
  const declarationAddresses = new Map<number, number>();
  if (Array.isArray(rows)) {
    const linked = declarationOccurrences(
      rows,
      ctx.view.events,
      occurrences,
      ctx.view.servedUnderPolicy,
    );
    for (const [index, call] of linked) {
      if (call.history !== undefined) declarationAddresses.set(index, call.history.index);
    }
  }
  return {
    all: calls,
    calls: calls.slice(0, MAX_CALLS),
    omitted: Math.max(0, calls.length - MAX_CALLS),
    ...(declarationAddresses.size > 0 && { declarationAddresses }),
    historyIndices: new Set(
      calls.flatMap((call) => (call.historyIndex === undefined ? [] : [call.historyIndex])),
    ),
  };
}

/** The declaration's head: its tool name when the row holds one, else the call id it was joined by. */
export function coverageHead(coverage: CoverageRead): RecordPointer {
  return coverage.head;
}

/** Pointer to one coverage item's leaf. */
export const itemAt = (item: CoverageItemRead, field: 'what' | 'short' | 'kind'): RecordPointer =>
  item.base(item.section, item.position, field);
