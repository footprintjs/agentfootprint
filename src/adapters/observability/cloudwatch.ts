/**
 * cloudwatchObservability — Generic AWS CloudWatch Logs adapter.
 *
 * Ships every `AgentfootprintEvent` to a CloudWatch Logs stream. Use
 * when you want agent telemetry alongside the rest of your AWS
 * observability stack — CloudWatch Insights queries, alarms,
 * cross-service correlation. Same SDK as `agentcoreObservability`
 * but **without** the AgentCore-specific defaults (log-stream
 * convention, format opinions). Use this when:
 *
 *   1. You're shipping to CloudWatch but NOT running inside Bedrock
 *      AgentCore (most common case).
 *   2. You want full control over log group / stream / format and
 *      don't need AgentCore's hosted-agent telemetry conventions.
 *
 * Subpath:  `agentfootprint/observability-providers`
 * Peer dep: `@aws-sdk/client-cloudwatch-logs` (OPTIONAL — installed
 *           only when this adapter is used; declared via
 *           `peerDependenciesMeta.{name}.optional = true`).
 *
 * This module also exports the underlying base function used by
 * `agentcoreObservability` — keeps the per-event hot path in one
 * place so improvements (batching, retry, backpressure) flow to
 * every CloudWatch-shaped adapter automatically.
 *
 * @example
 * ```ts
 * import { cloudwatchObservability } from 'agentfootprint/observability-providers';
 * import { microtaskBatchDriver } from 'footprintjs/detach';
 *
 * agent.enable.observability({
 *   strategy: cloudwatchObservability({
 *     region: 'us-east-1',
 *     logGroupName: '/myapp/agent-prod',
 *     logStreamName: `${process.env.HOSTNAME}/${Date.now()}`,
 *   }),
 *   detach: { driver: microtaskBatchDriver, mode: 'forget' },
 * });
 * ```
 */

import type { AgentfootprintEvent } from '../../events/registry.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import type { ObservabilityStrategy } from '../../strategies/types.js';

import { rateLimitedConsoleSink } from './deliveryErrors.js';

// ─── Public options ──────────────────────────────────────────────────

export interface CloudwatchObservabilityOptions {
  /** AWS region. Falls back to AWS_REGION / AWS_DEFAULT_REGION env. */
  readonly region?: string;
  /** CloudWatch Logs log group. **Required, and it must already exist.**
   *  This adapter never creates it: a log group carries retention and
   *  encryption decisions that belong to whoever provisions your account
   *  (a group created with default retention never expires — an unbounded
   *  bill), so provisioning it is control-plane work, same as the rest of
   *  your infrastructure. Naming a group that does not exist means no
   *  telemetry is delivered; the failure is reported through
   *  {@link CloudwatchObservabilityOptions.onError}. */
  readonly logGroupName: string;
  /** CloudWatch Logs log stream within the group. Conventionally
   *  `<host>/<startTime>` so multi-instance deployments don't collide.
   *  Created on first delivery if it does not exist — your role must allow
   *  `logs:CreateLogStream`. The log GROUP is not created for you (see
   *  {@link CloudwatchObservabilityOptions.logGroupName}). Defaults to
   *  `agentfootprint`. */
  readonly logStreamName?: string;
  /** Max events buffered before forced flush. Default 100. */
  readonly maxBatchEvents?: number;
  /** Max payload bytes (UTF-8) buffered before forced flush. Default
   *  10240 (10 KB). CloudWatch hard caps at 1 MB / batch but we keep
   *  the default low so latency stays bounded. */
  readonly maxBatchBytes?: number;
  /** Forced-flush interval when traffic is sparse. Default 1000ms.
   *  `0` disables time-based flush — only size triggers fire. */
  readonly flushIntervalMs?: number;
  /**
   * Where delivery failures go (8.11.0).
   *
   * Shipping telemetry is network I/O and it fails: a missing log group, an
   * IAM denial, throttling, a batch CloudWatch rejects. Without this, those
   * failures reach the default sink — a rate-limited `console.error` — because
   * **telemetry that fails invisibly is indistinguishable from telemetry that
   * works**, and an exporter silently dropping every event is the worst
   * outcome this adapter can produce.
   *
   * Set this to route failures into your own logger instead. You receive
   * EVERY failure (the rate limiting applies only to the console fallback);
   * the batch that failed is dropped, never requeued, so an outage cannot
   * grow the buffer without bound.
   *
   * Equivalent to assigning the strategy's `_onError` property after
   * construction, but visible at the call site.
   */
  readonly onError?: (error: Error, event?: AgentfootprintEvent) => void;
  /** Test injection — bypasses SDK lazy-require entirely. When set,
   *  `region` / IAM are ignored. */
  readonly _client?: CloudWatchLikeClient;
}

// ─── SDK-shaped surface (just what we use) ───────────────────────────

export interface CloudWatchLikeClient {
  putLogEvents(input: {
    logGroupName: string;
    logStreamName: string;
    logEvents: ReadonlyArray<{ timestamp: number; message: string }>;
  }): Promise<unknown>;
  /**
   * Create the log stream (8.11.0). OPTIONAL so an existing `_client` test
   * double that only implements `putLogEvents` still type-checks — the real
   * SDK-backed client always provides it. When a put fails because the stream
   * does not exist and this is absent, the adapter reports the failure rather
   * than creating anything.
   */
  createLogStream?(input: { logGroupName: string; logStreamName: string }): Promise<unknown>;
}

interface CloudWatchSdkModule {
  readonly CloudWatchLogsClient?: new (config: { region?: string }) => unknown;
  readonly PutLogEventsCommand?: new (input: unknown) => unknown;
  readonly CreateLogStreamCommand?: new (input: unknown) => unknown;
}

// ─── Generic base — also used by agentcoreObservability ──────────────

/**
 * Internal: shared CloudWatch Logs base used by every adapter that
 * ships to CWL. `cloudwatchObservability` is the public generic
 * factory; `agentcoreObservability` calls this with AgentCore-flavored
 * defaults.
 *
 * Exported for adapter authors only — consumers should call
 * `cloudwatchObservability` or `agentcoreObservability` directly.
 *
 * @internal
 */
export function _buildCloudWatchObservability(
  opts: CloudwatchObservabilityOptions,
  strategyName: string,
): ObservabilityStrategy {
  if (!opts.logGroupName) {
    throw new TypeError(
      `[${strategyName}Observability] \`logGroupName\` is required. ` +
        `Pass an existing CloudWatch log group, e.g. '/myapp/agent-prod'.`,
    );
  }

  const logStreamName = opts.logStreamName ?? 'agentfootprint';
  const maxBatchEvents = opts.maxBatchEvents ?? 100;
  const maxBatchBytes = opts.maxBatchBytes ?? 10_240;
  const flushIntervalMs = opts.flushIntervalMs ?? 1000;

  // Buffered batch — drained by `flush()` / size-trigger / time-trigger.
  const buffer: Array<{ timestamp: number; message: string }> = [];
  let bufferBytes = 0;
  let lastFlushPromise: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  // What we know about the log stream (8.11.0). This is the per-(group,stream)
  // create latch — group and stream are fixed for the life of a strategy, so
  // one tri-state IS that latch:
  //   'unknown'     — never delivered yet, or the stream vanished under us
  //   'created'     — we created it, or a put has succeeded against it
  //   'unavailable' — a create attempt failed for a reason retrying won't fix
  //                   (no permission, missing GROUP). Never attempt again.
  // 'created' is deliberately NOT terminal: a retention policy can delete a
  // stream mid-process, and the next ResourceNotFoundException should heal it.
  // Only 'unavailable' is terminal, which is what stops a create/put loop.
  let streamState: 'unknown' | 'created' | 'unavailable' = 'unknown';

  // The fallback when the consumer wires nothing. Rate-limited; a
  // consumer-supplied sink is not.
  const consoleSink = rateLimitedConsoleSink(strategyName);

  // Lazy-resolved on first flush so consumers who never trigger a
  // flush (because nothing was emitted) don't even hit the SDK.
  let client: CloudWatchLikeClient | undefined = opts._client;
  function ensureClient(): CloudWatchLikeClient {
    if (client) return client;
    client = createCloudWatchClient(opts.region, strategyName);
    return client;
  }

  function scheduleTimedFlush(): void {
    if (timer || flushIntervalMs <= 0 || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void doFlush();
    }, flushIntervalMs);
  }

  /** Route a delivery failure through whatever `_onError` IS RIGHT NOW.
   *  Reading it at call time (rather than capturing a hook at construction)
   *  is the whole fix: a consumer who assigns `_onError` after building the
   *  strategy gets delivery failures, and one who doesn't still gets the
   *  default console sink. */
  function reportFailure(err: Error): void {
    strategy._onError?.(err);
  }

  async function putBatch(
    client: CloudWatchLikeClient,
    batch: ReadonlyArray<{ timestamp: number; message: string }>,
  ): Promise<void> {
    await client.putLogEvents({
      logGroupName: opts.logGroupName,
      logStreamName,
      logEvents: batch,
    });
  }

  async function doFlush(): Promise<void> {
    if (buffer.length === 0 || stopped) return;
    // Snapshot + clear so concurrent emits during the in-flight put
    // accumulate into the next batch.
    const batch = buffer.splice(0);
    bufferBytes = 0;
    try {
      const client = ensureClient();
      try {
        await putBatch(client, batch);
        streamState = 'created'; // a successful put proves the stream is there
        return;
      } catch (err) {
        // The one recoverable shape: CloudWatch rejects a put into a stream
        // that doesn't exist. Before 8.11.0 this adapter asserted that
        // precondition and never established it, so any stream name that
        // didn't already exist dropped every event, forever, in silence —
        // and the documented `${HOSTNAME}/${Date.now()}` convention can never
        // pre-exist, so following the docs guaranteed the bug.
        if (!isMissingStreamError(err) || streamState === 'unavailable') throw err;
        if (!client.createLogStream) {
          throw new Error(
            `log stream '${logStreamName}' does not exist in log group ` +
              `'${opts.logGroupName}', and the injected \`_client\` has no ` +
              `\`createLogStream\` to create it.`,
          );
        }
        try {
          await client.createLogStream({
            logGroupName: opts.logGroupName,
            logStreamName,
          });
        } catch (createErr) {
          // Two processes racing to create the same stream is normal and
          // expected — whoever lost the race still has a usable stream.
          if (!isAlreadyExistsError(createErr)) {
            // Anything else (no `logs:CreateLogStream`, or the log GROUP
            // itself is missing) will not fix itself. Latch it off so we
            // never loop, and say which of the two it probably is.
            streamState = 'unavailable';
            throw new Error(
              `could not create log stream '${logStreamName}' in log group ` +
                `'${opts.logGroupName}': ${errorMessage(createErr)}. Check that the log ` +
                `GROUP exists (this adapter never creates one) and that the role allows ` +
                `\`logs:CreateLogStream\`.`,
            );
          }
        }
        streamState = 'created';
        // Exactly ONE re-put of the same batch. Not a retry loop: if this
        // fails the events are gone, and saying so is better than growing a
        // buffer during an outage.
        await putBatch(client, batch);
      }
    } catch (err) {
      const cause = errorMessage(err);
      reportFailure(
        new Error(
          `${batch.length} event(s) dropped shipping to log group '${opts.logGroupName}' ` +
            `stream '${logStreamName}': ${cause}`,
        ),
      );
    }
  }

  function enqueue(event: AgentfootprintEvent): void {
    if (stopped) return;
    const message = JSON.stringify(event);
    const bytes = Buffer.byteLength(message, 'utf8');
    buffer.push({ timestamp: Date.now(), message });
    bufferBytes += bytes;

    if (buffer.length >= maxBatchEvents || bufferBytes >= maxBatchBytes) {
      // Size trigger — flush immediately. Chain onto last to preserve
      // CloudWatch's per-stream ordering requirement.
      lastFlushPromise = lastFlushPromise.then(doFlush, doFlush);
    } else {
      scheduleTimedFlush();
    }
  }

  const strategy: ObservabilityStrategy = {
    name: strategyName,
    capabilities: { events: true, logs: true },
    exportEvent: enqueue,
    /**
     * Drain the buffer. **The framework does not call this for you** — wire it
     * into your own shutdown or the last batch is lost:
     *
     *   process.on('SIGTERM', async () => { await strategy.flush(); strategy.stop(); });
     */
    async flush(): Promise<void> {
      // Drain anything pending. Awaits both an in-flight put AND any
      // newly-buffered events that arrived during it.
      while (buffer.length > 0 || lastFlushPromise !== Promise.resolve()) {
        const before = lastFlushPromise;
        await before;
        if (buffer.length > 0) {
          lastFlushPromise = doFlush();
        }
        // Loop one more pass if the chained doFlush() queued more
        // work, then bail.
        if (lastFlushPromise === before && buffer.length === 0) break;
      }
    },
    /** Stop the flush timer. **The framework does not call this for you** —
     *  an un-stopped strategy keeps a `setTimeout` alive. */
    stop(): void {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    /**
     * Where errors go. Two callers: the dispatch layer (when `exportEvent`
     * itself throws) and this adapter's own delivery path.
     *
     * Before 8.11.0 this method lazily installed the console fallback INSIDE
     * itself, so a delivery failure — which reads the hook rather than calling
     * this method — found `undefined` and vanished. The fallback now exists
     * from construction, and delivery failures route through this method,
     * which means overriding it works: assign `_onError`, or pass `onError`
     * in the factory options, and you receive delivery failures too.
     */
    _onError(err: Error, event?: AgentfootprintEvent): void {
      (opts.onError ?? consoleSink)(err, event);
    },
  };

  return strategy;
}

// ─── Error shape helpers ─────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Did this put fail because the log stream isn't there?
 *
 * Matched on `name` first (how the AWS SDK v3 surfaces it) with a message
 * fallback, because a transport shim or an injected test double may carry the
 * code only in the text.
 */
function isMissingStreamError(err: unknown): boolean {
  if ((err as { name?: string })?.name === 'ResourceNotFoundException') return true;
  return /ResourceNotFoundException|log stream does not exist/i.test(errorMessage(err));
}

/** Lost a create race with another process. Not an error — the stream exists. */
function isAlreadyExistsError(err: unknown): boolean {
  if ((err as { name?: string })?.name === 'ResourceAlreadyExistsException') return true;
  return /ResourceAlreadyExistsException|already exists/i.test(errorMessage(err));
}

// ─── Public factory: cloudwatchObservability ─────────────────────────

/**
 * Generic CloudWatch Logs observability adapter. See
 * `CloudwatchObservabilityOptions` for the per-option contract.
 *
 * For AgentCore-specific conventions, use `agentcoreObservability`
 * which thin-wraps this with AgentCore-flavored defaults.
 */
export function cloudwatchObservability(
  opts: CloudwatchObservabilityOptions,
): ObservabilityStrategy {
  return _buildCloudWatchObservability(opts, 'cloudwatch');
}

// ─── SDK client construction (lazy) ──────────────────────────────────

function createCloudWatchClient(
  region: string | undefined,
  strategyName: string,
): CloudWatchLikeClient {
  let mod: CloudWatchSdkModule;
  try {
    mod = lazyRequire<CloudWatchSdkModule>('@aws-sdk/client-cloudwatch-logs');
  } catch {
    throw new Error(
      `[${strategyName}Observability] requires the \`@aws-sdk/client-cloudwatch-logs\` peer dependency.\n` +
        `  Install:  npm install @aws-sdk/client-cloudwatch-logs\n` +
        `  Or pass \`_client\` for test injection.`,
    );
  }
  if (!mod.CloudWatchLogsClient || !mod.PutLogEventsCommand) {
    throw new Error(
      `[${strategyName}Observability]: \`@aws-sdk/client-cloudwatch-logs\` is installed but ` +
        `\`CloudWatchLogsClient\` / \`PutLogEventsCommand\` was not found. Update the SDK.`,
    );
  }
  const sdkClient = new mod.CloudWatchLogsClient({ ...(region && { region }) }) as {
    send(cmd: unknown): Promise<unknown>;
  };

  const createLogStreamCommand = mod.CreateLogStreamCommand;

  return {
    async putLogEvents(input) {
      // Cast the SDK constructor to the call shape — same trick as
      // the memory adapter to stay forward-compat with SDK shape drift.
      const cmd = new (mod.PutLogEventsCommand as new (i: unknown) => unknown)(input);
      await sdkClient.send(cmd);
    },
    // Only offered when the installed SDK has the command. An older SDK
    // without it degrades to a reported failure rather than a crash — the
    // adapter checks for this method before reaching for it.
    ...(createLogStreamCommand && {
      async createLogStream(input: { logGroupName: string; logStreamName: string }) {
        const cmd = new (createLogStreamCommand as new (i: unknown) => unknown)(input);
        await sdkClient.send(cmd);
      },
    }),
  };
}
