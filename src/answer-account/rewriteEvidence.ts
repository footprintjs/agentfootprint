import { capturePlainResultShape } from '../core/agent/plainResultShape.js';
import {
  historyCallResolver,
  indexResultRewrites,
  readHistoryCalls,
  readResultDispositionMark,
} from '../core/agent/recordedCalls.js';
import { readOwnList } from '../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../lib/callOccurrence.js';
import { toolBytesOf } from '../lib/toolBytes.js';
import {
  TOOL_REWRITE_DECISION,
  type AccountEventEvidence,
  type CommittedToolRewrite,
} from '../recorders/observability/answerAccount/evidence.js';

const START = 'agentfootprint.stream.tool_start';
const CONFIGURED = 'agentfootprint.agent.run_configured';

const own = (source: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(source, key)?.value;

/** Admit only a fresh allowed after-tool change. No rationale or result values leave this owner. */
export function projectRewriteDecision(
  source: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (source === null || typeof source !== 'object') return undefined;
  const middleware = own(source, 'middleware');
  const toolName = own(source, 'toolName');
  const toolCallId = own(source, 'toolCallId');
  const iteration = own(source, 'iteration');
  if (
    own(source, 'at') !== 'tool' ||
    own(source, 'moment') !== 'after-tool' ||
    own(source, 'outcome') !== 'allow' ||
    own(source, 'changed') !== true ||
    'phase' in source ||
    'personApproved' in source ||
    typeof middleware !== 'string' ||
    middleware.trim().length === 0 ||
    typeof toolName !== 'string' ||
    typeof toolCallId !== 'string' ||
    typeof iteration !== 'number' ||
    !Number.isSafeInteger(iteration) ||
    iteration < 1 ||
    typeof readCallOccurrenceKey(source) !== 'string'
  )
    return undefined;

  return {
    at: 'tool',
    moment: 'after-tool',
    outcome: 'allow',
    changed: true,
    middleware,
    toolName,
    toolCallId,
    iteration,
    callOccurrenceKey: own(source, 'callOccurrenceKey'),
  };
}

const unproven = { kind: 'unproven' } as const;

/** The first rewrite slice admits one pair and no other middleware decisions. */
export function linkToolRewrite(
  events: readonly AccountEventEvidence[],
  ledger: unknown,
  history: readonly unknown[],
): CommittedToolRewrite {
  const ends = events.filter((row) => row.toolResult?.view === 'model-result');
  const decisions = events.filter(({ event }) => event.type === TOOL_REWRITE_DECISION);
  if (ends.length === 0 && decisions.length === 0 && ledger === undefined) return { kind: 'none' };
  const [end] = ends;
  const [decision] = decisions;
  if (ends.length !== 1 || decisions.length !== 1 || end === undefined || decision === undefined)
    return unproven;

  const owner = events.find(({ event }) => event.type === CONFIGURED);
  const runId = owner?.event.meta.runId;
  const key = readCallOccurrenceKey(end.event.payload);
  if (
    typeof runId !== 'string' ||
    typeof key !== 'string' ||
    end.event.meta.runId !== runId ||
    decision.event.meta.runId !== runId ||
    decision.index >= end.index ||
    readCallOccurrenceKey(decision.event.payload) !== key
  )
    return unproven;

  const bracket = events.filter(
    ({ event }) =>
      (event.type === START || event.type === end.event.type) &&
      readCallOccurrenceKey(event.payload) === key,
  );
  const [start, terminal] = bracket;
  if (
    bracket.length !== 2 ||
    start?.event.type !== START ||
    terminal !== end ||
    start.event.meta.runId !== runId ||
    start.index >= decision.index ||
    start.event.payload.toolName !== decision.event.payload.toolName ||
    start.event.payload.toolCallId !== decision.event.payload.toolCallId ||
    end.event.payload.toolCallId !== decision.event.payload.toolCallId
  )
    return unproven;

  const list = readOwnList(ledger, 1);
  if (list === undefined || list.unread > 0 || list.entries.length !== 1) return unproven;
  const committed = projectRewriteDecision(list.entries[0]);
  if (
    committed === undefined ||
    JSON.stringify(committed) !== JSON.stringify(decision.event.payload)
  )
    return unproven;
  const winner = indexResultRewrites(list.entries).get(key);
  if (winner?.kind !== 'rewritten' || winner.index !== 0 || winner.name !== committed.middleware)
    return unproven;

  const historyMatch = historyCallResolver(readHistoryCalls(history))(undefined, undefined, key);
  if (
    historyMatch.kind !== 'matched' ||
    historyMatch.call.providerId !== committed.toolCallId ||
    historyMatch.call.toolName !== committed.toolName ||
    readResultDispositionMark(historyMatch.call.message) !== 'rewritten' ||
    own(historyMatch.call.message, 'toolResultExecution') !== 'returned'
  )
    return unproven;

  const message = historyMatch.call.message;
  const fromHistory = capturePlainResultShape(
    toolBytesOf({
      content: own(message, 'content'),
      toolChars: own(message, 'toolChars'),
    }),
  );
  if (
    fromHistory.kind !== 'ready' ||
    JSON.stringify({ ...fromHistory.shape, view: 'model-result' }) !==
      JSON.stringify(end.toolResult)
  )
    return unproven;

  return { kind: 'linked', historyIndex: historyMatch.call.index, decision: committed };
}
