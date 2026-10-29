/**
 * seriesEvidence — one MCP request's retry series, written down for its run.
 *
 * Pattern: a collector over footprintjs's attempt records, filed once.
 * Role:    The series (`throttleRetry.ts` · `Series`) is the one retry owner and
 *          the attempt runner makes one record per try; this turns each record
 *          into an allow-listed row and files the request's whole story — its
 *          rows, how many were not listed, and how it ended — to the call's sink
 *          (`tools/requestEvidence.ts`) exactly ONCE.
 *
 * WHAT A ROW MAY SAY. Numbers and the library's own words; never the server's
 * answer, the call's arguments or an error's text. A failure is a fixed sentence
 * and its category — a network or SDK error message can carry a URL with a token
 * in it, a host's internal name or a server's reply.
 *
 * A RESPONSE IS NOT A SUCCESS. The runner records an attempt that returned a
 * response as `ok` with the reason `succeeded`; here it is `answered`, with the
 * status the server sent — a 503 delivered is `answered` + `503`, never success.
 *
 * WHEN IT FILES. When the series ends — and, for a cancellation, at the moment the
 * signal fires: a cancelled run stops waiting for its stage at once, so a record
 * filed when the series later unwinds would land after the run was saved. The
 * runner makes no record for a wait it was cut out of, so the end says it
 * (`during: 'wait'`); an attempt cut in flight is the end's too (`'request'`).
 * Anything the series reports after it has filed is not part of the request's
 * story any more and is ignored.
 */

import type { AttemptRecord } from 'footprintjs';

import type {
  ToolRequestAttempt,
  ToolRequestEnd,
  ToolRequestError,
  ToolRequestReason,
} from '../events/payloads.js';
import {
  MAX_REQUEST_ATTEMPT_ROWS,
  type RequestEvidence,
  type RequestEvidenceSink,
} from '../tools/requestEvidence.js';

/** Where the request went, as a row may say it: the app's label for it, or its origin. */
export type RequestWhere = Pick<RequestEvidence, 'endpoint' | 'origin'>;

/** What the series saw of one attempt that its record does not hold. */
export interface AttemptSeen {
  /** The response's status, when a response arrived. */
  readonly status?: number;
  /** The refusal a rule recognised in that response, when one did. */
  readonly refusal?: { readonly kind: 'throttle' | 'session-busy'; readonly retryAfterMs?: number };
}

/** Why the series' `retryOn` said no — the reasons the runner calls `declined`. */
export type DeclineReason = Extract<
  ToolRequestReason,
  'exhausted' | 'wait-limit' | 'no-time-left' | 'not-replayable' | 'not-retryable'
>;

/** What the request was doing when it was cut: sending, or waiting to send again. */
export type SeriesPhase = 'request' | 'wait';

const FAILED: ToolRequestError['message'] =
  'The request failed before an answer arrived. Its error is not kept.';
const OUT_OF_TIME: ToolRequestError['message'] =
  'The call ran out of time before an answer arrived.';

/** One request's evidence, collected as its series runs and filed once. */
export class SeriesEvidence {
  private readonly rows: ToolRequestAttempt[] = [];
  private omitted = 0;
  private last: ToolRequestAttempt | undefined;
  private filed = false;

  constructor(private readonly sink: RequestEvidenceSink, private readonly where: RequestWhere) {}

  /**
   * One attempt as the runner recorded it. A cancelled attempt has no row: the
   * end says it was cut in flight.
   */
  attempt(record: AttemptRecord, seen: AttemptSeen | undefined, declined?: DeclineReason): void {
    if (this.filed || record.outcome === 'aborted') return;
    const row = rowOf(record, seen, declined);
    this.last = row;
    if (this.rows.length < MAX_REQUEST_ATTEMPT_ROWS) this.rows.push(row);
    else this.omitted += 1;
  }

  /** The caller's signal ended the request. */
  cancelled(during: SeriesPhase): void {
    this.file({ outcome: 'cancelled', reason: 'cancelled', during });
  }

  /**
   * The series ended — it delivered an answer or a refusal, or it threw. The end
   * is the last attempt's when that attempt ended it. When none did — the
   * deadline cut a wait, or passed before the first request, or (never seen,
   * kept so nothing goes unfiled) something else stopped the series — it says so.
   */
  ended(during: SeriesPhase, outOfTime = false): void {
    const last = this.last;
    if (last !== undefined && last.reason !== 'retryable') {
      this.file(endOf(last));
      return;
    }
    this.file(
      outOfTime
        ? {
            outcome: 'timed-out',
            reason: 'no-time-left',
            failure: 'timeout',
            during,
            error: { message: OUT_OF_TIME, code: 'timeout' },
          }
        : {
            outcome: 'failed',
            reason: 'not-retryable',
            failure: 'unknown',
            error: { message: FAILED, code: 'unknown' },
          },
    );
  }

  private file(end: ToolRequestEnd): void {
    if (this.filed) return;
    this.filed = true;
    try {
      this.sink.file({ ...this.where, attempts: [...this.rows], omitted: this.omitted, end });
    } catch {
      // The library's sink never throws; one that does must not fail the call.
    }
  }
}

/** One record as a row — see the module note for what a row may say. */
export function rowOf(
  record: AttemptRecord,
  seen: AttemptSeen | undefined,
  declined?: DeclineReason,
): ToolRequestAttempt {
  const outcome = outcomeOf(record, seen);
  const reason = reasonOf(record, declined);
  const refusal = outcome === 'refused' ? seen?.refusal : undefined;
  return {
    attempt: record.attempt,
    outcome,
    reason,
    ...((outcome === 'answered' || outcome === 'refused') &&
      seen?.status !== undefined && { status: seen.status }),
    ...(refusal !== undefined && { kind: refusal.kind }),
    ...(outcome !== 'answered' && record.category !== undefined && { failure: record.category }),
    ...(reason === 'retryable' && { waitMs: record.delayMs ?? 0 }),
    ...(refusal?.retryAfterMs !== undefined && { retryAfterMs: refusal.retryAfterMs }),
    ...((outcome === 'failed' || outcome === 'timed-out') && {
      error: errorOf(outcome, record.category),
    }),
  };
}

function outcomeOf(
  record: AttemptRecord,
  seen: AttemptSeen | undefined,
): ToolRequestAttempt['outcome'] {
  switch (record.outcome) {
    case 'ok':
      return 'answered';
    case 'timeout':
      return 'timed-out';
    case 'failed':
      return seen?.refusal !== undefined ? 'refused' : 'failed';
    default:
      // `paused` cannot happen inside a fetch, and `aborted` never becomes a row.
      return 'failed';
  }
}

function reasonOf(record: AttemptRecord, declined: DeclineReason | undefined): ToolRequestReason {
  if (record.outcome === 'ok') return 'answered';
  if (record.next === 'retry') return 'retryable';
  if (record.outcome === 'timeout') return 'no-time-left';
  switch (record.reason) {
    case 'exhausted':
      return 'exhausted';
    case 'no-time-left':
      return 'no-time-left';
    case 'aborted':
      return 'cancelled';
    case 'declined':
      return declined ?? 'not-retryable';
    default:
      return 'not-retryable';
  }
}

function errorOf(
  outcome: 'failed' | 'timed-out',
  category: AttemptRecord['category'],
): ToolRequestError {
  return outcome === 'timed-out'
    ? { message: OUT_OF_TIME, code: category ?? 'timeout' }
    : { message: FAILED, code: category ?? 'unknown' };
}

/** How a request ended, when it ended with its last attempt. */
function endOf(last: ToolRequestAttempt): ToolRequestEnd {
  const { outcome, reason, status, kind, failure, error } = last;
  return {
    outcome,
    reason,
    ...(status !== undefined && { status }),
    ...(kind !== undefined && { kind }),
    ...(failure !== undefined && { failure }),
    ...(outcome === 'timed-out' && { during: 'request' as const }),
    ...(error !== undefined && { error }),
  };
}
