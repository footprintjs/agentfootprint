import { captureAddress, captureOwn as own } from '../causeCapture.js';

/** A display projection of the public producer reader's admitted, immutable native prefix. */
export interface ClosedNativePrefix {
  readonly version: 1;
  readonly policy: 'native-root-prefix-v1';
  readonly scope: 'root-log';
  readonly status: 'closed';
  readonly boundary: 'failed';
  readonly selectedFailure: {
    readonly kind: 'invocation';
    readonly runId: string;
    readonly runtimeStageId: string;
    readonly attemptId: string;
  };
  readonly limitations: readonly string[];
}

/**
 * Recognize the policy this consumer understands AFTER the public producer reader has admitted it.
 * FootPrint owns closure/extent/count/attempt validation; these checks bind only the supported view.
 * This function is not an alternate reader or an issuer for caller-supplied live snapshot claims.
 */
export function projectClosedHistory(
  history: unknown,
  runId: string,
  commits: number,
): ClosedNativePrefix | 'unsupported' | undefined {
  const capture = own(history, 'capture');
  if (own(own(capture, 'boundary'), 'status') !== 'failed') return undefined;
  const closure = own(history, 'closure');
  if (closure === undefined) return undefined;
  const address = captureAddress(own(closure, 'logAddress'));
  const extent = own(closure, 'commits');
  const selected = own(closure, 'selectedFailure');
  const runtimeStageId = own(selected, 'runtimeStageId');
  const attemptId = own(selected, 'attemptId');
  const limitations = own(closure, 'limitations');
  if (
    own(closure, 'version') !== 1 ||
    own(closure, 'policy') !== 'native-root-prefix-v1' ||
    own(closure, 'scope') !== 'root-log' ||
    own(closure, 'status') !== 'closed' ||
    own(closure, 'boundary') !== 'failed' ||
    own(closure, 'runId') !== runId ||
    address?.logRunId !== runId ||
    own(extent, 'from') !== 0 ||
    own(extent, 'to') !== commits ||
    own(selected, 'kind') !== 'invocation' ||
    own(selected, 'runId') !== runId ||
    typeof runtimeStageId !== 'string' ||
    runtimeStageId.length === 0 ||
    runtimeStageId.length > 128 ||
    typeof attemptId !== 'string' ||
    attemptId.length === 0 ||
    attemptId.length > 2048 ||
    !Array.isArray(limitations) ||
    limitations.length > 16
  )
    return 'unsupported';
  const retained: string[] = [];
  for (let index = 0; index < limitations.length; index++) {
    const limit = own(limitations, String(index));
    if (typeof limit !== 'string' || limit.length === 0 || limit.length > 128) return 'unsupported';
    retained.push(limit);
  }
  return Object.freeze({
    version: 1,
    policy: 'native-root-prefix-v1',
    scope: 'root-log',
    status: 'closed',
    boundary: 'failed',
    selectedFailure: Object.freeze({ kind: 'invocation', runId, runtimeStageId, attemptId }),
    limitations: Object.freeze(retained),
  });
}
