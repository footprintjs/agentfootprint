/**
 * exportTrace — capture an agent run's full state into a portable JSON
 * blob for sharing externally (paste into a viewer, ship to support, log
 * for debugging, store in a database).
 *
 * Defaults to **redacted** output: snapshots come from
 * `getSnapshot({ redact: true })` (footprintjs 4.14+), so values for keys
 * listed in `RedactionPolicy.keys` / matching `patterns` arrive as
 * `'REDACTED'` instead of raw. The commit log is already redacted at
 * write-time. Combined with `emitPatterns` (also redacted at origin), the
 * exported trace is safe to share when the caller has configured a policy.
 *
 * **Without a redaction policy, this helper still emits a trace — but
 * `sharedState` will contain raw values.** Configure `setRedactionPolicy`
 * before calling this for any externally shared trace.
 *
 * @example
 * ```ts
 * import { Agent, exportTrace, anthropic } from 'agentfootprint';
 *
 * const agent = Agent.create({ provider: anthropic('claude-sonnet-4') })
 *   .system('You are a customer support agent.')
 *   .build();
 *
 * await agent.run('My credit card 4242-4242-4242-4242 was declined');
 *
 * // Configure policy on the underlying executor for full safety
 * // (concept-level recorder API for this is a follow-up).
 * const trace = exportTrace(agent);
 * console.log(JSON.stringify(trace, null, 2));
 * // → paste into the playground viewer, send to support, etc.
 * ```
 */

import type { RunnerLike } from './types';

/**
 * Schema-versioned, JSON-safe representation of a single agent run.
 *
 * Pin the consumer side to `schemaVersion: 1`. Any breaking change to the
 * shape ships as a new schema version with a clear migration note.
 */
export interface AgentfootprintTrace {
  /** Schema version. Always `1` in this release. */
  readonly schemaVersion: 1;
  /** ISO 8601 timestamp the trace was exported. */
  readonly exportedAt: string;
  /** True when `sharedState` came from the redacted mirror. */
  readonly redacted: boolean;
  /**
   * Full execution snapshot — `sharedState`, `executionTree`, `commitLog`,
   * `subflowResults`, and any recorder snapshots. The exact shape matches
   * `footprintjs.RuntimeSnapshot`. May be omitted if the runner did not
   * expose `getSnapshot()`.
   */
  readonly snapshot?: unknown;
  /**
   * Structured per-step narrative entries. Use this to render a timeline
   * UI; each entry has a `type`, `text`, `depth`, and `runtimeStageId`.
   */
  readonly narrativeEntries?: unknown[];
  /** Flat string-list narrative — convenience view for logs / chat UIs. */
  readonly narrative?: string[];
  /**
   * Flowchart spec — node + edge metadata for rendering the topology of
   * what ran. Stable across runs of the same agent shape.
   */
  readonly spec?: unknown;
}

/** Optional shape — RunnerLike augmented with the optional methods we read. */
interface ExportableRunner extends RunnerLike {
  /**
   * Snapshot accessor. May accept `{ redact: boolean }` (footprintjs 4.14+).
   * Older snapshots ignore the argument and return raw — safe fallback.
   */
  getSnapshot?(options?: { redact?: boolean }): unknown;
  getNarrativeEntries?(): unknown[];
  getNarrative?(): string[];
  getSpec?(): unknown;
}

export interface ExportTraceOptions {
  /**
   * When `true` (the default), request `getSnapshot({ redact: true })` from
   * the runner so `sharedState` is scrubbed via the redacted-mirror feature.
   * Set to `false` only for in-process debugging where the raw view is
   * needed and the trace will not leave the local machine.
   */
  readonly redact?: boolean;
}

/**
 * Capture a full execution trace from any runner exposing the standard
 * introspection surface (`getSnapshot`, `getNarrative*`, `getSpec`).
 * All of those methods are optional — missing methods skip the field.
 *
 * Always returns a JSON-stringify-safe object.
 */
export function exportTrace(runner: RunnerLike, options?: ExportTraceOptions): AgentfootprintTrace {
  const redact = options?.redact !== false; // default true
  const r = runner as ExportableRunner;

  // `getSnapshot` may be the older 0-arg form — still safe to call with
  // an arg (JS ignores extras), but keep our intent explicit so older
  // overloads with strict signatures don't trip the type checker.
  let snapshot: unknown;
  try {
    snapshot = r.getSnapshot?.({ redact });
  } catch {
    // Fall back to the 0-arg form if the runner's signature rejects the
    // options object (older custom runners). Result will be raw — caller
    // is responsible for the safety implication when this happens.
    try {
      snapshot = (r.getSnapshot as undefined | (() => unknown))?.();
    } catch {
      snapshot = undefined;
    }
  }

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    redacted: redact,
    snapshot,
    narrativeEntries: r.getNarrativeEntries?.(),
    narrative: r.getNarrative?.(),
    spec: r.getSpec?.(),
  };
}
