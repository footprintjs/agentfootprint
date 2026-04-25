/**
 * LoggingRecorder — firehose-style structured logging of every v2 event.
 *
 * Pattern: Facade over EventDispatcher's wildcard subscription.
 * Role:    Tier 3 observability — enabled via `agent.enable.logging({...})`.
 *          Developer debugging tool; production typically uses an OTEL
 *          recorder instead.
 * Emits:   Does NOT emit; READS the dispatcher and writes to the logger.
 *
 * Filtering: consumer picks DOMAINS by name — the same domain segment that
 * appears in event types (`agentfootprint.<domain>.<action>`). No internal
 * tier jargon leaks into the public API.
 */

import type { EventDispatcher, Unsubscribe } from '../../events/dispatcher.js';
import type { AgentfootprintEvent } from '../../events/registry.js';

/**
 * Minimal logger shape — structurally compatible with console, winston,
 * pino, etc. Consumers pass their existing logger.
 */
export interface LoggingLogger {
  log(message: string, data?: unknown): void;
}

/**
 * Domain constants — one per event-registry domain. Use these instead of
 * raw strings for autocomplete, typo protection, and rename safety.
 *
 * Raw strings still work (backed by the same literal union type below).
 *
 * @example
 *   agent.enable.logging({ domains: [LoggingDomains.CONTEXT, LoggingDomains.STREAM] });
 *   agent.enable.logging({ domains: ['context', 'stream'] }); // equivalent
 */
export const LoggingDomains = {
  /** Context-engineering events (the 3-slot model). THE DEBUG CORE. */
  CONTEXT: 'context',
  /** LLM + tool request/response stream. */
  STREAM: 'stream',
  /** Composition control flow (Sequence / Parallel / Conditional / Loop). */
  COMPOSITION: 'composition',
  /** Agent lifecycle (turn · iteration · route_decided · handoff). */
  AGENT: 'agent',
  /** Memory strategy + store operations. */
  MEMORY: 'memory',
  /** Tool offered / activated / deactivated. */
  TOOLS: 'tools',
  /** Skill activation + deactivation. */
  SKILL: 'skill',
  /** Permission checks + gates. */
  PERMISSION: 'permission',
  /** Risk / guardrail detections. */
  RISK: 'risk',
  /** Provider / tool / skill fallback triggers. */
  FALLBACK: 'fallback',
  /** Cost + budget tracking. */
  COST: 'cost',
  /** Eval scores + threshold crossings. */
  EVAL: 'eval',
  /** Error retries + recoveries. */
  ERROR: 'error',
  /** Pause / resume requests. */
  PAUSE: 'pause',
  /** Embedding generation. */
  EMBEDDING: 'embedding',
} as const;

/**
 * Domain name — the middle segment of event types
 * (`agentfootprint.<domain>.<action>`). Consumers already see these in
 * the events they subscribe to; reusing them here avoids teaching a
 * new taxonomy.
 */
export type LoggingDomain = (typeof LoggingDomains)[keyof typeof LoggingDomains];

export interface LoggingOptions {
  /** Logger sink. Defaults to console. */
  readonly logger?: LoggingLogger;
  /**
   * Domains to log. Pass `'all'` for firehose (including consumer custom
   * events). Default: `['context', 'stream']` — the core debugging lens
   * (what went into the LLM, what came out).
   */
  readonly domains?: readonly LoggingDomain[] | 'all';
  /** Custom formatter. Default: `[domain.action]`. */
  readonly format?: (event: AgentfootprintEvent) => string;
}

/**
 * Attach a logging subscription to the v2 event dispatcher.
 * Returns an Unsubscribe — call to detach.
 */
export function attachLogging(
  dispatcher: EventDispatcher,
  options: LoggingOptions = {},
): Unsubscribe {
  const logger = options.logger ?? defaultLogger();
  const domains = options.domains ?? ['context', 'stream'];
  const logAll = domains === 'all';
  const prefixes: readonly string[] = logAll
    ? []
    : (domains as readonly LoggingDomain[]).map((d) => `agentfootprint.${d}.`);
  const format = options.format ?? defaultFormat;

  return dispatcher.on('*', (event: AgentfootprintEvent) => {
    if (!shouldLog(event.type, logAll, prefixes)) return;
    logger.log(format(event), event.payload);
  });
}

function shouldLog(name: string, logAll: boolean, prefixes: readonly string[]): boolean {
  if (logAll) return true;
  for (const p of prefixes) if (name.startsWith(p)) return true;
  return false;
}

function defaultFormat(event: AgentfootprintEvent): string {
  const short = event.type.replace(/^agentfootprint\./, '');
  return `[${short}]`;
}

function defaultLogger(): LoggingLogger {
  return {
    log: (msg, data) => {
      // eslint-disable-next-line no-console
      if (data === undefined) console.log(msg);
      // eslint-disable-next-line no-console
      else console.log(msg, data);
    },
  };
}
