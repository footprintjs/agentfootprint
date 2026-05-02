/**
 * `consoleObservability()` — default ObservabilityStrategy.
 *
 * Pattern: Strategy. Adapter for `globalThis.console`. Used when no
 *          vendor-specific strategy is configured (zero-config dev
 *          experience). Same role as `NoOpCacheStrategy` is for the
 *          cache layer.
 * Role:    Tier-1 fallback — print every event to the console with a
 *          one-line type+payload summary. Vendor-neutral, dependency-
 *          free, works in browser + Node + Deno + Bun.
 *
 * Use when:
 *   - Local development (`agent.enable.observability()` with no opts)
 *   - CI logs ("what events fired during this test?")
 *   - Tier-1 of compose chains (`compose([console(), datadog()])`)
 *
 * Don't use when: production. Console output is unstructured + can't
 * be queried; switch to a vendor strategy (Datadog, OTel, CloudWatch).
 */

import type { AgentfootprintEvent } from '../../events/registry.js';
import type { ObservabilityStrategy } from '../types.js';

export interface ConsoleObservabilityOptions {
  /**
   * Where to write. Defaults to `globalThis.console`. Override for
   * tests or to wrap with a custom sink (browser DevTools' grouped
   * console, a Node.js stream, etc.).
   */
  readonly logger?: { log(...args: unknown[]): void };
  /**
   * Custom line formatter. Receives the typed event; returns the line.
   * Defaults to `[type] payload-as-JSON`. Override to colorize, filter
   * fields, or pretty-print.
   */
  readonly format?: (event: AgentfootprintEvent) => string;
}

/**
 * Default formatter — emits a single structured JSON line per event.
 * Honeycomb / Datadog / Loki / any structured-log pipeline can ingest
 * directly; `grep` still works because every line is `{` … `}`.
 *
 * Shape: `{type, ...payload}` — flattens payload to top level so
 * filter expressions like `.type == "agentfootprint.cost.tick"` work
 * without nesting.
 */
const DEFAULT_FORMAT = (event: AgentfootprintEvent): string => {
  const payload =
    typeof event.payload === 'object' && event.payload !== null
      ? event.payload
      : { value: event.payload };
  return safeJson({ type: event.type, ...payload });
};

/**
 * Factory. Returns a fresh ObservabilityStrategy each call so multiple
 * agents in the same process get independent instances.
 */
export function consoleObservability(
  opts: ConsoleObservabilityOptions = {},
): ObservabilityStrategy {
  const sink = opts.logger ?? globalThis.console;
  const format = opts.format ?? DEFAULT_FORMAT;
  return {
    name: 'console',
    capabilities: { events: true, logs: true },
    exportEvent(event: AgentfootprintEvent): void {
      sink.log(format(event));
    },
  };
}

/** JSON.stringify with circular-safety. Avoids breaking the agent loop
 *  if a payload contains a circular ref. Returns the type alone if
 *  serialization fails. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}
