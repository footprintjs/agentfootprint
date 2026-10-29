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
 * EVERY REQUEST SENT IS COUNTED. Each attempt the series started is a row — or,
 * past the cap, one more in `omitted` — so `rows + omitted` is the number of
 * requests the series sent. An attempt a cancellation cuts in flight is a row
 * too (`cut`), exactly as an attempt the deadline cuts is (`timed-out`). A
 * request the series never sent — the next one after a cancelled wait — has no
 * row.
 *
 * A CUT IS NOT A "NOT RUN". An attempt that ended without an answer — cut,
 * timed out, or failed — was sent, and the server may have received it and run
 * it. Its row says so (`remote: 'unknown'`); nothing here records it as not run.
 *
 * THREE FACTS PER ATTEMPT, NONE READ FROM ANOTHER (`replay.ts`): the failure
 * (footprintjs's category), what is known of its effect (`unknown` for every
 * attempt sent that did not complete — a refusal included; `applied` when the
 * call completed, never proof of a write; `none` only for what was never
 * sent), and — on an attempt the series asked again after — what permitted it.
 * Each row also says how long it took. The end says how many requests were
 * sent and what is known of the whole series' effect; uncertainty survives
 * (`SeriesKnowledge`).
 *
 * WHEN IT FILES. When the call settles — the series has ended by then, and the
 * call's verdict is what says whether an answered attempt completed (a 200 can
 * carry a tool error) — and, for a cancellation, at the moment the signal
 * fires: a cancelled run stops waiting for its stage at once, so a record filed
 * when the series later unwinds would land after the run was saved. The runner
 * makes no record for an attempt it abandons at that moment or for a wait it
 * was cut out of, so those are written here: the cut attempt's row and
 * `during: 'request'`, or `during: 'wait'`. A series ended and waiting for its
 * call files at once if the call is cancelled first, with what it knows.
 * Anything the series reports after it has filed is not part of the request's
 * story any more and is ignored.
 */

import type { AttemptRecord } from 'footprintjs';

import type {
  ToolRequestAttempt,
  ToolRequestEffect,
  ToolRequestEnd,
  ToolRequestError,
  ToolRequestPermission,
  ToolRequestReason,
} from '../events/payloads.js';
import {
  MAX_REQUEST_ATTEMPT_ROWS,
  type RequestEvidence,
  type RequestEvidenceSink,
} from '../tools/requestEvidence.js';
import { SeriesKnowledge, type RequestReplay } from './replay.js';

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
  | 'exhausted'
  | 'wait-limit'
  | 'no-time-left'
  | 'not-replayable'
  | 'not-retryable'
  | 'not-permitted'
  | 'changes-without-key'
>;

/**
 * What the series knows of one attempt beyond the runner's record (`replay.ts`):
 * its effect — absent for an answered attempt, which the call's verdict decides
 * when the record is filed — what permitted the next attempt, and how long it
 * took.
 */
export interface AttemptFacts {
  readonly effect?: ToolRequestEffect;
  readonly permission?: ToolRequestPermission;
  readonly durationMs: number;
}

/**
 * Where the record waits for its call: the call's signal (it fires when the
 * call settles or is cancelled), and the facts the call leaves there.
 */
export interface Settlement {
  readonly signal: AbortSignal;
  readonly replay: RequestReplay;
}

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
  private waiting = false;
  /** What is known of the series' effect, attempt by attempt — the answer's excepted. */
  private readonly knowledge = new SeriesKnowledge();
  /** The answered attempt, while its effect waits for the call's verdict. */
  private answer: ToolRequestAttempt | undefined;

  constructor(
    private readonly sink: RequestEvidenceSink,
    private readonly where: RequestWhere,
    private readonly settlement?: Settlement,
  ) {}

  /** One attempt as the runner recorded it, with what the series knows of it. */
  attempt(
    record: AttemptRecord,
    seen: AttemptSeen | undefined,
    declined?: DeclineReason,
    facts?: AttemptFacts,
  ): void {
    if (this.filed) return;
    const row = withFacts(rowOf(record, seen, declined), facts);
    if (facts !== undefined && row.effect === undefined && row.outcome === 'answered') {
      this.answer = row;
    }
    this.add(row);
  }

  /**
   * The caller's cancellation cut attempt `n` in flight. It was sent — the
   * server may have it, and may have run it — so it is a row, `cut`, with the
   * remote outcome `unknown`; then the request's end says the same.
   */
  cutInFlight(n: number, durationMs?: number): void {
    if (this.filed) return;
    this.add({
      attempt: n,
      outcome: 'cut',
      reason: 'cancelled',
      remote: 'unknown',
      effect: 'unknown',
      ...(durationMs !== undefined && { durationMs }),
    });
    this.file({ outcome: 'cut', reason: 'cancelled', during: 'request', remote: 'unknown' });
  }

  /**
   * The caller's cancellation landed with NO request in flight: between two —
   * `during: 'wait'`, the next request never sent — or before the first, when
   * nothing was sent and there is no `during`. No row is added: there is no
   * request to account for. A request that had already ended keeps its end.
   */
  cancelled(): void {
    const last = this.last;
    if (last !== undefined && last.reason !== 'retryable') {
      this.file(endOf(last));
      return;
    }
    this.file({
      outcome: 'cancelled',
      reason: 'cancelled',
      ...(last !== undefined && { during: 'wait' as const }),
    });
  }

  /**
   * The series delivered a response. It is the last attempt's — an answer, or a
   * refusal it will not ask again after. A refusal it MEANT to ask again after
   * is delivered when the series stopped inside the wait: the deadline landed
   * there (`no-time-left`), or a pooled call's send gate refused the next
   * attempt before it was sent (`stoppedBy`, `not-permitted`). The end says
   * which, during the `wait`; the attempt that was never sent has no row.
   * Filed when the call has read it.
   */
  delivered(stoppedBy?: DeclineReason): void {
    const last = this.last;
    if (last === undefined) {
      this.fileWhenSettled(UNACCOUNTED);
      return;
    }
    this.fileWhenSettled(
      last.reason === 'retryable'
        ? { ...endOf(last), reason: stoppedBy ?? 'no-time-left', during: 'wait' }
        : endOf(last),
    );
  }

  /**
   * The series threw. The end is the last attempt's when that attempt ended it
   * (a failure, a timed-out request). The rest is defensive — footprintjs 10.6's
   * runner never throws without a record but for a cancellation, which is filed
   * as one: a deadline that had passed before the first request (`timed-out`,
   * no `during`, nothing sent) or one a future runner reports from inside a wait
   * (`during: 'wait'`); anything else is filed as a failure the record cannot
   * account for, so a request is never left unfiled. A pooled call's send gate
   * that refused the next attempt before it was sent ends it as `stoppedBy`,
   * during the `wait`. Filed when the call settles.
   */
  threw(outOfTime: boolean, stoppedBy?: DeclineReason): void {
    const last = this.last;
    if (last !== undefined && last.reason !== 'retryable') {
      this.fileWhenSettled(endOf(last));
      return;
    }
    // A pooled call's send gate refused the next attempt before it was sent.
    if (last !== undefined && stoppedBy !== undefined) {
      this.fileWhenSettled({ ...endOf(last), reason: stoppedBy, during: 'wait' });
      return;
    }
    if (!outOfTime) {
      this.fileWhenSettled(UNACCOUNTED);
      return;
    }
    this.fileWhenSettled({
      outcome: 'timed-out',
      reason: 'no-time-left',
      failure: 'timeout',
      ...(last !== undefined && { during: 'wait' as const }),
      error: { message: OUT_OF_TIME, code: 'timeout' },
    });
  }

  private add(row: ToolRequestAttempt): void {
    this.last = row;
    if (row.effect !== undefined) this.knowledge.note(row.effect);
    if (this.rows.length < MAX_REQUEST_ATTEMPT_ROWS) this.rows.push(row);
    else this.omitted += 1;
  }

  /**
   * File `end` once the call has settled — its verdict is what says whether an
   * answered attempt completed — or at once, when the call is already settled
   * or cancelled, or there is no call to wait for.
   */
  private fileWhenSettled(end: ToolRequestEnd): void {
    const signal = this.settlement?.signal;
    if (signal === undefined || signal.aborted) {
      this.file(end);
      return;
    }
    if (this.waiting) return;
    this.waiting = true;
    signal.addEventListener('abort', () => this.file(end), { once: true });
  }

  private file(end: ToolRequestEnd): void {
    if (this.filed) return;
    this.filed = true;
    const replay = this.settlement?.replay;
    const rows = this.settleAnswer(replay);
    try {
      this.sink.file({
        ...this.where,
        attempts: rows,
        omitted: this.omitted,
        end: {
          ...end,
          attempts: this.rows.length + this.omitted,
          effect: this.knowledge.effect,
          ...(replay?.mayHaveRun === true && { mayHaveRun: true as const }),
        },
      });
    } catch {
      // The library's sink never throws; one that does must not fail the call.
    }
  }

  /**
   * The rows, the answered one given its effect: `applied` when the call
   * completed — the server answered it, and not with an error — else `unknown`
   * (a 5xx, a JSON-RPC error, a tool error, a call cancelled before it read the
   * answer). The answer's effect joins the series' knowledge here.
   */
  private settleAnswer(replay: RequestReplay | undefined): ToolRequestAttempt[] {
    const answer = this.answer;
    if (answer === undefined) return [...this.rows];
    const effect: ToolRequestEffect = replay?.verdict === 'completed' ? 'applied' : 'unknown';
    this.knowledge.note(effect);
    const settled: ToolRequestAttempt = { ...answer, effect };
    return this.rows.map((row) => (row === answer ? settled : row));
  }
}

/**
 * An end no attempt accounts for — never seen; kept so a request is never left
 * unfiled, and never claiming more than is known.
 */
const UNACCOUNTED: ToolRequestEnd = {
  outcome: 'failed',
  reason: 'not-retryable',
  failure: 'unknown',
  error: { message: FAILED, code: 'unknown' },
  remote: 'unknown',
};

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
    ...(outcome !== 'answered' &&
      outcome !== 'cut' &&
      record.category !== undefined && { failure: record.category }),
    ...(reason === 'retryable' && { waitMs: record.delayMs ?? 0 }),
    ...(refusal?.retryAfterMs !== undefined && { retryAfterMs: refusal.retryAfterMs }),
    ...((outcome === 'failed' || outcome === 'timed-out') && {
      error: errorOf(outcome, record.category),
    }),
    ...(noAnswer(outcome) && { remote: 'unknown' as const }),
  };
}

/**
 * `row` with what the series knows of its attempt beyond the record — its
 * effect, what permitted the next attempt, how long it took. Without `facts`,
 * the row as the record alone says it.
 */
export function withFacts(
  row: ToolRequestAttempt,
  facts: AttemptFacts | undefined,
): ToolRequestAttempt {
  if (facts === undefined) return row;
  return {
    ...row,
    ...(facts.effect !== undefined && { effect: facts.effect }),
    ...(row.reason === 'retryable' &&
      facts.permission !== undefined && { permission: facts.permission }),
    durationMs: facts.durationMs,
  };
}

/** An attempt that ended without an answer — the server may have run it, or not. */
function noAnswer(outcome: ToolRequestAttempt['outcome']): boolean {
  return outcome === 'failed' || outcome === 'timed-out' || outcome === 'cut';
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
    case 'aborted':
      // Cut in flight by the series' cancellation. The cancellation itself files
      // this row first (`cutInFlight`), so the record is seen only if it did not.
      return 'cut';
    default:
      // `paused` cannot happen inside a fetch.
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
  const { outcome, reason, status, kind, failure, error, remote } = last;
  return {
    outcome,
    reason,
    ...(status !== undefined && { status }),
    ...(kind !== undefined && { kind }),
    ...(failure !== undefined && { failure }),
    ...((outcome === 'timed-out' || outcome === 'cut') && { during: 'request' as const }),
    ...(error !== undefined && { error }),
    ...(remote !== undefined && { remote }),
  };
}
