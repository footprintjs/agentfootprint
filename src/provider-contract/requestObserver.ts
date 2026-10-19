/** Private transport boundary; not a replay event or a provider capability. */
import type { LLMCallHooks, LLMRequest } from './types.js';

// Symbol.for follows the private inner-run/tool-session seams: a CJS wrapper
// and an ESM caller in one process see the same hook, never a wire field.
const REQUEST_OBSERVER = Symbol.for('agentfootprint.requestObserver');
type ObservedHooks = LLMCallHooks & { readonly [REQUEST_OBSERVER]?: (request: LLMRequest) => void };

/** Attach a run-local observer without adding a public/model-facing hook. */
export function observeRequests(
  hooks: LLMCallHooks,
  observer: (request: LLMRequest) => void,
): LLMCallHooks {
  return { ...hooks, [REQUEST_OBSERVER]: observer } as ObservedHooks;
}

/** A leaf owns these hooks only until its promise/iterator settles. */
export function requestAttempt(
  hooks: LLMCallHooks | undefined,
  request: LLMRequest,
): {
  readonly hooks: LLMCallHooks | undefined;
  close(): void;
} {
  const observer = (hooks as ObservedHooks | undefined)?.[REQUEST_OBSERVER];
  // Off-mode keeps the original hook object and all its behavior unchanged.
  if (observer === undefined)
    return {
      hooks,
      close() {
        /* No observer lifetime exists off-mode. */
      },
    };
  observer(request);
  let active = true;
  const scoped: ObservedHooks = {
    ...hooks,
    [REQUEST_OBSERVER]: (next) => {
      if (active) observer(next);
    },
    onReplayPrepared: (preparation) => {
      if (active) hooks?.onReplayPrepared?.(preparation);
    },
  };
  return {
    hooks: scoped,
    close() {
      active = false;
    },
  };
}
