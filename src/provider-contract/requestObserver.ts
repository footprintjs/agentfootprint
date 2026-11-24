/** Private transport boundary; not a replay event or a provider capability. */
import type { LLMCallHooks, LLMMessage, LLMRequest, LLMResponse } from './types.js';

// Symbol.for follows the private inner-run/tool-session seams: a CJS wrapper
// and an ESM caller in one process see the same hook, never a wire field.
const REQUEST_OBSERVER = Symbol.for('agentfootprint.requestObserver');
const CITATION_OFFER = Symbol.for('agentfootprint.requestCitationOffer');

export interface CitationWireBody {
  readonly source: LLMMessage;
  readonly body: string;
  /** One-based position among tool result blocks in the submitted request. */
  readonly blockNumber: number;
}

interface PendingCitationOffer {
  readonly instruction: string;
  accept(response: LLMResponse): void;
}

type CitationOfferObserver = (
  rows: readonly CitationWireBody[],
) => PendingCitationOffer | undefined;

type ObservedHooks = LLMCallHooks & {
  readonly [REQUEST_OBSERVER]?: (request: LLMRequest) => void;
  readonly [CITATION_OFFER]?: CitationOfferObserver;
};

/** Attach a run-local observer without adding a public/model-facing hook. */
export function observeRequests(
  hooks: LLMCallHooks,
  observer: (request: LLMRequest) => void,
): LLMCallHooks {
  return { ...hooks, [REQUEST_OBSERVER]: observer } as ObservedHooks;
}

/** Attach the library's request-local offer builder without adding a wire or public hook. */
export function observeCitationOffers(
  hooks: LLMCallHooks,
  observe: CitationOfferObserver,
): LLMCallHooks {
  const observed: ObservedHooks = { ...hooks, [CITATION_OFFER]: observe };
  return observed;
}

/** Called only by an encoder that can attest to its final tool result blocks. */
export function prepareCitationOffer(
  hooks: LLMCallHooks | undefined,
  rows: readonly CitationWireBody[],
): PendingCitationOffer | undefined {
  return (hooks as ObservedHooks | undefined)?.[CITATION_OFFER]?.(rows);
}

export function observesCitationOffers(hooks: LLMCallHooks | undefined): boolean {
  return (hooks as ObservedHooks | undefined)?.[CITATION_OFFER] !== undefined;
}

/** A leaf owns these hooks only until its promise/iterator settles. */
export function requestAttempt(
  hooks: LLMCallHooks | undefined,
  request: LLMRequest,
): {
  readonly hooks: LLMCallHooks | undefined;
  close(): void;
} {
  const observed = hooks as ObservedHooks | undefined;
  const observer = observed?.[REQUEST_OBSERVER];
  const offers = observed?.[CITATION_OFFER];
  // Off-mode keeps the original hook object and all its behavior unchanged.
  if (observer === undefined && offers === undefined)
    return {
      hooks,
      close() {
        /* No observer lifetime exists off-mode. */
      },
    };
  observer?.(request);
  let active = true;
  const scoped: ObservedHooks = {
    ...hooks,
    ...(observer !== undefined && {
      [REQUEST_OBSERVER]: (next: LLMRequest) => {
        if (active) observer(next);
      },
    }),
    ...(offers !== undefined && {
      [CITATION_OFFER]: (rows: readonly CitationWireBody[]) => {
        if (!active) return undefined;
        const offer = offers(rows);
        if (offer === undefined) return undefined;
        let accepted = false;
        return {
          instruction: offer.instruction,
          accept(response: LLMResponse) {
            if (!active || accepted) return;
            accepted = true;
            offer.accept(response);
          },
        };
      },
    }),
    ...(hooks?.onResilience !== undefined && {
      onResilience: (report) => {
        if (active) hooks.onResilience?.(report);
      },
    }),
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
