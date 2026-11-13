import type { ItemOf, PayloadOf } from '../vocabulary.js';
import { bool, num, oneOf, shapeOf } from '../../auditBounding.js';

export type RequestAttempt = ItemOf<PayloadOf<'agentfootprint.tools.request_attempts'>['attempts']>;

export type RequestEnd = PayloadOf<'agentfootprint.tools.request_attempts'>['end'];

export const requestReason = oneOf(
  'answered',
  'cancelled',
  'changes-without-key',
  'exhausted',
  'no-time-left',
  'not-permitted',
  'not-replayable',
  'not-retryable',
  'retryable',
  'wait-limit',
);

export const requestFailure = oneOf(
  'auth',
  'network',
  'permanent',
  'rate-limited',
  'server',
  'timeout',
  'unknown',
);

export const requestRefusalKind = oneOf('session-busy', 'throttle');

export const requestEffect = oneOf('applied', 'none', 'unknown');

/** A request's error: one of the library's two fixed sentences, and a category — never the error itself. */
export const requestError = shapeOf<NonNullable<RequestEnd['error']>>({
  message: oneOf(
    'The call ran out of time before an answer arrived.',
    'The request failed before an answer arrived. Its error is not kept.',
  ),
  code: requestFailure,
});

/** One try of a tool's request: outcome, reason, timing and the library's categories. */
export const boundRequestAttempt = shapeOf<RequestAttempt>({
  attempt: num,
  outcome: oneOf('answered', 'cut', 'failed', 'refused', 'timed-out'),
  reason: requestReason,
  status: num,
  kind: requestRefusalKind,
  failure: requestFailure,
  waitMs: num,
  retryAfterMs: num,
  error: requestError,
  remote: oneOf('unknown'),
  effect: requestEffect,
  permission: shapeOf<NonNullable<RequestAttempt['permission']>>({
    by: oneOf('adapter', 'compatibility', 'declaration'),
    on: oneOf('network', 'throttle'),
    assumes: oneOf('refused-before-execution'),
    deduplicated: bool,
  }),
  durationMs: num,
});

/** How a tool's request ended. */
export const boundRequestEnd = shapeOf<RequestEnd>({
  outcome: oneOf('answered', 'cancelled', 'cut', 'failed', 'refused', 'timed-out'),
  reason: requestReason,
  status: num,
  kind: requestRefusalKind,
  failure: requestFailure,
  during: oneOf('request', 'wait'),
  error: requestError,
  remote: oneOf('unknown'),
  attempts: num,
  effect: requestEffect,
  mayHaveRun: bool,
});
