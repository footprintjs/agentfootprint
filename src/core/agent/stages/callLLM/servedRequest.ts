import type { TypedScope } from 'footprintjs';
import { abortableIterable, untilAborted } from '../../../../lib/abort.js';
import { matchesPreparedData } from '../../../../lib/matchesPreparedData.js';
import type {
  LLMCallHooks,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../../provider-contract/types.js';
import {
  observeRequests,
  requestAttempt,
  type RequestSettlement,
} from '../../../../provider-contract/requestObserver.js';
import { servedHistoryRow, type ServedRow } from '../../receipt/servedRow.js';
import type { AgentState } from '../../types.js';
import type { liveChunkEmitter } from './liveChunks.js';

/** Record only entries that kept their retained bodies through the known,
 * position-preserving history projection. Request-only messages follow it. */
export function servedRequestRecorder(
  scope: TypedScope<AgentState>,
  history: readonly LLMMessage[],
  projected: readonly LLMMessage[],
  preparedFrom: readonly LLMMessage[],
  detached: { readonly request: LLMRequest },
) {
  const consumer = scope.$attempt?.().series;
  if (!consumer) return undefined;
  const whole = Array.from(history, (entry, index) => {
    const message = projected[index];
    return message?.role === entry.role && message.content === entry.content;
  });
  const row = servedHistoryRow(consumer, whole);
  // The port copy is the only one handed to the strategy. Keep its original
  // position identities and compare against the untouched library messages.
  const wire = detached.request.messages;
  const ordered = [...wire];
  let previous: readonly ServedRow[] | undefined;
  let first: PropertyDescriptorMap | undefined;
  let discarded = false;

  function discard(): void {
    if (first !== undefined) {
      if (previous === undefined) scope.$delete('sourceLinkServedRows');
      else scope.sourceLinkServedRows = previous;
      first = undefined;
    }
    discarded = true;
  }

  return {
    discard,
    beforeRequest(request: LLMRequest): void {
      if (discarded) return;
      const signature = requestHead(request);
      // A replacement messages array may have reordered even identical
      // messages. Its entries do not have proved positions in this view.
      if (
        signature === undefined ||
        signature.messages?.value !== wire ||
        ordered.length !== wire.length ||
        !ordered.every((message, index) => {
          const current = Object.getOwnPropertyDescriptor(wire, String(index));
          return current?.value === message && matchesPreparedData(preparedFrom[index], message);
        })
      ) {
        discard();
        return;
      }
      if (first !== undefined) {
        if (!sameRequest(first, signature)) discard();
        return;
      }
      const retained = scope.sourceLinkServedRows;
      previous = retained === undefined ? undefined : [...retained];
      scope.sourceLinkServedRows = [...(previous ?? []), row];
      first = signature;
    },
  };
}

/** Compare readonly port requests without serializing values or invoking
 * getters. A cloned field is conservatively treated as a different request. */
function requestHead(request: LLMRequest): PropertyDescriptorMap | undefined {
  const { signal: _signal, ...fields } = Object.getOwnPropertyDescriptors(request);
  void _signal;
  if (!Object.values(fields).every((field) => 'value' in field)) return undefined;
  return fields;
}

function sameRequest(first: PropertyDescriptorMap, next: PropertyDescriptorMap): boolean {
  const keys = Object.keys(first);
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) => Object.hasOwn(next, key) && Object.is(first[key]?.value, next[key]?.value))
  );
}

/** Inspect the same leaf requests as the findings carrier, including replay preparation. */
export function observeCallRequests(
  hooks: LLMCallHooks,
  observe: ((request: LLMRequest) => void) | undefined,
  discardServing: (() => void) | undefined,
): LLMCallHooks {
  if (observe === undefined) return hooks;
  return observeRequests(
    {
      ...hooks,
      ...(discardServing !== undefined && {
        onResilience(report) {
          if (report.kind === 'fell-back') discardServing();
          hooks.onResilience?.(report);
        },
      }),
      onReplayPrepared(preparation) {
        hooks.onReplayPrepared?.(preparation);
        observe(preparation.request);
      },
    },
    observe,
  );
}

/** Observe the requested port values just before I/O and only until it settles. */
export async function completeObserved(
  provider: LLMProvider,
  request: LLMRequest,
  hooks: LLMCallHooks,
  signal: AbortSignal | undefined,
) {
  const attempt = requestAttempt(hooks, request, provider);
  let settlement: RequestSettlement = 'failed';
  try {
    const response = await untilAborted(provider.complete(request, attempt.hooks), signal);
    settlement = 'response';
    return response;
  } finally {
    attempt.close(settlement);
  }
}

export async function* streamObserved(
  provider: LLMProvider,
  request: LLMRequest,
  hooks: LLMCallHooks,
  signal: AbortSignal | undefined,
) {
  if (provider.stream === undefined) return;
  const attempt = requestAttempt(hooks, request, provider);
  try {
    const stream = abortableIterable(provider.stream(request, attempt.hooks), signal);
    if (attempt.observeChunk === undefined) {
      yield* stream;
    } else {
      for await (const chunk of stream) {
        attempt.observeChunk(chunk);
        yield chunk;
      }
    }
  } finally {
    attempt.close('no-response');
  }
}

/** Get the authoritative response, keeping stream and completion as separate attempts. */
export async function callObserved(
  provider: LLMProvider,
  request: LLMRequest,
  hooks: LLMCallHooks,
  signal: AbortSignal | undefined,
  liveChunks: ReturnType<typeof liveChunkEmitter>,
  completion: () => LLMRequest,
): Promise<LLMResponse> {
  let response: LLMResponse | undefined;
  if (provider.stream) {
    for await (const chunk of streamObserved(provider, request, hooks, signal)) {
      if (chunk.done) {
        response = chunk.response;
        break;
      }
      liveChunks.push(chunk);
    }
  }
  liveChunks.finish();
  // Older streams may end without a response. Re-read the prepared request
  // after streaming, and let each attempt report its own resilience events.
  // Raw failures still propagate to the reliability loop.
  return response || completeObserved(provider, completion(), hooks, signal);
}
