import type { LLMMessage } from '../../provider-contract/types.js';
import type { TraceToolpackArtifacts } from '../types.js';
import type { ToolpackIndex } from './packIndex.js';
import { committedFinal } from './valueLines.js';
import { commitValueAt } from 'foottrace';
import type { Tool } from '../../tools/tools.js';
import { defineTool } from '../../tools/tools.js';
import { TOOL_CALL_SUGGESTION_CAP, TOOL_RESULT_PREVIEW_CHARS } from './structuralLimits.js';
import { displayText, renderPreview, boundedPreview } from '../bounded.js';
import { toolRanOf } from '../../semantics/toolRan.js';

// ── inspect_tool_call ──────────────────────────────────────────────────────

/** One conversation turn as it lands in the committed `history` array. */
interface HistoryTurn {
  readonly role?: string;
  readonly content?: unknown;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly {
    readonly id?: string;
    readonly name?: string;
    readonly args?: Record<string, unknown>;
  }[];
  /** `LLMMessage.notDispatched` (9.113.0): this `role: 'tool'` message answers
   *  a call that never ran — the batch settlement wrote it. */
  readonly notDispatched?: SettledMarker;
}

/** The batch settlement's marker as the canonical field defines it. */
type Marker = NonNullable<LLMMessage['notDispatched']>;

/**
 * The same marker as a recording carries it — DERIVED from the canonical
 * `LLMMessage.notDispatched` (the one definition; the brackets' field is typed
 * off it too), every level optional because recorded artifacts are data this
 * reader does not trust. A field added there appears here; one renamed there
 * breaks the reads below at compile time.
 */
type SettledMarker = { readonly [K in keyof Marker]?: Partial<Marker[K]> };

/** A recorded `notDispatched` value read as the marker — `undefined` unless it is an object. */
function markerOf(found: unknown): SettledMarker | undefined {
  return typeof found === 'object' && found !== null ? (found as SettledMarker) : undefined;
}

/** One committed middleware-ledger row (the 8.13.0 ran-with-args evidence). */
interface LedgerRow {
  readonly middleware?: string;
  readonly moment?: string;
  readonly at?: string;
  readonly toolCallId?: string;
  readonly outcome?: string;
  readonly changed?: boolean;
  readonly why?: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

/** What one tool call looks like once the four sources are joined. */
interface ToolCallFacts {
  readonly toolName?: string;
  readonly proposedArgs?: Record<string, unknown>;
  readonly result?: unknown;
  readonly runtimeStageId?: string;
  /**
   * Present when the call was NEVER DISPATCHED (9.113.0): its bracket carries
   * `notDispatched` on the stream, and its `role: 'tool'` message carries
   * `LLMMessage.notDispatched` — the same fact, one definition, two carriers.
   * Its `tool_end` says `durationMs: 0` and carries the library's sentence as
   * its `result` — the bracket of a call that produced no result, never the
   * record of a tool that ran.
   */
  readonly notDispatched?: SettledMarker;
}

/** The joined view of a run's tool calls, shared by the two tools that read it. */
interface ToolCallReader {
  /** Every tool call id this run recorded, in call order, with its name. */
  knownCalls(): { id: string; name: string }[];
  /** The four-source join for one call. */
  factsFor(toolCallId: string): ToolCallFacts;
  /** Committed conversation history, lazily materialised. */
  history(): readonly HistoryTurn[];
  /** The middleware ledger rows for one call (the ran-with-args evidence). */
  rowsFor(toolCallId: string): LedgerRow[];
  /** Typed events of one kind, with their payload + meta lifted. */
  eventsOf(type: string): { payload: Record<string, unknown>; meta: Record<string, unknown> }[];
}

/**
 * Resolve ONE tool call across the four places its evidence lives.
 *
 * A tool call is the most-asked-about thing in an agent run and the most
 * scattered: the model's PROPOSED args are on an assistant turn, the args
 * it actually RAN with are in the middleware ledger (and only when a rule
 * changed them), the result is a `role:'tool'` turn, and the timing exists
 * only in the event stream. Four lookups, one id — so this reader does the
 * join rather than making the model do it in four calls.
 *
 * The proposed/ran-with split is the point. A governance rule that
 * rewrites args is invisible in the conversation: the model reads its own
 * proposal in history and the tool ran on something else. That difference
 * is exactly what "why did it do that?" is often asking about.
 */
function buildToolCallReader(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
): ToolCallReader {
  // All four readers are lazy + memoized: a toolpack that never inspects a
  // tool call pays nothing, and one that inspects five pays once.
  let historyMemo: readonly HistoryTurn[] | undefined;
  const history = (): readonly HistoryTurn[] => {
    if (historyMemo === undefined) {
      const value = committedFinal(index, 'history');
      historyMemo = Array.isArray(value) ? (value as readonly HistoryTurn[]) : [];
    }
    return historyMemo;
  };

  let ledgerMemo: readonly LedgerRow[] | undefined;
  const ledger = (): readonly LedgerRow[] => {
    if (ledgerMemo === undefined) {
      const value = committedFinal(index, 'middlewareDecisions');
      ledgerMemo = Array.isArray(value) ? (value as readonly LedgerRow[]) : [];
    }
    return ledgerMemo;
  };

  const eventsOf = (
    type: string,
  ): { payload: Record<string, unknown>; meta: Record<string, unknown> }[] =>
    (artifacts.events ?? [])
      .filter((event) => event.type === type)
      .map((event) => ({
        payload: (event.payload ?? {}) as unknown as Record<string, unknown>,
        meta: (event.meta ?? {}) as unknown as Record<string, unknown>,
      }));

  /**
   * One call's brackets of one kind, those of a call that RAN first (9.113.0).
   * A settled bracket (`notDispatched`) is no record of a run, so when a
   * provider reused a settled call's id for a call that did run, the STEP is
   * read off the call that ran — never off the settlement's bracket, which
   * stands on the resume step. Tail order within each group, so a tail with
   * no settled bracket reads exactly as it always did. (The outcome and the
   * duration read the LAST `tool_end` for the id instead — see
   * `buildInspectToolCall`.)
   */
  const bracketsFor = (
    type: 'agentfootprint.stream.tool_start' | 'agentfootprint.stream.tool_end',
    toolCallId: string,
  ): { payload: Record<string, unknown>; meta: Record<string, unknown> }[] => {
    const mine = eventsOf(type).filter((event) => event.payload.toolCallId === toolCallId);
    const settled = (event: (typeof mine)[number]) =>
      markerOf(event.payload.notDispatched) !== undefined;
    return [...mine.filter((event) => !settled(event)), ...mine.filter(settled)];
  };

  /** Every tool call id this run recorded, in call order, with its name. */
  let idsMemo: { id: string; name: string }[] | undefined;
  const knownCalls = (): { id: string; name: string }[] => {
    if (idsMemo !== undefined) return idsMemo;
    const byId = new Map<string, string>();
    for (const start of eventsOf('agentfootprint.stream.tool_start')) {
      const id = start.payload.toolCallId;
      if (typeof id === 'string') byId.set(id, String(start.payload.toolName ?? '?'));
    }
    for (const turn of history()) {
      for (const call of turn.toolCalls ?? []) {
        if (typeof call.id === 'string' && !byId.has(call.id)) {
          byId.set(call.id, call.name ?? '?');
        }
      }
      if (typeof turn.toolCallId === 'string' && !byId.has(turn.toolCallId)) {
        byId.set(turn.toolCallId, turn.toolName ?? '?');
      }
    }
    idsMemo = [...byId].map(([id, name]) => ({ id, name }));
    return idsMemo;
  };

  /**
   * Which STEP ran this call. The event tail knows exactly (every event is
   * stamped with its `runtimeStageId`) — a call that RAN before a settlement
   * under the same id (`bracketsFor`); without it, fall back to the first
   * committed step whose `history` carries the call's result — that is the
   * tool-execution step by construction.
   */
  const stepFor = (toolCallId: string): { id?: string; inferred: boolean } => {
    for (const start of bracketsFor('agentfootprint.stream.tool_start', toolCallId)) {
      const id = start.meta.runtimeStageId;
      if (typeof id === 'string') return { id, inferred: false };
    }
    for (let i = 0; i < index.commitLog.length; i++) {
      const bundle = index.commitLog[i];
      if (!bundle.trace.some((entry) => entry.path === 'history')) continue;
      const value = commitValueAt(index.commitLog, i, 'history');
      if (!Array.isArray(value)) continue;
      const landed = (value as readonly HistoryTurn[]).some(
        (turn) => turn.role === 'tool' && turn.toolCallId === toolCallId,
      );
      if (landed) return { id: bundle.runtimeStageId, inferred: true };
    }
    return { inferred: true };
  };

  /**
   * The settlement marker on the LATEST `role: 'tool'` message for the id in
   * `turns` — `undefined` when that message carries none — and whether any
   * message answered the id at all. The latest decides, as it decides the
   * result: a provider may reuse an id across turns.
   */
  const settledIn = (
    turns: readonly HistoryTurn[],
    toolCallId: string,
  ): { answered: boolean; marker?: SettledMarker } => {
    let answered = false;
    let marker: SettledMarker | undefined;
    for (const turn of turns) {
      if (turn.role !== 'tool' || turn.toolCallId !== toolCallId) continue;
      answered = true;
      marker = markerOf(turn.notDispatched);
    }
    return { answered, ...(marker !== undefined && { marker }) };
  };

  /**
   * The marker on the LATEST bracket for the id on the event tail — the
   * stream's own owner of the fact (`ToolStartPayload.notDispatched`,
   * `ToolEndPayload.notDispatched`, 9.113.0). `undefined` when the tail holds
   * no bracket for the id or the latest one carries no marker: the latest
   * decides, as it does in history, because a provider may reuse an id.
   */
  const settledOnStream = (toolCallId: string): SettledMarker | undefined => {
    let marker: SettledMarker | undefined;
    for (const event of artifacts.events ?? []) {
      if (
        event.type !== 'agentfootprint.stream.tool_start' &&
        event.type !== 'agentfootprint.stream.tool_end'
      ) {
        continue;
      }
      const payload = (event.payload ?? {}) as { toolCallId?: unknown; notDispatched?: unknown };
      if (payload.toolCallId !== toolCallId) continue;
      marker = markerOf(payload.notDispatched);
    }
    return marker;
  };

  /**
   * The history's answer: the final history decides when it still holds a
   * message for the id. When a window has evicted it, the history the call's
   * OWN step committed still does — that step appended it — so that is where
   * the marker is read; with no step to read, nothing is said.
   */
  const settledInHistory = (toolCallId: string, stepId: string | undefined) => {
    const final = settledIn(history(), toolCallId);
    if (final.answered || stepId === undefined) return final.marker;
    const at = index.lastIdxOf.get(stepId);
    if (at === undefined) return undefined;
    const committed = commitValueAt(index.commitLog, at, 'history');
    return Array.isArray(committed)
      ? settledIn(committed as readonly HistoryTurn[], toolCallId).marker
      : undefined;
  };

  /**
   * Was the call NEVER DISPATCHED (9.113.0)? Read off a marker, never the
   * sentence and never the bracket's `durationMs: 0`. The
   * bracket's own field first — the event tail answers alone, even for a
   * history that no longer holds the message — and the history's marker when
   * the tail is absent or its bracket carries none (a bracket without the
   * field is silence, not a denial).
   */
  const notDispatchedOf = (toolCallId: string, stepId: string | undefined) =>
    settledOnStream(toolCallId) ?? settledInHistory(toolCallId, stepId);

  const factsFor = (toolCallId: string): ToolCallFacts => {
    let toolName: string | undefined;
    let proposedArgs: Record<string, unknown> | undefined;
    let result: unknown;
    for (const turn of history()) {
      for (const call of turn.toolCalls ?? []) {
        if (call.id === toolCallId) {
          toolName = call.name ?? toolName;
          proposedArgs = call.args;
        }
      }
      if (turn.role === 'tool' && turn.toolCallId === toolCallId) {
        toolName = turn.toolName ?? toolName;
        result = turn.content;
      }
    }
    if (toolName === undefined) {
      toolName = knownCalls().find((call) => call.id === toolCallId)?.name;
    }
    const step = stepFor(toolCallId);
    const notDispatched = notDispatchedOf(toolCallId, step.id);
    return {
      ...(toolName !== undefined && { toolName }),
      ...(proposedArgs !== undefined && { proposedArgs }),
      ...(result !== undefined && { result }),
      ...(step.id !== undefined && { runtimeStageId: step.id }),
      ...(notDispatched !== undefined && { notDispatched }),
    };
  };

  return {
    knownCalls,
    factsFor,
    history,
    rowsFor: (toolCallId) => ledger().filter((row) => row.toolCallId === toolCallId),
    eventsOf,
  };
}

/**
 * The tool over {@link buildToolCallReader}'s join.
 *
 * The `toolCallId` param deliberately carries NO schema enum (unlike step
 * ids): building one would mean reconstructing the whole committed history
 * at factory time for every toolpack, including the runs that never open
 * this tool. The corrective message does the same job, on demand.
 */
function buildInspectToolCall(artifacts: TraceToolpackArtifacts, reader: ToolCallReader): Tool {
  const { knownCalls, factsFor, history, rowsFor, eventsOf } = reader;
  return defineTool<{ toolCallId: string }, string>({
    name: 'inspect_tool_call',
    description:
      'Resolve ONE tool call end to end: which tool, the arguments the model proposed, the ' +
      'arguments it actually ran with (they differ when a governance rule rewrote them), the ' +
      'bounded result, the outcome (ok / error / denied / paused), how long it took, and the ' +
      'step id that ran it. Use it whenever the question is about something a tool did — it ' +
      'joins four records that otherwise take four calls to read.',
    inputSchema: {
      type: 'object',
      properties: {
        toolCallId: {
          type: 'string',
          description:
            "The tool call's id, e.g. 'call_01'. Ids appear in trace_node on the tool step, " +
            'in the narrative, and in find_in_trace hits.',
        },
      },
      required: ['toolCallId'],
      additionalProperties: false,
    },
    execute: ({ toolCallId }) => {
      const calls = knownCalls();
      if (!calls.some((call) => call.id === toolCallId)) {
        if (calls.length === 0) {
          return (
            `unknown toolCallId '${toolCallId}' — this run recorded NO tool calls at all. ` +
            (artifacts.events === undefined && history().length === 0
              ? '⚠ it also carries no committed conversation history and no event tail, so a ' +
                'tool call could not be seen even if one happened. '
              : '') +
            'Call run_overview to see what the run did do.'
          );
        }
        const sample = calls
          .slice(0, TOOL_CALL_SUGGESTION_CAP)
          .map((call) => `${call.id} (${call.name})`)
          .join(', ');
        return (
          `unknown toolCallId '${toolCallId}'. This run recorded ${calls.length} tool call(s): ` +
          `${sample}${calls.length > TOOL_CALL_SUGGESTION_CAP ? ', …' : ''}. Retry with one of ` +
          `those ids.`
        );
      }

      const facts = factsFor(toolCallId);
      const lines: string[] = [`TOOL CALL ${toolCallId} — ${facts.toolName ?? '(unnamed tool)'}`];

      lines.push(
        facts.runtimeStageId !== undefined
          ? `step: ${facts.runtimeStageId} — drill with trace_node('${facts.runtimeStageId}')`
          : `step: ⚠ not resolvable — no event tail, and no committed step carries the result ` +
              `of call '${toolCallId}' (the turn may have ended before it landed).`,
      );

      lines.push(
        facts.proposedArgs !== undefined
          ? `proposed by the model: ${displayText(
              renderPreview(boundedPreview(facts.proposedArgs, TOOL_RESULT_PREVIEW_CHARS)),
            )}`
          : `proposed by the model: ⚠ not recorded — the assistant turn carrying call ` +
              `'${toolCallId}' is not in the committed history (a window strategy may have ` +
              `folded it away).`,
      );

      // A call the paused batch never dispatched (9.113.0) ran with nothing,
      // has no outcome of its own, no duration and no inside. Read off the
      // settlement marker (`notDispatchedOf`), each line a past fact anchored
      // to the call by id. Its `tool_end` is the settlement's bracket
      // (`durationMs: 0`, the sentence as `result`), never the record of a
      // tool that ran — read as one, it would be an `ok` in 0ms.
      const settled = facts.notDispatched;

      // The LAST `tool_end` for the id — the call the result line shows,
      // since a provider may reuse an id and the latest message decides the
      // result. After a settlement that is the call that ran under the id
      // again; a settled call itself never reaches the outcome lines
      // (`settled`). Whether its tool ran is the record's own word, read by
      // the one reader (`semantics/toolRan.ts` · `toolRanOf`): an unknown
      // tool name ends in an error without its tool ever running.
      const end = eventsOf('agentfootprint.stream.tool_end')
        .reverse()
        .find((event) => event.payload.toolCallId === toolCallId);
      const ran = end === undefined ? undefined : toolRanOf(end.payload);

      // Ran-with args: the ledger is the ONLY record of a rule rewriting
      // them. No ledger row means no rule changed anything — say that
      // plainly rather than leaving the reader to assume it.
      const rows = rowsFor(toolCallId);
      const rewrite = [...rows]
        .reverse()
        .find((row) => row.changed === true && row.moment === 'before-tool');
      if (settled !== undefined || ran === 'not-run') {
        lines.push(`ran with: nothing — call '${toolCallId}' was never executed.`);
      } else if (rewrite) {
        lines.push(
          `ran with: ${displayText(
            renderPreview(boundedPreview(rewrite.after, TOOL_RESULT_PREVIEW_CHARS)),
          )} — CHANGED at before-tool by '${rewrite.middleware ?? '?'}'` +
            (rewrite.why ? `: "${rewrite.why}"` : '') +
            '. The model proposed the line above; the tool ran on this one.',
        );
      } else if (rows.length > 0) {
        lines.push('ran with: the proposed arguments, unchanged (rules looked and allowed them).');
      } else {
        lines.push(
          `ran with: the proposed arguments — no governance rule filed a row for call ` +
            `'${toolCallId}'.`,
        );
      }

      lines.push(
        facts.result !== undefined
          ? `result: ${displayText(
              renderPreview(
                boundedPreview(facts.result, TOOL_RESULT_PREVIEW_CHARS),
                `get_value('${facts.runtimeStageId ?? '<step>'}', 'history') for the full turn`,
              ),
            )}`
          : `result: ⚠ no result recorded for call '${toolCallId}' in the committed history — ` +
              `it may have been denied before it ran, or the turn ended (paused/failed) before ` +
              `it landed.`,
      );

      // Outcome + duration: the event tail is the only clock a run has,
      // read off the same `end` as above.
      const denial = rows.find((row) => row.outcome === 'deny');
      const checkIn = eventsOf('agentfootprint.checkin.request').some(
        (event) => event.payload.toolCallId === toolCallId,
      );
      const invalid = eventsOf('agentfootprint.validation.args_invalid').some(
        (event) => event.payload.toolCallId === toolCallId,
      );
      let outcome: string;
      if (settled !== undefined) {
        outcome =
          `not dispatched — the run paused on call '${settled.pausedCall?.toolCallId ?? '?'}' ` +
          `to '${settled.pausedCall?.toolName ?? '?'}', earlier in the same batch, and resumed ` +
          `without executing call '${toolCallId}'`;
      } else if (denial) {
        outcome = `denied by '${denial.middleware ?? '?'}'${denial.why ? `: "${denial.why}"` : ''}`;
      } else if (end?.payload.error === true) {
        outcome =
          ran === 'ran'
            ? 'error — the tool threw or returned a failure'
            : ran === 'not-run'
            ? `error — call '${toolCallId}' was not executed: the tool was never entered`
            : 'error — this record does not say whether the tool ran';
      } else if (checkIn && end === undefined) {
        outcome = `paused — a check-in asked a human and call '${toolCallId}' has no recorded end`;
      } else if (facts.result !== undefined) {
        outcome = 'ok';
      } else {
        outcome = '⚠ unknown — no ledger row, no result, no end event';
      }
      lines.push(`outcome: ${outcome}`);
      if (invalid) {
        // Anchored to the call by ID, not by "this call" (9.86.0): the line
        // lands in a tool result, and a model re-reading it three calls later
        // resolves "this call" to whichever call it is answering then.
        lines.push(
          `⚠ the arguments failed schema validation on call '${toolCallId}' — see the ` +
            `validation event / the tool result, which carries the correction the model was ` +
            `given.`,
        );
      }

      if (settled !== undefined) {
        lines.push(`duration: none — call '${toolCallId}' was never executed.`);
      } else if (artifacts.events === undefined) {
        lines.push(
          `duration: ⚠ unavailable — these artifacts carry no event tail. The commit log records ` +
            `what each step WROTE and has no clock; timings live only in the event stream.`,
        );
      } else if (end !== undefined && typeof end.payload.durationMs === 'number') {
        lines.push(`duration: ${end.payload.durationMs}ms`);
      } else {
        lines.push(
          `duration: ⚠ no tool_end event for call '${toolCallId}' in the retained tail (it may ` +
            `have been dropped by the tail cap, or the call never finished).`,
        );
      }

      // THE DESCENT RUNG. The boundary marker below is honest for a tool
      // that called someone else's system, and needlessly honest for one
      // that kept its own record — so when a record exists the line that
      // says "not traced" is replaced by the call that opens it. One line,
      // and it teaches the id it takes: the SAME toolCallId, one level down.
      const inner = artifacts.innerRuns?.get(toolCallId);
      lines.push(
        settled !== undefined
          ? `inside: nothing — call '${toolCallId}' never reached the tool.`
          : inner !== undefined
          ? `inside: this tool kept its own record of the run — ${inner.steps} step(s), ` +
            `${inner.outcome}. Descend with inspect_tool_run({ toolCallId: '${toolCallId}' }).`
          : '⚠ boundary: what happened INSIDE the tool is not traced — this is the envelope ' +
            '(arguments in, result out) plus what the run itself decided about it.',
      );
      return lines.join('\n');
    },
  });
}

export { buildToolCallReader, buildInspectToolCall };
export type { ToolCallReader };
