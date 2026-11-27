/** Retain Bedrock's local SDK preparation facts on the existing call receipt. */
import type { TypedScope } from 'footprintjs';
import { ownData } from '../../../../lib/boundedJson.js';
import { RECEIPT_KEY } from '../../../../lib/conventions.js';
import {
  observeCacheCommands,
  type CacheCommandObserver,
} from '../../../../provider-contract/requestObserver.js';
import type { LLMCallHooks, LLMResponse } from '../../../../provider-contract/types.js';
import type { ReceiptCacheCommand } from '../../receipt/cacheTypes.js';
import type { AgentState } from '../../types.js';

const MAX_COMMANDS = 16;
const USAGE_COUNTERS = ['input', 'output', 'cacheRead', 'cacheWrite', 'thinking'] as const;

type UsageSnapshot = Readonly<Record<string, unknown>>;
type CommandResponse = { readonly ordinal: number; readonly usage: UsageSnapshot };

/** Keep the adapter's normalized counters detached from later provider wrappers. */
function snapshotUsage(response: LLMResponse): UsageSnapshot | undefined {
  try {
    const usage = Object.getOwnPropertyDescriptor(response, 'usage');
    return usage !== undefined && 'value' in usage
      ? ownData(usage.value, USAGE_COUNTERS)
      : undefined;
  } catch {
    return undefined;
  }
}

function matchesUsage(recorded: UsageSnapshot, response: LLMResponse): boolean {
  const current = snapshotUsage(response);
  return (
    current !== undefined &&
    USAGE_COUNTERS.every(
      (key) =>
        Object.hasOwn(recorded, key) === Object.hasOwn(current, key) &&
        Object.is(recorded[key], current[key]),
    )
  );
}

export function trackCacheCommands(scope: TypedScope<AgentState>) {
  let rows: ReceiptCacheCommand[] | undefined;
  let ordinals: Map<symbol, number> | undefined;
  let responses: WeakMap<LLMResponse, CommandResponse> | undefined;
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
        const usage = snapshotUsage(response);
        if (usage !== undefined) (responses ??= new WeakMap()).set(response, { ordinal, usage });
      },
    };
  };

  return {
    hooks: (hooks: LLMCallHooks) => observeCacheCommands(hooks, observe),
    preserve(before: LLMResponse, after: LLMResponse): void {
      if (before === after) return;
      const binding = responses?.get(before);
      if (binding !== undefined) responses?.set(after, binding);
    },
    accept(response: LLMResponse): void {
      const binding = responses?.get(response);
      publish(
        binding !== undefined && matchesUsage(binding.usage, response) ? binding.ordinal : null,
      );
    },
  };
}
