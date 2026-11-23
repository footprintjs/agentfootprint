/** Private transport boundary; not a replay event or a provider capability. */
import type { LLMCallHooks, LLMChunk, LLMRequest } from './types.js';

// Symbol.for follows the private inner-run/tool-session seams: a CJS wrapper
// and an ESM caller in one process see the same hook, never a wire field.
const REQUEST_OBSERVER = Symbol.for('agentfootprint.requestObserver');
const ATTEMPT_OBSERVER = Symbol.for('agentfootprint.requestAttemptObserver');
const ACTIVE_ATTEMPT = Symbol.for('agentfootprint.activeRequestAttempt');

export type RequestSettlement = 'response' | 'no-response' | 'failed' | 'not-dispatched';

export type RequestAttemptObservation =
  | {
      readonly kind: 'start';
      readonly id: symbol;
      readonly parent?: symbol;
      readonly request: LLMRequest;
    }
  | { readonly kind: 'prepare'; readonly id: symbol; readonly request: LLMRequest }
  | { readonly kind: 'redirect'; readonly id: symbol }
  | {
      readonly kind: 'settle';
      readonly id: symbol;
      readonly settlement: RequestSettlement;
      readonly request: LLMRequest;
    };

type ObservedHooks = LLMCallHooks & {
  readonly [REQUEST_OBSERVER]?: (request: LLMRequest) => void;
  readonly [ATTEMPT_OBSERVER]?: (observation: RequestAttemptObservation) => void;
  readonly [ACTIVE_ATTEMPT]?: { readonly id: symbol; readonly refuse: () => void };
};

/** Attach a run-local observer without adding a public/model-facing hook. */
export function observeRequests(
  hooks: LLMCallHooks,
  observer: (request: LLMRequest) => void,
): LLMCallHooks {
  return { ...hooks, [REQUEST_OBSERVER]: observer } as ObservedHooks;
}

/** Observe attempt pairing on the same private hook as request preparation. */
export function observeRequestAttempts(
  hooks: LLMCallHooks,
  observer: (observation: RequestAttemptObservation) => void,
): LLMCallHooks {
  return { ...hooks, [ATTEMPT_OBSERVER]: observer } as ObservedHooks;
}

/** Only a boundary that refused before entering its provider can file this. */
export function refuseObservedRequest(hooks: LLMCallHooks | undefined): void {
  (hooks as ObservedHooks | undefined)?.[ACTIVE_ATTEMPT]?.refuse();
}

/** A leaf owns these hooks only until its promise/iterator settles. */
export function requestAttempt(
  hooks: LLMCallHooks | undefined,
  request: LLMRequest,
): {
  readonly hooks: LLMCallHooks | undefined;
  readonly observeChunk?: (chunk: LLMChunk) => void;
  close(settlement?: RequestSettlement): void;
} {
  const prior = hooks as ObservedHooks | undefined;
  const observer = prior?.[REQUEST_OBSERVER];
  const attempts = prior?.[ATTEMPT_OBSERVER];
  // Off-mode keeps the original hook object and all its behavior unchanged.
  if (observer === undefined && attempts === undefined)
    return {
      hooks,
      close() {
        /* No observer lifetime exists off-mode. */
      },
    };
  observer?.(request);
  let active = true;
  const id = attempts === undefined ? undefined : Symbol();
  const parent = prior?.[ACTIVE_ATTEMPT]?.id;
  if (id !== undefined) attempts?.({ kind: 'start', id, parent, request });
  let refused = false;
  let responded = false;
  let effective = request;
  const scoped: ObservedHooks = {
    ...hooks,
    ...(observer !== undefined && {
      [REQUEST_OBSERVER]: (next: LLMRequest) => {
        if (active) observer(next);
      },
    }),
    ...(attempts !== undefined &&
      id !== undefined && {
        [ATTEMPT_OBSERVER]: (next: RequestAttemptObservation) => {
          if (active) attempts(next);
        },
        [ACTIVE_ATTEMPT]: {
          id,
          refuse: () => {
            if (active) refused = true;
          },
        },
      }),
    ...((hooks?.onResilience !== undefined || attempts !== undefined) && {
      onResilience: (report) => {
        if (!active) return;
        if (id !== undefined && (report.kind === 'fell-back' || report.kind === 'retried'))
          attempts?.({ kind: 'redirect', id });
        hooks?.onResilience?.(report);
      },
    }),
    onReplayPrepared: (preparation) => {
      if (!active) return;
      hooks?.onReplayPrepared?.(preparation);
      if (id !== undefined) {
        effective = preparation.request;
        attempts?.({ kind: 'prepare', id, request: preparation.request });
      }
    },
  };
  return {
    hooks: scoped,
    ...(attempts !== undefined && {
      observeChunk(chunk: LLMChunk) {
        if (active && chunk.done && chunk.response !== undefined) responded = true;
      },
    }),
    close(settlement = 'failed') {
      if (!active) return;
      active = false;
      if (id !== undefined) {
        attempts?.({
          kind: 'settle',
          id,
          settlement: refused ? 'not-dispatched' : responded ? 'response' : settlement,
          request: effective,
        });
      }
    },
  };
}
