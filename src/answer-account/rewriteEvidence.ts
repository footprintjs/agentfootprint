import { parseMaybeJson } from '../core/agent/emptiness.js';
import {
  historyCallResolver,
  indexResultRewrites,
  readHistoryCalls,
  readResultDispositionMark,
} from '../core/agent/recordedCalls.js';
import { copyJson, readOwnList } from '../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../lib/callOccurrence.js';
import { canonicalJson } from '../lib/canonicalJson.js';
import { toolBytesOf } from '../lib/toolBytes.js';
import {
  TOOL_REWRITE_DECISION,
  type AccountEventEvidence,
  type CommittedToolRewrite,
} from '../recorders/observability/answerAccount/evidence.js';
import { MAX_REWRITE_LEDGER, own, readRewriteCommit } from './rewriteCommit.js';

const START = 'agentfootprint.stream.tool_start';
const ITERATION_END = 'agentfootprint.agent.iteration_end';
const CONFIGURED = 'agentfootprint.agent.run_configured';

type ToolDecision = NonNullable<ReturnType<typeof projectToolDecision>>;

/** Keep only the allowed bracket decisions, without rationale, arguments or bodies. */
export function projectToolDecision(source: unknown) {
  if (source === null || typeof source !== 'object') return undefined;
  const moment = own(source, 'moment');
  const changed = own(source, 'changed');
  const middleware = own(source, 'middleware');
  const toolName = own(source, 'toolName');
  const toolCallId = own(source, 'toolCallId');
  const iteration = own(source, 'iteration');
  if (
    own(source, 'at') !== 'tool' ||
    (moment !== 'after-tool' && !(moment === 'before-tool' && changed === false)) ||
    typeof changed !== 'boolean' ||
    own(source, 'outcome') !== 'allow' ||
    'phase' in source ||
    'personApproved' in source ||
    typeof middleware !== 'string' ||
    middleware.trim().length === 0 ||
    typeof toolName !== 'string' ||
    toolName.length === 0 ||
    typeof toolCallId !== 'string' ||
    toolCallId.length === 0 ||
    typeof iteration !== 'number' ||
    !Number.isSafeInteger(iteration) ||
    iteration < 1 ||
    typeof readCallOccurrenceKey(source) !== 'string'
  )
    return undefined;

  return {
    at: 'tool',
    moment,
    outcome: 'allow',
    changed,
    middleware,
    toolName,
    toolCallId,
    iteration,
    callOccurrenceKey: own(source, 'callOccurrenceKey'),
  };
}

export function projectRewriteDecision(source: unknown): ToolDecision | undefined {
  const decision = projectToolDecision(source);
  return decision?.changed === true ? decision : undefined;
}

/** Scratch proof only. The result is never installed on an event or a bundle. */
export function rewriteComparison(value: unknown, budget: number): string {
  return canonicalJson(copyJson(parseMaybeJson(copyJson(value, budget, false)), budget, false));
}

function winningDecision(ledger: readonly unknown[], occurrence: string) {
  const winner = indexResultRewrites(ledger).get(occurrence);
  if (winner?.kind !== 'rewritten' || winner.name === undefined) return undefined;
  const decision = projectRewriteDecision(ledger[winner.index]);
  return decision === undefined ? undefined : { index: winner.index, decision };
}

function provesDecisionOrder(
  ledger: readonly unknown[],
  rows: readonly AccountEventEvidence[],
  key: string,
): boolean {
  const matching = ledger.filter(
    (row) => row !== null && typeof row === 'object' && readCallOccurrenceKey(row) === key,
  );
  return (
    matching.length === rows.length &&
    matching.every(
      (row, index) =>
        JSON.stringify(projectToolDecision(row)) === JSON.stringify(rows[index]?.event.payload),
    )
  );
}

function ownsResult(
  message: Readonly<Record<string, unknown>>,
  comparison: string,
  budget: number,
): boolean {
  return (
    readResultDispositionMark(message) === 'rewritten' &&
    own(message, 'toolResultExecution') === 'returned' &&
    rewriteComparison(
      toolBytesOf({ content: own(message, 'content'), toolChars: own(message, 'toolChars') }),
      budget,
    ) === comparison
  );
}

const unproven = { kind: 'unproven' } as const;

/** Admit one native returned rewrite, and keep its original evidence addresses. */
export function linkToolRewrite(
  events: readonly AccountEventEvidence[],
  snapshot: unknown,
  history: readonly unknown[],
  comparison: string | undefined,
  budget: number,
): CommittedToolRewrite {
  const ends = events.filter((row) => row.toolResult?.view === 'model-result');
  const decisions = events.filter(({ event }) => event.type === TOOL_REWRITE_DECISION);
  const rawLedger = own(own(snapshot, 'sharedState'), 'middlewareDecisions');
  if (ends.length === 0 && decisions.length === 0 && rawLedger === undefined)
    return { kind: 'none' };
  const [end] = ends;
  if (ends.length !== 1 || end === undefined || comparison === undefined) return unproven;

  const owner = events.find(({ event }) => event.type === CONFIGURED);
  const runId = owner?.event.meta.runId;
  const key = readCallOccurrenceKey(end.event.payload);
  const stage = end.event.meta.runtimeStageId;
  if (
    typeof runId !== 'string' ||
    typeof key !== 'string' ||
    typeof stage !== 'string' ||
    stage.length === 0 ||
    stage === 'unknown#0' ||
    end.event.meta.runId !== runId
  )
    return unproven;

  const bracket = events.filter(
    ({ event }) =>
      (event.type === START || event.type === end.event.type) &&
      readCallOccurrenceKey(event.payload) === key,
  );
  const [start, terminal] = bracket;
  if (bracket.length !== 2 || start?.event.type !== START || terminal !== end) return unproven;
  const toolName = start.event.payload.toolName;
  const toolCallId = start.event.payload.toolCallId;
  if (
    typeof toolName !== 'string' ||
    typeof toolCallId !== 'string' ||
    end.event.payload.toolCallId !== toolCallId ||
    (end.event.payload.toolName !== undefined && end.event.payload.toolName !== toolName)
  )
    return unproven;

  const inStage = ({ event }: AccountEventEvidence) =>
    event.meta.runId === runId && event.meta.runtimeStageId === stage;
  const completions = events.filter((row) => row.event.type === ITERATION_END && inStage(row));
  const [completion] = completions;
  if (completions.length !== 1 || completion === undefined || completion.index <= end.index)
    return unproven;
  const iteration = completion.event.payload.iterIndex;
  if (
    typeof iteration !== 'number' ||
    (start.event.payload.iteration !== undefined && start.event.payload.iteration !== iteration) ||
    (end.event.payload.iteration !== undefined && end.event.payload.iteration !== iteration) ||
    ![start, ...decisions].every(inStage) ||
    decisions.some(
      ({ index, event: { payload } }) =>
        index >= end.index ||
        (payload.moment === 'after-tool' && index <= start.index) ||
        readCallOccurrenceKey(payload) !== key ||
        payload.toolName !== toolName ||
        payload.toolCallId !== toolCallId ||
        payload.iteration !== iteration,
    )
  )
    return unproven;

  const final = readOwnList(rawLedger, MAX_REWRITE_LEDGER);
  const committed = readRewriteCommit(
    snapshot,
    stage,
    end,
    [end, start, completion, ...decisions],
    budget,
  );
  if (final?.unread !== 0 || committed === undefined) return unproven;
  const stageWinner = winningDecision(committed.ledger, key);
  const winner = winningDecision(final.entries, key);
  if (
    stageWinner === undefined ||
    winner === undefined ||
    stageWinner.index !== winner.index ||
    JSON.stringify(stageWinner.decision) !== JSON.stringify(winner.decision) ||
    !provesDecisionOrder(committed.ledger, decisions, key) ||
    !provesDecisionOrder(final.entries, decisions, key) ||
    decisions.filter(
      ({ event }) => JSON.stringify(event.payload) === JSON.stringify(winner.decision),
    ).length !== 1
  )
    return unproven;

  const resolve = (rows: readonly unknown[]) =>
    historyCallResolver(readHistoryCalls(rows))(undefined, undefined, key);
  const matched = resolve(committed.history);
  if (
    matched.kind !== 'matched' ||
    matched.call.toolName !== toolName ||
    matched.call.providerId !== toolCallId ||
    !ownsResult(matched.call.message, comparison, budget)
  )
    return unproven;

  const retained = resolve(history);
  if (
    retained.kind === 'ambiguous' ||
    (retained.kind === 'matched' &&
      (retained.call.toolName !== toolName ||
        retained.call.providerId !== toolCallId ||
        !ownsResult(retained.call.message, comparison, budget)))
  )
    return unproven;

  return {
    kind: 'linked',
    ledgerIndex: winner.index,
    decision: winner.decision,
    ...(retained.kind === 'matched' && { historyIndex: retained.call.index }),
  };
}
