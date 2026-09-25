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
 * never judged on a withheld result.
 */

import { servedToModel } from '../../../core/agent/coverage/read.js';
import type { RecordPointer, ToolCallFact } from '../types.js';
import { isRecord, str, type ViewEvent } from '../view.js';
import {
  at,
  derived,
  historyAt,
  historyOf,
  readEmptiness,
  type EmptinessReading,
  type ReadContext,
} from './common.js';

/** A text value a call's FACT carries is cut here (the sentence that prints it carries up to 2,000). */
export const FACT_TEXT_CHARS = 200;

/** At most this many calls are listed; the rest are counted. */
export const MAX_CALLS = 50;
/** At most this many items per coverage section per call; the rest are counted. */
export const MAX_ITEMS = 30;

export type CoverageSectionKey = 'checked' | 'notChecked' | 'cannotCover';

export interface CoverageItemRead {
  readonly section: CoverageSectionKey;
  readonly what: string;
  readonly short?: string;
  readonly kind?: 'existence' | 'scope';
  /** Pointer base: the item on its event. */
  readonly event: ViewEvent;
  readonly position: number;
}

export interface CoverageRead {
  readonly kind: 'absent' | 'coverage';
  readonly events: readonly ViewEvent[];
  readonly lookedFor?: { readonly text: string; readonly event: ViewEvent };
  readonly items: readonly CoverageItemRead[];
  /** Items past `MAX_ITEMS`, per section. */
  readonly omitted: Readonly<Record<CoverageSectionKey, number>>;
  readonly tryInsteadTool?: { readonly tool: string; readonly event: ViewEvent };
}

/** One call, as the row readers need it (the fact plus the events behind it). */
export interface CallRead {
  readonly fact: ToolCallFact;
  readonly start?: ViewEvent;
  readonly end?: ViewEvent;
  /** The decision or permission row that refused / withheld it. */
  readonly ruleEvent?: ViewEvent;
  readonly coverage?: CoverageRead;
  readonly emptiness: EmptinessReading;
  readonly findings?: ViewEvent;
  /** Where the tool's NAME is on the record (its start, its declaration, or its history message). */
  readonly toolPointer?: RecordPointer;
}

export interface CallsRead {
  readonly calls: readonly CallRead[];
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

const byCall = (events: readonly ViewEvent[], id: string): ViewEvent[] =>
  events.filter((e) => e.payload.toolCallId === id);

function readCoverage(events: readonly ViewEvent[]): CoverageRead | undefined {
  if (events.length === 0) return undefined;
  const items: CoverageItemRead[] = [];
  const omitted: Record<CoverageSectionKey, number> = { checked: 0, notChecked: 0, cannotCover: 0 };
  let lookedFor: CoverageRead['lookedFor'];
  let tryInsteadTool: CoverageRead['tryInsteadTool'];
  for (const event of events) {
    const lf = str(event.payload.lookedFor);
    if (lookedFor === undefined && lf !== undefined && lf.length > 0)
      lookedFor = { text: lf, event };
    const tit = event.payload.tryInsteadTool;
    if (tryInsteadTool === undefined && isRecord(tit) && typeof tit.tool === 'string') {
      tryInsteadTool = { tool: tit.tool, event };
    }
    for (const section of SECTIONS) {
      const list = event.payload[section];
      if (!Array.isArray(list)) continue;
      list.forEach((item: unknown, position) => {
        if (!isRecord(item) || typeof item.what !== 'string') return;
        const listed = items.filter((i) => i.section === section).length;
        if (listed >= MAX_ITEMS) {
          omitted[section] += 1;
          return;
        }
        const short =
          typeof item.short === 'string' && item.short.trim().length > 0 ? item.short : undefined;
        const kind =
          section !== 'checked' && (item.kind === 'existence' || item.kind === 'scope')
            ? item.kind
            : undefined;
        items.push({
          section,
          what: item.what,
          ...(short !== undefined && { short }),
          ...(kind !== undefined && { kind }),
          event,
          position,
        });
      });
    }
  }
  const kind = events.some((e) => e.type.endsWith('tools.absent')) ? 'absent' : 'coverage';
  return {
    kind,
    events,
    ...(lookedFor !== undefined && { lookedFor }),
    items,
    omitted,
    ...(tryInsteadTool !== undefined && { tryInsteadTool }),
  };
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

interface Outcome {
  readonly outcome: ToolCallFact['outcome'];
  readonly refusedBy?: string;
  readonly withheldBy?: string;
  readonly ruleEvent?: ViewEvent;
}

function outcomeOf(
  ctx: ReadContext,
  id: string,
  toolName: string,
  start?: ViewEvent,
  end?: ViewEvent,
): Outcome {
  const decisions = byCall(ctx.view.ofType('middleware.decision'), id);
  const beforeDeny = decisions.find(
    (e) => e.payload.moment === 'before-tool' && e.payload.outcome === 'deny',
  );
  const afterDeny = decisions.find(
    (e) => e.payload.moment === 'after-tool' && e.payload.outcome === 'deny',
  );
  const permissionDeny = permissionRows(ctx, toolName, start, end).find(
    (e) => typeof e.payload.result === 'string' && e.payload.result !== 'allow',
  );
  const checkInDeclined = byCall(ctx.view.ofType('checkin.decision'), id).find(
    (e) => e.payload.approved === false,
  );
  const pausedId = str(ctx.view.state?.pausedToolCallId);
  const isPausedCall =
    ctx.resumedLeg && ((pausedId !== undefined && pausedId === id) || start === undefined);

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

function viewOf(end: ViewEvent): ToolCallFact['view'] {
  if (!('modelResult' in end.payload)) return 'result';
  return deepEqual(servedToModel(end.payload.result), end.payload.modelResult)
    ? 'model-result-record-only'
    : 'model-result';
}

function readOne(ctx: ReadContext, id: string): CallRead | undefined {
  const start = byCall(ctx.view.ofType('stream.tool_start'), id)[0];
  const ends = byCall(ctx.view.ofType('stream.tool_end'), id);
  const end = ends[ends.length - 1];
  const coverageEvents = [
    ...byCall(ctx.view.ofType('tools.absent'), id),
    ...byCall(ctx.view.ofType('tools.coverage_declared'), id),
  ];
  const coverage = readCoverage(coverageEvents);
  const tool = toolNameFor(ctx, id, start, coverage);
  if (tool === undefined) return undefined;
  const toolName = tool.name;
  const outcome = outcomeOf(ctx, id, toolName, start, end);
  const judged = outcome.outcome === 'ran' && outcome.withheldBy === undefined && end !== undefined;
  const emptiness: EmptinessReading = judged
    ? readEmptiness(
        'modelResult' in end.payload ? end.payload.modelResult : end.payload.result,
        toolName,
        ctx.declarations,
        end.payload.status === 'absent' || coverage?.kind === 'absent',
      )
    : { emptiness: 'unknown', undeclaredShape: false };
  const findings = byCall(ctx.view.ofType('findings.declared'), id)[0];
  const basis = str(findings?.payload.basis);
  const expect = str(findings?.payload.expect);
  const pointers: RecordPointer[] = [tool.pointer, ...(end ? [endPointer(end, emptiness)] : [])];
  const fact: ToolCallFact = {
    toolCallId: id,
    toolName,
    outcome: outcome.outcome,
    ...(outcome.refusedBy !== undefined && { refusedBy: outcome.refusedBy }),
    ...(outcome.withheldBy !== undefined && { withheldBy: outcome.withheldBy }),
    emptiness: emptiness.emptiness,
    ...(emptiness.rows !== undefined && { rows: emptiness.rows }),
    ...(emptiness.source !== undefined && { emptinessSource: emptiness.source }),
    ...(judged && { view: viewOf(end) }),
    ...(coverage !== undefined && {
      coverage: {
        kind: coverage.kind,
        ...(coverage.lookedFor !== undefined && {
          lookedFor: coverage.lookedFor.text.slice(0, FACT_TEXT_CHARS),
        }),
        checked:
          coverage.items.filter((i) => i.section === 'checked').length + coverage.omitted.checked,
        notChecked:
          coverage.items.filter((i) => i.section === 'notChecked').length +
          coverage.omitted.notChecked,
        cannotCover:
          coverage.items.filter((i) => i.section === 'cannotCover').length +
          coverage.omitted.cannotCover,
        kinds: coverage.items.filter((i) => i.kind !== undefined).length,
        ...(coverage.tryInsteadTool !== undefined && {
          tryInsteadTool: coverage.tryInsteadTool.tool,
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
    emptiness,
    ...(findings !== undefined && { findings }),
    toolPointer: tool.pointer,
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
  const calls = ids.flatMap((id) => {
    const read = readOne(ctx, id);
    return read ? [read] : [];
  });
  return {
    calls: calls.slice(0, MAX_CALLS),
    omitted: Math.max(0, calls.length - MAX_CALLS),
    ids: new Set(ids),
  };
}

/** The declaration's head: its tool name when the row holds one, else the call id it was joined by. */
export function coverageHead(coverage: CoverageRead): RecordPointer {
  const named = coverage.events.find((e) => typeof e.payload.toolName === 'string');
  return named !== undefined
    ? at(named, 'toolName')
    : at(coverage.events[0] as ViewEvent, 'toolCallId');
}

/** Pointer to one coverage item's leaf. */
export const itemAt = (item: CoverageItemRead, field: 'what' | 'short' | 'kind'): RecordPointer =>
  at(item.event, item.section, item.position, field);
