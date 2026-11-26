/** Retain Bedrock's local SDK preparation facts on the existing call receipt. */
import type { TypedScope } from 'footprintjs';
import { RECEIPT_KEY } from '../../../../lib/conventions.js';
import {
  observeCacheCommands,
  type CacheCommandObserver,
} from '../../../../provider-contract/requestObserver.js';
import type { LLMCallHooks, LLMResponse } from '../../../../provider-contract/types.js';
import type { ReceiptCacheCommand } from '../../receipt/cacheTypes.js';
import type { AgentState } from '../../types.js';

const MAX_COMMANDS = 16;

export function trackCacheCommands(scope: TypedScope<AgentState>) {
  let rows: ReceiptCacheCommand[] | undefined;
  let ordinals: Map<symbol, number> | undefined;
  let responses: WeakMap<LLMResponse, number> | undefined;
  let overflow = false;

  function publish(accepted?: number | null): void {
    if (rows === undefined) return;
    const receipt = scope[RECEIPT_KEY];
    if (receipt === undefined) return;
    scope[RECEIPT_KEY] = {
      ...receipt,
      cache: {
        ...receipt.cache,
        commandPreparations: [...rows],
        ...(overflow && { commandOverflow: true }),
        ...(accepted !== undefined && { acceptedCommand: accepted }),
      },
    };
  }

  const observe: CacheCommandObserver = (command) => {
    rows ??= [];
    if (rows.length >= MAX_COMMANDS) {
      if (!overflow) {
        overflow = true;
        publish();
      }
      return undefined;
    }
    ordinals ??= new Map();
    const id = Symbol();
    const ordinal = rows.length + 1;
    const parent =
      command.fallbackFrom === undefined ? undefined : ordinals.get(command.fallbackFrom);
    ordinals.set(id, ordinal);
    rows.push({
      ordinal,
      operation: command.operation,
      reason: command.reason,
      points: command.points,
      wire: 'unknown',
      ...(parent !== undefined && { fallbackFrom: parent }),
    });
    publish();
    return {
      id,
      response(response: LLMResponse) {
        (responses ??= new WeakMap()).set(response, ordinal);
      },
    };
  };

  return {
    hooks: (hooks: LLMCallHooks) => observeCacheCommands(hooks, observe),
    preserve(before: LLMResponse, after: LLMResponse): void {
      if (before === after) return;
      const ordinal = responses?.get(before);
      if (ordinal !== undefined) responses?.set(after, ordinal);
    },
    accept(response: LLMResponse): void {
      publish(responses?.get(response) ?? null);
    },
  };
}
