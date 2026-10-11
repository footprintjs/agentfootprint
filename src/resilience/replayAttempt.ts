/** Carry only a leaf-approved replay retirement across one call's attempts. */
import type { LLMCallHooks, LLMChunk, LLMRequest, LLMResponse } from '../adapters/types.js';
import type { ThinkingReplayOmission } from '../thinking/replay.js';
import { retireReplayHistory } from '../thinking/replayHistory.js';

/**
 * The leaf still chooses whether anything may be omitted. A retry or fallback
 * must remember that choice before its next attempt, even when the first wire
 * fails after preparation. Never adopt the whole prepared request: resolved
 * models, cache hints and other wire-local adjustments belong to that leaf.
 */
export function replayAttempts(request: LLMRequest, hooks?: LLMCallHooks) {
  let current = request;
  const reported = new Map<string, ThinkingReplayOmission>();

  function response(answer: LLMResponse): LLMResponse {
    if (reported.size === 0 && !answer.replayOmissions?.length) return answer;
    const total = new Map(reported);
    const existing = answer.replayOmissions ?? [];
    remember(total, existing);
    const omissions = [...total.values()];
    if (
      omissions.length === existing.length &&
      omissions.every((item, index) => omissionKey(item) === omissionKey(existing[index]))
    )
      return answer;
    return { ...answer, replayOmissions: omissions };
  }

  function chunk(item: LLMChunk): LLMChunk {
    if (!item.done || item.response === undefined) return item;
    const answer = response(item.response);
    return answer === item.response ? item : { ...item, response: answer };
  }

  function result(item: IteratorResult<LLMChunk>): IteratorResult<LLMChunk> {
    if (item.done) return item;
    const value = chunk(item.value);
    return value === item.value ? item : { ...item, value };
  }

  return {
    get request(): LLMRequest {
      return current;
    },
    /** The reliability loop explicitly owns feedback and other request changes. */
    replaceRequest(next: LLMRequest): void {
      current = next;
    },
    response,
    chunk,
    /** Preserve the underlying iterator's cancellation/throw protocol. */
    iterator(inner: AsyncIterator<LLMChunk>): AsyncIterator<LLMChunk> {
      const close = inner.return?.bind(inner);
      const raise = inner.throw?.bind(inner);
      return {
        next: async (...args) => result(await inner.next(...args)),
        ...(close && {
          return: async (...args: Parameters<typeof close>) => result(await close(...args)),
        }),
        ...(raise && {
          throw: async (...args: Parameters<typeof raise>) => result(await raise(...args)),
        }),
      };
    },
    hooks: {
      ...hooks,
      onReplayPrepared(preparation) {
        const messages = retireReplayHistory(current.messages, preparation);
        hooks?.onReplayPrepared?.(preparation);
        // A failed durable write must be attempted again, not hidden by a
        // local omission that lets the next leaf bypass that failed hook.
        if (messages !== current.messages) current = { ...current, messages };
        remember(reported, preparation.omissions);
      },
    } satisfies LLMCallHooks,
  };
}

/** All declared metadata fields identify one report; no model content is copied. */
function omissionKey(item: ThinkingReplayOmission): string {
  return JSON.stringify([
    item.messageIndex,
    item.blockIndex,
    item.reason,
    item.replayId ?? null,
    item.messageFingerprint,
  ]);
}

function remember(
  target: Map<string, ThinkingReplayOmission>,
  items: readonly ThinkingReplayOmission[],
): void {
  for (const item of items) {
    const key = omissionKey(item);
    if (!target.has(key))
      target.set(key, {
        messageIndex: item.messageIndex,
        blockIndex: item.blockIndex,
        reason: item.reason,
        ...(item.replayId !== undefined && { replayId: item.replayId }),
        messageFingerprint: item.messageFingerprint,
      });
  }
}
