/**
 * xrayObservability — AWS X-Ray distributed-tracing adapter.
 *
 * Maps agentfootprint's event taxonomy onto AWS X-Ray segment trees:
 *
 *     agent.turn_start          ↦  root segment (one trace per turn)
 *     agent.turn_end            ↦  close root segment + flush
 *     agent.iteration_start     ↦  push subsegment under root
 *     agent.iteration_end       ↦  close iteration subsegment
 *     stream.llm_start          ↦  push leaf subsegment (model call)
 *     stream.llm_end            ↦  close llm subsegment
 *     stream.tool_start         ↦  push leaf subsegment (tool call)
 *     stream.tool_end           ↦  close tool subsegment (correlated
 *                                  by toolCallId — parallel-safe)
 *     error.fatal               ↦  fault on root + close the whole
 *                                  tree (turn_end never arrives)
 *
 * Events are anchored on `meta.runId` (the dispatcher envelope),
 * with a `payload.runId` fallback for hand-built events.
 *
 * The result in the X-Ray Trace Map: a hierarchical timeline of every
 * agent run — turn → iteration → llm-call/tool-call — queryable in
 * X-Ray Insights, joinable with the rest of your AWS distributed
 * trace via `AWSTraceHeader` propagation (consumer's responsibility
 * to wire upstream/downstream IDs).
 *
 * Subpath:  `agentfootprint/observe`
 * Peer dep: `@aws-sdk/client-xray` (OPTIONAL — installed only when
 *           this adapter is used).
 *
 * Sampling:
 *   By default every turn produces one trace. Pass `sampleRate: 0.1`
 *   to sample 10% of turns — sampling decisions are made at
 *   `turn_start` and persist for the whole turn (so partial traces
 *   never reach X-Ray).
 *
 * @example
 * ```ts
 * import { xrayObservability } from 'agentfootprint/observe';
 * import { microtaskBatchDriver } from 'footprintjs/detach';
 *
 * agent.enable.observability({
 *   strategy: xrayObservability({
 *     region: 'us-east-1',
 *     serviceName: 'my-agent',
 *     sampleRate: 0.1,                    // 10% sampling
 *   }),
 *   detach: { driver: microtaskBatchDriver, mode: 'forget' },
 * });
 * ```
 *
 * @example Test injection
 * ```ts
 * xrayObservability({
 *   serviceName: 'test',
 *   _client: {
 *     putTraceSegments: async (input) => { capturedDocs.push(input); },
 *   },
 * });
 * ```
 */

import type { AgentfootprintEvent } from '../../events/registry.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import type { ObservabilityStrategy } from '../../strategies/types.js';

import { rateLimitedConsoleSink } from './deliveryErrors.js';

// ─── Public options ──────────────────────────────────────────────────

export interface XrayObservabilityOptions {
  /** AWS region. Falls back to AWS_REGION / AWS_DEFAULT_REGION env. */
  readonly region?: string;
  /** Service name on every emitted segment. Surfaces in X-Ray's
   *  service map. Required. */
  readonly serviceName: string;
  /** 0..1 — fraction of turns to sample. Default `1.0` (every turn).
   *  Decisions are made at `turn_start` and persist for the whole
   *  turn so partial traces never reach X-Ray. */
  readonly sampleRate?: number;
  /** Max segments buffered before forced flush. X-Ray's
   *  `PutTraceSegments` API accepts up to 50 segments per call;
   *  default 25 keeps latency tight. */
  readonly maxBatchSegments?: number;
  /** Forced flush window for low-traffic agents. Default 1000ms.
   *  `0` disables time-based flush. */
  readonly flushIntervalMs?: number;
  /**
   * Where delivery failures go (8.11.0).
   *
   * `PutTraceSegments` is network I/O and it fails — an IAM denial, a
   * throttle, a malformed segment. Without this, failures reach the default
   * sink (a rate-limited `console.error`), because telemetry that fails
   * invisibly is indistinguishable from telemetry that works. Set this to
   * route them into your own logger instead; you receive every failure. The
   * batch that failed is dropped, never requeued.
   *
   * Equivalent to assigning the strategy's `_onError` property after
   * construction, but visible at the call site.
   */
  readonly onError?: (error: Error, event?: AgentfootprintEvent) => void;
  /** Test injection — bypasses SDK lazy-require entirely. */
  readonly _client?: XRayLikeClient;
  /** @internal Test injection (9.4.0) — the AWS SDK module, so the real shim
   *  (`send(new Command(...))`) runs against a fake SDK and the command name it
   *  dispatches can be asserted. Ignored when `_client` is set. */
  readonly _sdk?: XRaySdkModule;
}

// ─── SDK-shaped surface ──────────────────────────────────────────────

export interface XRayLikeClient {
  putTraceSegments(input: { TraceSegmentDocuments: ReadonlyArray<string> }): Promise<unknown>;
}

/**
 * The slice of `@aws-sdk/client-xray` this shim touches.
 *
 * Exported since 9.4.0 so `opts._sdk` can name it — which is what lets the
 * shared command-name pin (test/adapters/aws/) assert that this adapter
 * dispatches `PutTraceSegments` and nothing invented, without an AWS account
 * or the peer dep installed.
 */
export interface XRaySdkModule {
  readonly XRayClient?: new (config: { region?: string }) => unknown;
  readonly PutTraceSegmentsCommand?: new (input: unknown) => unknown;
}

// ─── Segment data shape ──────────────────────────────────────────────

interface XrayAnnotations {
  [key: string]: string | number | boolean;
}

interface XraySegment {
  readonly name: string;
  readonly id: string;
  readonly trace_id: string;
  readonly parent_id?: string;
  start_time: number; // unix seconds with fractional precision
  end_time?: number;
  in_progress?: boolean;
  annotations?: XrayAnnotations;
  metadata?: { default?: Record<string, unknown> };
  error?: boolean;
  fault?: boolean;
}

// ─── Strategy factory ────────────────────────────────────────────────

export function xrayObservability(opts: XrayObservabilityOptions): ObservabilityStrategy {
  if (!opts.serviceName) {
    throw new TypeError(
      `[xrayObservability] \`serviceName\` is required. ` +
        `Pass an identifier visible in your X-Ray service map, e.g. 'my-agent-prod'.`,
    );
  }

  const sampleRate = opts.sampleRate ?? 1;
  const maxBatchSegments = opts.maxBatchSegments ?? 25;
  const flushIntervalMs = opts.flushIntervalMs ?? 1000;

  // Per-turn state. agentfootprint events arrive interleaved across
  // multiple in-flight turns; we key the active stack by the run
  // anchor (`meta.runId` — see anchorRunId).
  const activeTurns = new Map<
    string,
    {
      readonly traceId: string;
      readonly stack: XraySegment[]; // root at [0], deepest at [length-1]
      readonly closed: XraySegment[]; // segments awaiting flush
      readonly sampled: boolean;
      /** toolCallId → live tool segment. tool_end carries ONLY
       *  toolCallId at runtime (`ToolEndPayload`), and parallel tool
       *  calls interleave — LIFO popping would close the wrong one. */
      readonly toolSegments: Map<string, XraySegment>;
    }
  >();

  // Outbound segment buffer (flat list of closed segments ready for
  // PutTraceSegments). Drained by flush() / size-trigger / time-trigger.
  const outbox: XraySegment[] = [];
  let lastFlushPromise: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  // The fallback when the consumer wires nothing. Rate-limited; a
  // consumer-supplied sink is not.
  const consoleSink = rateLimitedConsoleSink('xray');

  // Lazy SDK client.
  let client: XRayLikeClient | undefined = opts._client;
  function ensureClient(): XRayLikeClient {
    if (client) return client;
    client = createXRayClient(opts.region, opts._sdk);
    return client;
  }

  function scheduleTimedFlush(): void {
    if (timer || flushIntervalMs <= 0 || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void doFlush();
    }, flushIntervalMs);
  }

  async function doFlush(): Promise<void> {
    // `stopped` is deliberately NOT a guard here (8.11.1). `stop()` stops this
    // strategy ACCEPTING events and cancels its timer; segments already closed
    // and queued are still owed to X-Ray. Guarding here made `flush()` after
    // `stop()` loop forever waiting for a drain that could no longer happen —
    // an infinite microtask spin that starved the event loop of the process
    // trying to shut down.
    if (outbox.length === 0) return;
    const batch = outbox.splice(0, maxBatchSegments);
    try {
      await ensureClient().putTraceSegments({
        TraceSegmentDocuments: batch.map((s) => JSON.stringify(s)),
      });
    } catch (err) {
      // Routed through the strategy's CURRENT `_onError` (not a hook captured
      // at construction), so a consumer who assigns it — or passes `onError`
      // — actually receives delivery failures. Before 8.11.0 the hook was
      // installed lazily inside `_onError` itself and was `undefined` here,
      // so every failed put was silent.
      strategy._onError?.(
        new Error(
          `${batch.length} segment(s) dropped shipping to X-Ray: ` +
            (err instanceof Error ? err.message : String(err)),
        ),
      );
    }
    // If outbox grew during the put (size > maxBatchSegments emits
    // arrived), chain another flush.
    if (outbox.length > 0 && !stopped) {
      lastFlushPromise = lastFlushPromise.then(doFlush, doFlush);
    }
  }

  function pushSegment(
    turnState: NonNullable<ReturnType<typeof activeTurns.get>>,
    name: string,
  ): XraySegment {
    const parent = turnState.stack[turnState.stack.length - 1];
    const seg: XraySegment = {
      name,
      id: hexId(16),
      trace_id: turnState.traceId,
      ...(parent && { parent_id: parent.id }),
      start_time: nowSeconds(),
      in_progress: true,
    };
    turnState.stack.push(seg);
    return seg;
  }

  function popSegment(
    turnState: NonNullable<ReturnType<typeof activeTurns.get>>,
    expectedName?: string,
  ): XraySegment | undefined {
    // Defensive: pop the topmost segment whose name matches (if
    // provided). Out-of-order events would otherwise leave dangling
    // segments. If no match, pop the topmost.
    let idx = turnState.stack.length - 1;
    if (expectedName) {
      // idx >= 0 guard above guarantees stack[idx] exists.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      while (idx >= 0 && turnState.stack[idx]!.name !== expectedName) idx--;
    }
    if (idx < 0) return undefined;
    // splice(idx, 1) returns a 1-element array; idx < 0 guarded above.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const seg = turnState.stack.splice(idx, 1)[0]!;
    seg.end_time = nowSeconds();
    delete seg.in_progress;
    return seg;
  }

  function closeSegment(
    turnState: NonNullable<ReturnType<typeof activeTurns.get>>,
    expectedName: string | undefined,
    extra?: {
      error?: boolean;
      fault?: boolean;
      annotations?: XrayAnnotations;
      metadata?: Record<string, unknown>;
    },
  ): void {
    const seg = popSegment(turnState, expectedName);
    if (!seg) return;
    finishSegment(turnState, seg, extra);
  }

  /** Seal an already-popped segment and graduate the turn to the
   *  outbox once its stack is empty. */
  function finishSegment(
    turnState: NonNullable<ReturnType<typeof activeTurns.get>>,
    seg: XraySegment,
    extra?: {
      error?: boolean;
      fault?: boolean;
      annotations?: XrayAnnotations;
      metadata?: Record<string, unknown>;
    },
  ): void {
    // Idempotent seal — popSegment stamps end_time; segments removed
    // from the stack by identity (toolCallId correlation) arrive raw.
    if (seg.end_time === undefined) {
      seg.end_time = nowSeconds();
      delete seg.in_progress;
    }
    if (extra?.error) seg.error = true;
    if (extra?.fault) seg.fault = true;
    if (extra?.annotations) seg.annotations = { ...seg.annotations, ...extra.annotations };
    if (extra?.metadata)
      seg.metadata = { default: { ...(seg.metadata?.default ?? {}), ...extra.metadata } };
    if (turnState.sampled) {
      turnState.closed.push(seg);
      // Once the root closes, the whole turn graduates to outbox.
      if (turnState.stack.length === 0) {
        outbox.push(...turnState.closed);
        if (outbox.length >= maxBatchSegments) {
          lastFlushPromise = lastFlushPromise.then(doFlush, doFlush);
        } else {
          scheduleTimedFlush();
        }
      }
    }
  }

  // ─── Event-to-segment dispatch ─────────────────────────────────────

  /**
   * Resolve the run anchor for an event.
   *
   * Real runtime events are dispatcher envelopes — the run id lives on
   * `event.meta.runId` (built by `bridge/eventMeta.ts`). The legacy
   * `payload.runId` read is kept as a fallback for consumers feeding
   * hand-built events (the pre-fix shape this adapter's own tests
   * used). Without the meta read, NO segment ever opened on a real
   * agent run — the bug the fabricated test shapes masked.
   */
  function anchorRunId(event: AgentfootprintEvent): string | undefined {
    const meta = (event as { meta?: { runId?: string } }).meta;
    return meta?.runId ?? (event.payload as { runId?: string } | undefined)?.runId;
  }

  function handleEvent(event: AgentfootprintEvent): void {
    if (stopped) return;
    const runId = anchorRunId(event);
    if (!runId) return; // Events without a turn anchor — skip.

    switch (event.type) {
      case 'agentfootprint.agent.turn_start': {
        const sampled = sampleRate >= 1 || Math.random() < sampleRate;
        const turnState = {
          traceId: makeTraceId(),
          stack: [] as XraySegment[],
          closed: [] as XraySegment[],
          sampled,
          toolSegments: new Map<string, XraySegment>(),
        };
        activeTurns.set(runId, turnState);
        if (sampled) pushSegment(turnState, opts.serviceName);
        break;
      }

      case 'agentfootprint.agent.turn_end': {
        const t = activeTurns.get(runId);
        if (!t) break;
        // Close everything still on the stack — defensive against
        // missing `_end` events (e.g., pause/resume mid-turn).
        while (t.stack.length > 0) closeSegment(t, undefined);
        activeTurns.delete(runId);
        break;
      }

      case 'agentfootprint.agent.iteration_start': {
        const t = activeTurns.get(runId);
        if (t?.sampled) {
          // Runtime shape: `iterIndex` (AgentIterationStartPayload).
          // Legacy fallback `iteration` keeps hand-fed events working.
          const iteration =
            (event.payload as { iterIndex?: number; iteration?: number }).iterIndex ??
            (event.payload as { iteration?: number }).iteration;
          pushSegment(t, `iteration:${iteration ?? '?'}`);
        }
        break;
      }

      case 'agentfootprint.agent.iteration_end': {
        const t = activeTurns.get(runId);
        if (t?.sampled) closeSegment(t, undefined);
        break;
      }

      case 'agentfootprint.stream.llm_start': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const seg = pushSegment(t, 'llm');
        const model = (event.payload as { model?: string }).model;
        if (model) seg.annotations = { model };
        break;
      }

      case 'agentfootprint.stream.llm_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        closeSegment(t, 'llm', {
          metadata: { event: event.payload as unknown as Record<string, unknown> },
        });
        break;
      }

      case 'agentfootprint.stream.tool_start': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const p = event.payload as { toolName?: string; toolCallId?: string };
        const toolName = p.toolName ?? 'tool';
        const seg = pushSegment(t, `tool:${toolName}`);
        seg.annotations = { toolName };
        if (p.toolCallId !== undefined) t.toolSegments.set(p.toolCallId, seg);
        break;
      }

      case 'agentfootprint.stream.tool_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const p = event.payload as { toolCallId?: string; toolName?: string; error?: unknown };
        const errored = p.error !== undefined && p.error !== false;
        // Correlate by toolCallId — the only identity ToolEndPayload
        // carries at runtime (it has NO toolName), and parallel tool
        // calls end out of LIFO order. Fallback chain keeps legacy
        // hand-fed events (toolName) working.
        const byId = p.toolCallId === undefined ? undefined : t.toolSegments.get(p.toolCallId);
        if (byId !== undefined && p.toolCallId !== undefined) {
          t.toolSegments.delete(p.toolCallId);
          // Remove from the stack by identity so the LIFO unwind stays clean.
          const idx = t.stack.indexOf(byId);
          if (idx >= 0) t.stack.splice(idx, 1);
          finishSegment(t, byId, { error: errored });
        } else {
          closeSegment(t, p.toolName !== undefined ? `tool:${p.toolName}` : undefined, {
            error: errored,
          });
        }
        break;
      }

      // A fatal run error: the turn will never see turn_end, so close
      // the segment tree here (fault on the root — X-Ray's marker for
      // unhandled exceptions) instead of leaking it in activeTurns,
      // where the closed segments would never graduate to the outbox.
      case 'agentfootprint.error.fatal': {
        const t = activeTurns.get(runId);
        if (!t) break;
        while (t.stack.length > 1) closeSegment(t, undefined);
        const p = event.payload as { stage?: string; scope?: string };
        // Stage + scope only — error MESSAGES can echo PII.
        const annotations: XrayAnnotations = {
          ...(p.stage !== undefined && { errorStage: p.stage }),
          ...(p.scope !== undefined && { errorScope: p.scope }),
        };
        closeSegment(t, undefined, {
          fault: true,
          ...(Object.keys(annotations).length > 0 && { annotations }),
        });
        activeTurns.delete(runId);
        break;
      }

      // Other events become annotations on the topmost active segment
      // (cheaper than spawning a subsegment per event).
      default: {
        const t = activeTurns.get(runId);
        const top = t?.stack[t.stack.length - 1];
        if (!t?.sampled || !top) break;
        // Annotate cost ticks specially so they're queryable in
        // X-Ray Insights. Runtime shape: `cumulative.estimatedUsd`
        // (CostTickPayload); legacy fallback `cumulativeCostUsd`
        // keeps hand-fed events working.
        if (event.type === 'agentfootprint.cost.tick') {
          const p = event.payload as {
            cumulative?: { estimatedUsd?: number };
            cumulativeCostUsd?: number;
          };
          const usd = p.cumulative?.estimatedUsd ?? p.cumulativeCostUsd;
          if (typeof usd === 'number') {
            top.annotations = { ...top.annotations, cumulativeCostUsd: usd };
          }
        }
        break;
      }
    }
  }

  const strategy: ObservabilityStrategy = {
    name: 'xray',
    capabilities: { events: true, traces: true },
    exportEvent: handleEvent,
    /**
     * Force-close in-flight segments and drain, so a turn cut short by a
     * shutdown still reaches X-Ray as a partial trace.
     *
     * Called for you on shutdown since 8.12.0 — by the handle
     * `enable.observability()` returns, by `agent.shutdown()`, and by a
     * `standingAgent` closing:
     *
     *   process.on('SIGTERM', async () => { await agent.shutdown(); });
     *
     * Calling it yourself is still fine. Safe in any order relative to
     * `stop()` since 8.11.1: a flush after a stop still ships the segments
     * already closed.
     */
    async flush(): Promise<void> {
      // Force-close any in-flight turn segments so partial traces
      // make it into X-Ray on shutdown.
      for (const [, t] of activeTurns) {
        if (!t.sampled) continue;
        while (t.stack.length > 0) closeSegment(t, undefined);
      }
      // BOUNDED BY CONSTRUCTION — every pass must shrink the outbox (a put
      // takes up to `maxBatchSegments` at a time, so several passes are
      // normal); a pass that shrinks nothing ends the drain instead of trying
      // again. The previous `while (outbox.length > 0)` trusted `doFlush()` to
      // make progress, which it stopped doing after `stop()` — an infinite
      // microtask spin that starved the event loop during shutdown.
      for (;;) {
        const pending = outbox.length;
        // Chain, never replace: segments ship in the order they closed.
        lastFlushPromise = lastFlushPromise.then(doFlush, doFlush);
        await lastFlushPromise;
        if (outbox.length === 0) return;
        if (outbox.length >= pending) return;
      }
    },
    /** Stop the flush timer and stop accepting events. **The framework does
     *  not call this for you** — an un-stopped strategy keeps a `setTimeout`
     *  alive.
     *
     *  Terminal: events exported after this are ignored. What it does NOT do
     *  is discard the outbox — `flush()` after `stop()` still ships it
     *  (8.11.1). */
    stop(): void {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    /**
     * Where errors go. Two callers: the dispatch layer (when `exportEvent`
     * throws) and this adapter's own delivery path. Overriding it works —
     * assign `_onError`, or pass `onError` in the factory options — because
     * delivery failures read this method at call time rather than a hook
     * captured at construction.
     */
    _onError(err: Error, event?: AgentfootprintEvent): void {
      (opts.onError ?? consoleSink)(err, event);
    },
  };

  return strategy;
}

// ─── ID + time helpers ───────────────────────────────────────────────

/**
 * Generate an X-Ray trace ID. Format:
 *   `1-{8-hex-of-unix-timestamp}-{24-hex-random}`
 * (Note X-Ray's docs say "12 hex" for the random part; the actual
 * spec is 24 hex / 96-bit. AWS examples use 24.)
 */
function makeTraceId(): string {
  const seconds = Math.floor(Date.now() / 1000);
  return `1-${seconds.toString(16).padStart(8, '0')}-${hexId(24)}`;
}

/** Generate a hex string of `len` chars, cryptographically-strong
 *  where available, falling back to Math.random for environments
 *  without `crypto.getRandomValues` (older runtimes). */
function hexId(len: number): string {
  const bytes = Math.ceil(len / 2);
  // Try the Web Crypto / Node Crypto API first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cryptoApi = (globalThis as any).crypto as
    | { getRandomValues?: (a: Uint8Array) => Uint8Array }
    | undefined;
  if (cryptoApi?.getRandomValues) {
    const buf = new Uint8Array(bytes);
    cryptoApi.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, len);
  }
  // Fallback (deterministic-quality, NOT for security-critical IDs —
  // X-Ray IDs aren't security boundaries, just trace correlation).
  let s = '';
  while (s.length < len) s += Math.random().toString(16).slice(2);
  return s.slice(0, len);
}

/** X-Ray timestamps are unix seconds with fractional precision. */
function nowSeconds(): number {
  return Date.now() / 1000;
}

// ─── SDK construction (lazy) ─────────────────────────────────────────

function createXRayClient(region: string | undefined, injected?: XRaySdkModule): XRayLikeClient {
  let mod: XRaySdkModule;
  if (injected) {
    mod = injected;
  } else {
    try {
      mod = lazyRequire<XRaySdkModule>('@aws-sdk/client-xray');
    } catch {
      throw new Error(
        'xrayObservability requires the `@aws-sdk/client-xray` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-xray\n' +
          '  Or pass `_client` for test injection.',
      );
    }
  }
  if (!mod.XRayClient || !mod.PutTraceSegmentsCommand) {
    throw new Error(
      'xrayObservability: `@aws-sdk/client-xray` is installed but `XRayClient` / ' +
        '`PutTraceSegmentsCommand` was not found. Update the SDK.',
    );
  }
  const sdkClient = new mod.XRayClient({ ...(region && { region }) }) as {
    send(cmd: unknown): Promise<unknown>;
  };
  return {
    async putTraceSegments(input) {
      const cmd = new (mod.PutTraceSegmentsCommand as new (i: unknown) => unknown)(input);
      await sdkClient.send(cmd);
    },
  };
}
