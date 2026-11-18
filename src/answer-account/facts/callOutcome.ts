import { readNotDispatched, toolRanOf } from '../../semantics/toolRan.js';
import type { ToolCallFact } from '../types.js';
import { keptOut, str, type ViewEvent } from '../view.js';
import type { ReadContext } from './common.js';

/** Select one event type and call id in recording order. */
export type CallIndex = (type: string, id: string) => readonly ViewEvent[];

/**
 * The permission rows between this call's start and end that name its tool —
 * and no other call. A tool that calls a tool (`ctx.tools.call`) has its inner
 * call's checks filed in that window under the inner call's own id
 * (`c1#inner-1`); a row that names a different call is not a verdict on this
 * one, even when both calls name the same tool. A row that names no call (an
 * app's own `agent.emit`) is still read by its window and tool name.
 */
function permissionRows(
  ctx: ReadContext,
  id: string,
  toolName: string,
  start?: ViewEvent,
  end?: ViewEvent,
): ViewEvent[] {
  if (start === undefined) return [];
  const upTo = end?.index ?? Number.POSITIVE_INFINITY;
  return ctx.view.ofType('permission.check').filter((e) => {
    const call = str(e.payload.toolCallId);
    return (
      e.index > start.index &&
      e.index < upTo &&
      e.payload.target === toolName &&
      (call === undefined || call === id)
    );
  });
}

/** The permission verdicts that stop a call before it runs. */
export const PERMISSION_REFUSALS: ReadonlySet<unknown> = new Set(['deny', 'halt']);

interface Outcome {
  readonly outcome: ToolCallFact['outcome'];
  readonly refusedBy?: string;
  readonly withheldBy?: string;
  readonly ruleEvent?: ViewEvent;
  readonly approvalEvent?: ViewEvent;
}

/** The `tool_end` fields that say how a call ended — read by `outcomeOf`. */
const OUTCOME_FIELDS = ['notDispatched', 'notExecuted', 'entered', 'error'] as const;

export function outcomeOf(
  ctx: ReadContext,
  byCall: CallIndex,
  id: string,
  toolName: string,
  start?: ViewEvent,
  end?: ViewEvent,
): Outcome {
  const decisions = byCall('middleware.decision', id);
  const checkIns = byCall('checkin.decision', id);
  const stoppedByMiddleware = (e: ViewEvent) =>
    e.payload.outcome === 'deny' || e.payload.outcome === 'refused';
  const beforeDeny = decisions.find(
    (e) => e.payload.moment === 'before-tool' && stoppedByMiddleware(e),
  );
  const afterDeny = decisions.find(
    (e) => e.payload.moment === 'after-tool' && stoppedByMiddleware(e),
  );
  // Only `deny` and `halt` stop a call. `gate_open` lets it run (`core/Agent.ts`: allowed =
  // allow || gate_open), so it is never a refusal.
  const resumePermissionDeny = byCall('permission.check', id).find(
    (e) =>
      e.payload.phase === 'resume' &&
      e.index < (end?.index ?? Infinity) &&
      PERMISSION_REFUSALS.has(e.payload.result),
  );
  const permissionDeny =
    resumePermissionDeny ??
    permissionRows(ctx, id, toolName, start, end).find((e) =>
      PERMISSION_REFUSALS.has(e.payload.result),
    );
  const checkInDeclined = checkIns.find(
    (e) => e.payload.approved === false && e.payload.phase === undefined,
  );
  const pausedId = str(ctx.view.state?.pausedToolCallId);
  const isPausedCall =
    ctx.resumedLeg && ((pausedId !== undefined && pausedId === id) || start === undefined);

  // The record keeps out a field that says how the call ended (a redaction
  // policy's placeholder): how it ended cannot be told, so it is not guessed.
  if (end !== undefined) {
    if (OUTCOME_FIELDS.some((field) => keptOut(end, field))) return { outcome: 'unknown' };
    const settlement = readNotDispatched(end.payload.notDispatched);
    if (settlement === 'settled') return { outcome: 'not-dispatched', ruleEvent: end };
    if (settlement === 'malformed')
      return { outcome: end.payload.error === true ? 'ended-in-error' : 'unknown' };
  }
  if (checkInDeclined !== undefined) return { outcome: 'declined', ruleEvent: checkInDeclined };
  if (
    beforeDeny?.payload.outcome === 'deny' &&
    beforeDeny.payload.phase === undefined &&
    (beforeDeny.payload.personApproved === false || isPausedCall)
  )
    return { outcome: 'declined', ruleEvent: beforeDeny };
  const ruleEvent = beforeDeny ?? permissionDeny;
  if (ruleEvent !== undefined) {
    const by =
      beforeDeny !== undefined
        ? beforeDeny.payload.outcome === 'refused'
          ? beforeDeny.payload.phase === 'resume'
            ? 'library'
            : undefined
          : str(beforeDeny.payload.middleware)
        : str(ruleEvent.payload.policyRuleId);
    const earlier = (e: ViewEvent) =>
      e.index < ruleEvent.index &&
      (e.payload.iteration === undefined ||
        ruleEvent.payload.iteration === undefined ||
        e.payload.iteration === ruleEvent.payload.iteration);
    const approvalEvent =
      ruleEvent.payload.phase === 'resume'
        ? checkIns.find((e) => earlier(e) && e.payload.approved === true) ??
          decisions.find(
            (e) =>
              earlier(e) &&
              e.payload.phase === undefined &&
              e.payload.outcome === 'allow' &&
              e.payload.personApproved === true,
          )
        : undefined;
    return {
      outcome: 'refused',
      ruleEvent,
      ...(by !== undefined && { refusedBy: by }),
      ...(approvalEvent !== undefined && { approvalEvent }),
    };
  }
  if (end?.payload.notExecuted === true) return { outcome: 'refused', ruleEvent: end };
  if (end === undefined) return { outcome: 'unknown' };
  // No rule and no person stopped it: whether its tool ran is the record's
  // own word (`entered`), never inferred from `error`.
  // A leaf no writer writes (`toolRanOf` reads `'not-recorded'`) with no `error`
  // says nothing about how the call ended: not guessed, as a kept-out field.
  const ran = toolRanOf(end.payload);
  if (ran === 'not-run') return { outcome: 'not-executed' };
  if (end.payload.error === true) return { outcome: ran === 'ran' ? 'failed' : 'ended-in-error' };
  if (ran === 'not-recorded') return { outcome: 'unknown' };
  const by =
    afterDeny?.payload.outcome === 'refused' ? 'library' : str(afterDeny?.payload.middleware);
  return afterDeny !== undefined
    ? { outcome: 'ran', ruleEvent: afterDeny, ...(by !== undefined && { withheldBy: by }) }
    : { outcome: 'ran' };
}
