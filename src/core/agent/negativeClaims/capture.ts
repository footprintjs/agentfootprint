/**
 * Runtime evidence for typed negatives. Only dispatch and native tool returns write here;
 * assistant text, summaries and after-tool rewrites never become observations.
 * Role: core/agent, opt-in. The checker and coverage rules remain their single owners.
 */
import { isDevMode, type TypedScope } from 'footprintjs';
import type { MemoryIdentity } from '../../../memory/identity/types.js';
import type { SearchTool, TurnCall, TurnRecord } from '../../../integrity/negative-claim/types.js';
import { readResultIdentity } from '../../../integrity/claim-binding/capture.js';
import { sameName } from '../../../lib/normalize.js';
import { isJsonFaithful } from '../../../lib/jsonFaithful.js';
import { stableJson } from '../../../lib/stableJson.js';
import { runKeepsOut } from '../../../redaction/runRedaction.js';
import { readSemantics } from '../../../semantics/envelope.js';
import { clockOf } from '../../../time/rows.js';
import { refusalIssues } from '../../../semantics/overclaim.js';
import { readToolResultEnvelope } from '../../../semantics/toolEffects.js';
import { namesFacetOf } from '../../../semantics/coverage/among.js';
import {
  readAbsence,
  readDeclaredAbsence,
  readCoverageLedger,
  readDeclaredLedger,
} from '../../../semantics/coverage/recognize.js';
import type {
  ComposedCoverage,
  ComposedItem,
  CoverageGap,
} from '../../../semantics/coverage/composedCoverage.js';
import { composeChecked } from '../../../semantics/coverage/search/facets.js';
import { readArgument } from '../../../semantics/coverage/search/inEffect.js';
import { hostFillsOf } from '../../../tools/hostFilled.js';
import { searchOf } from '../../../tools/searchOf.js';
import type { Tool, ToolExecutionContext } from '../../../tools/tools.js';
import { readOnlyByDeclaration } from '../../../tools/tools.js';
import type { ToolParty } from '../../slots/buildToolsSlot.js';
import { readEmptiness } from '../emptiness.js';
import { createVerificationState, reserveResultIdentity } from '../findings/verificationState.js';
import type { SearchDispatch } from '../stages/searchCoverage.js';
import type { AgentState } from '../types.js';

export interface NegativeRuntimeCall extends TurnCall {
  readonly trustedContext: boolean;
}

export interface NegativeRuntimeState {
  readonly version: 1;
  readonly turn: number;
  readonly complete: boolean;
  readonly calls: readonly NegativeRuntimeCall[];
  readonly tools: Readonly<Record<string, SearchTool>>;
  readonly pending: readonly string[];
  readonly pausedResultId?: string;
  readonly overclaims: readonly {
    readonly tool: string;
    readonly code: 'refusal-asserts-absence';
    readonly turn: number;
  }[];
  /** Operational carrier only, never served or emitted. */
  readonly ownerIdentity?: MemoryIdentity;
  /** A per-run namespace synthesized with no caller/session/composition identity. */
  readonly anonymousOwner?: true;
}

const MAX_CALLS = 1_000;
const MAX_BYTES = 2_000_000;
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const stateOf = (scope: TypedScope<AgentState>): NegativeRuntimeState | undefined =>
  scope.$getValue('negativeClaimState') as NegativeRuntimeState | undefined;
const sameIdentity = (a: unknown, b: unknown): boolean => {
  try {
    return stableJson(a ?? null) === stableJson(b ?? null);
  } catch {
    return false;
  }
};

export function createNegativeRuntimeState(
  turn: number,
  identity?: MemoryIdentity,
  prior?: NegativeRuntimeState,
  anonymousOwner = false,
): NegativeRuntimeState {
  // A scope-backed object can be a Proxy. Copy this closed tuple through its
  // fields instead of passing a live scope proxy into structuredClone. This
  // is ownership bookkeeping; only actual host fills can prove trusted context.
  const ownerIdentity =
    identity === undefined
      ? undefined
      : {
          conversationId: identity.conversationId,
          ...(identity.tenant !== undefined && { tenant: identity.tenant }),
          ...(identity.principal !== undefined && { principal: identity.principal }),
        };
  const inherited = prior !== undefined && sameIdentity(prior.ownerIdentity, ownerIdentity);
  // Only an explicitly continued anonymous conversation may carry these stale
  // addresses between its per-run namespaces. No earlier payload or scope is
  // transferred, and no named owner can enter this path.
  const anonymousPast =
    !inherited &&
    anonymousOwner &&
    prior?.anonymousOwner === true &&
    ownerIdentity?.tenant === undefined &&
    ownerIdentity?.principal === undefined &&
    prior.ownerIdentity?.tenant === undefined &&
    prior.ownerIdentity?.principal === undefined &&
    turn > prior.turn &&
    prior.calls.every((call) => !call.trustedContext);
  const kept = inherited || anonymousPast;
  return {
    version: 1,
    turn,
    complete: kept ? prior.complete : true,
    calls: inherited ? prior.calls : anonymousPast ? prior.calls.map(staleMetadataOf) : [],
    tools: inherited ? prior.tools : {},
    pending: kept ? prior.pending : [],
    overclaims: inherited ? prior.overclaims ?? [] : [],
    ...(inherited &&
      prior.pausedResultId !== undefined && { pausedResultId: prior.pausedResultId }),
    ...(ownerIdentity !== undefined && { ownerIdentity }),
    ...(anonymousOwner && { anonymousOwner: true }),
  };
}

/** A citation address and date, never an observation that can establish a claim. */
function staleMetadataOf(call: NegativeRuntimeCall): NegativeRuntimeCall {
  return {
    resultId: call.resultId,
    toolName: call.toolName,
    turn: call.turn,
    batch: call.batch,
    dispatched: call.dispatched,
    outcome: call.outcome,
    effect: call.effect,
    arguments: {},
    trustedContext: false,
    keptOut: true,
    ...(call.readAt !== undefined && { readAt: call.readAt }),
    ...(call.row !== undefined && {
      row: {
        kind: call.row.kind,
        toolName: call.toolName,
        iteration: call.batch,
        composed: call.row.composed,
        resultId: call.resultId,
        handle: call.row.handle,
        checked: [],
        notChecked: [],
        cannotCover: [],
        complete: false,
        gaps: [],
      },
    }),
  };
}

function publish(scope: TypedScope<AgentState>, next: NegativeRuntimeState): void {
  try {
    if (JSON.stringify(next).length > MAX_BYTES) {
      const prior = stateOf(scope);
      if (prior !== undefined) scope.negativeClaimState = { ...prior, complete: false };
      return;
    }
    scope.negativeClaimState = next;
  } catch {
    const prior = stateOf(scope);
    if (prior !== undefined) scope.negativeClaimState = { ...prior, complete: false };
  }
}

function replace(
  scope: TypedScope<AgentState>,
  id: string,
  update: (call: NegativeRuntimeCall) => NegativeRuntimeCall,
): void {
  const state = stateOf(scope);
  if (state === undefined) return;
  publish(scope, {
    ...state,
    calls: state.calls.map((call) => (call.resultId === id ? update(call) : call)),
  });
}

export interface NegativeDispatch extends SearchDispatch {
  readonly args: Readonly<Record<string, unknown>>;
  readonly local: boolean;
}

/** Publish the attempt before the tool's code can await, throw or pause. */
export function startNegativeCall(
  scope: TypedScope<AgentState>,
  input: {
    tool: Tool;
    party?: ToolParty;
    args: Readonly<Record<string, unknown>>;
    toolCallId: string;
    iteration: number;
    runId?: string;
    dispatch?: SearchDispatch;
    context: ToolExecutionContext;
  },
): NegativeDispatch {
  const { tool, context } = input;
  const runId = input.runId || 'unidentified-run';
  let dispatch = input.dispatch;
  if (dispatch === undefined) {
    const reserved = reserveResultIdentity(
      scope.resultIdentities ?? createVerificationState(runId),
      runId,
    );
    scope.resultIdentities = reserved.state;
    dispatch = {
      resultId: reserved.id,
      handle: `r${reserved.identity.ordinal}`,
      dispatchedAt: context.time?.dispatchedAt ?? new Date().toISOString(),
    };
  }
  const identity = scope.$getValue('runIdentity') as MemoryIdentity | undefined;
  const state = stateOf(scope) ?? createNegativeRuntimeState(scope.turnNumber, identity);
  let args: Readonly<Record<string, unknown>> = {};
  let keptOut = false;
  try {
    if (!isJsonFaithful(input.args)) keptOut = true;
    args = structuredClone(input.args);
  } catch {
    keptOut = true;
  }
  const remote = tool.source !== undefined || input.party?.channel === 'provider';
  const search = searchOf(tool).search;
  const fills = hostFillsOf(tool);
  const bindings = Object.entries(fills?.identity ?? {});
  const actualIdentity = context.identity as Record<string, unknown> | undefined;
  const expectedIdentity = identity as unknown as Record<string, unknown> | undefined;
  const trustedContext =
    !remote &&
    bindings.length > 0 &&
    bindings.every(
      ([argument, key]) =>
        !Object.hasOwn(args, argument) &&
        typeof actualIdentity?.[key] === 'string' &&
        actualIdentity[key] !== '' &&
        actualIdentity[key] === expectedIdentity?.[key],
    );
  // A privacy rule must never be bypassed by moving evidence into a new carrier.
  keptOut ||= [
    'negativeClaimState',
    'coverageDeclared',
    'toolResults',
    'history',
    'args',
    'result',
    ...Object.keys(args),
  ].some((key) => runKeepsOut(scope, key));
  let composedScope: readonly ComposedItem[] | undefined;
  if (search !== undefined) {
    composedScope = composeChecked({
      search,
      readings: search.arguments.map((arg) => [arg, readArgument(arg, args, fills)] as const),
      period: tool.period,
      dispatchedAt: dispatch.dispatchedAt,
    });
  }
  const call: NegativeRuntimeCall = {
    resultId: dispatch.resultId,
    toolCallId: input.toolCallId,
    toolName: tool.schema.name,
    turn: scope.turnNumber,
    batch: input.iteration,
    dispatched: true,
    outcome: 'error',
    effect: !remote && (search !== undefined || readOnlyByDeclaration(tool)) ? 'read' : 'not-read',
    arguments: keptOut ? {} : args,
    trustedContext,
    ...(composedScope !== undefined && !keptOut && { scope: composedScope }),
    readAt: dispatch.dispatchedAt,
    ...(keptOut && { keptOut: true }),
  };
  if (state.calls.length >= MAX_CALLS) publish(scope, { ...state, complete: false });
  else
    publish(scope, {
      ...state,
      turn: scope.turnNumber,
      calls: [...state.calls, structuredClone(call)],
      pending: [...state.pending, dispatch.resultId],
      tools: {
        ...state.tools,
        [tool.schema.name]: {
          name: tool.schema.name,
          ...(search !== undefined && !keptOut && { search: structuredClone(search) }),
        },
      },
    });
  return { ...dispatch, args, local: !remote };
}

/** Bind a standalone among miss to the actual argument, never its looked-for prose. */
function amongRow(
  call: NegativeRuntimeCall,
  value: unknown,
  handle: string,
  tool: Tool,
): ComposedCoverage | undefined {
  const absence = readAbsence(value);
  if (absence === undefined) return undefined;
  const names = namesFacetOf(absence);
  if (names === undefined) return undefined;
  const sent = call.arguments[names.argument];
  if (
    (typeof sent !== 'string' && typeof sent !== 'number') ||
    !sameName(String(sent), absence.looked_for)
  )
    return undefined;
  const fills = hostFillsOf(tool);
  const host: ComposedItem[] = Object.entries(fills?.identity ?? {}).map(
    ([argument, identity]) => ({
      what: argument,
      facet: 'filter',
      argument,
      value: { identity },
      from: 'host',
    }),
  );
  const gaps: CoverageGap[] = [...(absence.not_checked ?? []), ...(absence.cannot_cover ?? [])].map(
    (gap) => ({
      kind: gap.kind === 'scope' ? 'scope' : 'prose',
      what: gap.what,
      ...(gap.why !== undefined && { why: gap.why }),
      ...((gap as CoverageGap).bears !== undefined && { bears: (gap as CoverageGap).bears }),
    }),
  );
  return {
    kind: 'absence',
    toolName: call.toolName,
    toolCallId: call.toolCallId,
    iteration: call.batch,
    composed: tool.source === undefined ? 'local' : 'remote',
    resultId: call.resultId,
    handle,
    lookedFor: absence.looked_for,
    checked: [
      { what: names.source, facet: 'source', from: 'result' },
      {
        what: names.argument,
        facet: 'population',
        argument: names.argument,
        value: sent,
        from: 'call',
        quote: true,
      },
      { ...names, measuredAt: absence.provenance?.measured_at },
      ...host,
    ],
    notChecked: absence.not_checked ?? [],
    cannotCover: absence.cannot_cover ?? [],
    complete: false,
    gaps,
  };
}

/** Snapshot immediately on native return, before teardown, observers and middleware. */
export function captureNegativeResult(
  scope: TypedScope<AgentState>,
  dispatch: NegativeDispatch,
  value: unknown,
  tool: Tool,
): unknown {
  try {
    if (!isJsonFaithful(value)) {
      keepNegativeResultOut(scope, dispatch.resultId);
      return value;
    }
    const copy = structuredClone(value);
    const keys: string[] = [];
    const visit = (part: unknown): void => {
      if (part === null || typeof part !== 'object') return;
      for (const [key, item] of Object.entries(part)) {
        keys.push(key);
        visit(item);
      }
    };
    visit(copy);
    if (keys.some((key) => runKeepsOut(scope, key))) {
      keepNegativeResultOut(scope, dispatch.resultId);
      return copy;
    }
    const envelope = readToolResultEnvelope(copy);
    const raw = envelope === undefined ? copy : envelope.content;
    const sem = readSemantics(raw);
    const absent = readAbsence(raw) ?? readDeclaredAbsence(raw);
    const ledger = readCoverageLedger(raw) ?? readDeclaredLedger(raw);
    const read = readEmptiness(raw, {
      door: {
        absent: absent !== undefined,
        bounded: ledger !== undefined,
        ...(sem !== undefined && { described: sem }),
      },
    });
    let rows: unknown = sem?.facts ?? sem?.series ?? sem?.edges ?? ledger?.result ?? raw;
    if (!Array.isArray(rows) && record(rows) && Array.isArray(rows.rows)) rows = rows.rows;
    const rowsRead = Array.isArray(rows) && rows.every(record) ? rows : undefined;
    const notRead =
      envelope?.status !== undefined &&
      ['invalid', 'denied', 'failure', 'pending'].includes(envelope.status);
    if (notRead) captureNegativeRefusal(scope, tool.schema.name, raw, dispatch.args);
    replace(scope, dispatch.resultId, (call) => {
      if (call.keptOut) return call;
      const among = amongRow(call, raw, dispatch.handle, tool);
      return {
        ...call,
        outcome: notRead ? 'error' : 'ok',
        emptiness: notRead ? 'unknown' : read.emptiness,
        ...(read.rows !== undefined && { rows: read.rows }),
        ...(rowsRead !== undefined && { rowsRead }),
        ...(among !== undefined && {
          row: { ...among, composed: dispatch.local ? ('local' as const) : ('remote' as const) },
          // A returned absence says what was looked up, not whether this call
          // also wrote. Only the app's dispatch-time declaration exempts it
          // from write invalidation.
          effect: call.effect,
        }),
      };
    });
    return copy;
  } catch {
    replace(scope, dispatch.resultId, (call) => ({ ...call, keptOut: true }));
    return value;
  }
}

export function captureNegativeCoverage(
  scope: TypedScope<AgentState>,
  row: ComposedCoverage,
): void {
  replace(scope, row.resultId, (call) =>
    call.keptOut ? call : { ...call, row: structuredClone(row) },
  );
}

/** Park the native occurrence itself; provider call ids are never a selector. */
export function pauseNegativeCall(scope: TypedScope<AgentState>, resultId: string): void {
  const state = stateOf(scope);
  if (state !== undefined) publish(scope, { ...state, pausedResultId: resultId });
}
export function pausedNegativeResultId(scope: TypedScope<AgentState>): string | undefined {
  return stateOf(scope)?.pausedResultId;
}

/** The terminal bracket settles an attempt; a human answer is not a native observation. */
export function settleNegativeCall(
  scope: TypedScope<AgentState>,
  resultId: string | undefined,
  outcome: TurnCall['outcome'],
): void {
  const state = stateOf(scope);
  if (state === undefined || resultId === undefined) return;
  const { pausedResultId, ...rest } = state;
  publish(scope, {
    ...rest,
    ...(pausedResultId !== undefined && pausedResultId !== resultId && { pausedResultId }),
    pending: state.pending.filter((id) => id !== resultId),
    calls: state.calls.map((c) =>
      c.resultId === resultId
        ? {
            ...c,
            outcome:
              outcome === 'ok' && c.emptiness !== undefined
                ? c.outcome
                : outcome === 'ok'
                ? 'error'
                : outcome,
          }
        : c,
    ),
  });
}

/** Existing semantic recognition, filed as codes only; a refusal never manufactures a read. */
export function captureNegativeRefusal(
  scope: TypedScope<AgentState>,
  tool: string,
  value: unknown,
  args?: Readonly<Record<string, unknown>>,
): void {
  const state = stateOf(scope);
  if (state === undefined) return;
  try {
    const direct = refusalIssues(value, 'result');
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const contextual = Object.entries(args ?? {}).some(
      ([argument, sent]) =>
        refusalIssues(
          { text, argument, ...(typeof sent === 'string' && { value: sent }) },
          'result',
        ).length > 0,
    );
    if (direct.length === 0 && !contextual) return;
    if (state.overclaims.some((row) => row.turn === scope.turnNumber && row.tool === tool)) return;
    if (state.overclaims.length >= MAX_CALLS) {
      publish(scope, { ...state, complete: false });
      return;
    }
    if (isDevMode() && !state.overclaims.some((row) => row.tool === tool)) {
      // eslint-disable-next-line no-console
      console.warn(
        `agentfootprint negative-claims: tool '${tool}' — refusal-asserts-absence; a refusal cannot establish absence.`,
      );
    }
    publish(scope, {
      ...state,
      overclaims: [
        ...state.overclaims,
        { tool, code: 'refusal-asserts-absence', turn: scope.turnNumber },
      ],
    });
  } catch {
    publish(scope, { ...state, complete: false });
  }
}

/** The transform cannot supply evidence; unreadable delivered output also withholds its handle. */
export function keepNegativeResultOut(
  scope: TypedScope<AgentState>,
  resultId: string | undefined,
): void {
  if (resultId !== undefined) replace(scope, resultId, (call) => ({ ...call, keptOut: true }));
}

/** A framework suffix, after transforms/caps. Gap notes and periods survive; inventory names never do. */
export function serveNegativeHandle(
  scope: TypedScope<AgentState>,
  resultId: string | undefined,
  text: string,
): string {
  const call = stateOf(scope)?.calls.find((c) => c.resultId === resultId);
  if (call?.row === undefined || call.keptOut || call.outcome !== 'ok') return text;
  const row = call.row;
  return `${text}\n${JSON.stringify({
    af_search: {
      handle: row.handle,
      gaps: row.gaps,
      notChecked: row.notChecked,
      cannotCover: row.cannotCover,
      ...(row.period !== undefined && { period: row.period }),
      ...(row.inProgress !== undefined && { inProgress: row.inProgress }),
    },
  })}`;
}

export function negativeRecordOf(scope: TypedScope<AgentState>, runId?: string): TurnRecord {
  const state = stateOf(scope);
  const identity = scope.$getValue('runIdentity');
  const ids = scope.resultIdentities;
  let namespace = ids?.evidence.namespace ?? '';
  if (namespace === '' && state?.calls[0] !== undefined) {
    try {
      namespace = readResultIdentity(state.calls[0].resultId).namespace;
    } catch {
      /* unknown */
    }
  }
  const clock = clockOf(scope.findingsLedger);
  const owned = state !== undefined && sameIdentity(state.ownerIdentity, identity);
  return {
    leg: { namespace, runId: runId ?? ids?.evidence.runIds.at(-1) ?? '' },
    turn: scope.turnNumber,
    clock:
      (clock?.turn === scope.turnNumber ? clock.now : undefined) ??
      (Number.isFinite(scope.turnStartMs) ? new Date(scope.turnStartMs).toISOString() : ''),
    calls: owned ? state.calls : [],
    tools: owned ? state.tools : {},
    ledgerComplete: owned && state.complete && state.pending.length === 0,
  };
}
