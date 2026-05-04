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
 *     stream.tool_end           ↦  close tool subsegment
 *
 * The result in the X-Ray Trace Map: a hierarchical timeline of every
 * agent run — turn → iteration → llm-call/tool-call — queryable in
 * X-Ray Insights, joinable with the rest of your AWS distributed
 * trace via `AWSTraceHeader` propagation (consumer's responsibility
 * to wire upstream/downstream IDs).
 *
 * Subpath:  `agentfootprint/observability-providers`
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
 * import { xrayObservability } from 'agentfootprint/observability-providers';
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
  /** Test injection — bypasses SDK lazy-require entirely. */
  readonly _client?: XRayLikeClient;
}

// ─── SDK-shaped surface ──────────────────────────────────────────────

export interface XRayLikeClient {
  putTraceSegments(input: { TraceSegmentDocuments: ReadonlyArray<string> }): Promise<unknown>;
}

interface XRaySdkModule {
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
  // multiple in-flight turns; we key the active stack by `runId`
  // (every event payload carries it after enrichment).
  const activeTurns = new Map<
    string,
    {
      readonly traceId: string;
      readonly stack: XraySegment[]; // root at [0], deepest at [length-1]
      readonly closed: XraySegment[]; // segments awaiting flush
      readonly sampled: boolean;
    }
  >();

  // Outbound segment buffer (flat list of closed segments ready for
  // PutTraceSegments). Drained by flush() / size-trigger / time-trigger.
  const outbox: XraySegment[] = [];
  let lastFlushPromise: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let onErrorHook: ((err: Error, event?: AgentfootprintEvent) => void) | undefined;

  // Lazy SDK client.
  let client: XRayLikeClient | undefined = opts._client;
  function ensureClient(): XRayLikeClient {
    if (client) return client;
    client = createXRayClient(opts.region);
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
    if (outbox.length === 0 || stopped) return;
    const batch = outbox.splice(0, maxBatchSegments);
    try {
      await ensureClient().putTraceSegments({
        TraceSegmentDocuments: batch.map((s) => JSON.stringify(s)),
      });
    } catch (err) {
      onErrorHook?.(err instanceof Error ? err : new Error(String(err)));
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
    extra?: { error?: boolean; annotations?: XrayAnnotations; metadata?: Record<string, unknown> },
  ): void {
    const seg = popSegment(turnState, expectedName);
    if (!seg) return;
    if (extra?.error) seg.error = true;
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

  function handleEvent(event: AgentfootprintEvent): void {
    if (stopped) return;
    const runId = (event.payload as { runId?: string } | undefined)?.runId;
    if (!runId) return; // Events without a turn anchor — skip.

    switch (event.type) {
      case 'agentfootprint.agent.turn_start': {
        const sampled = sampleRate >= 1 || Math.random() < sampleRate;
        const turnState = {
          traceId: makeTraceId(),
          stack: [] as XraySegment[],
          closed: [] as XraySegment[],
          sampled,
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
        if (t?.sampled)
          pushSegment(t, `iteration:${(event.payload as { iteration?: number }).iteration ?? '?'}`);
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
        const toolName = (event.payload as { toolName?: string }).toolName ?? 'tool';
        const seg = pushSegment(t, `tool:${toolName}`);
        seg.annotations = { toolName };
        break;
      }

      case 'agentfootprint.stream.tool_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const toolName = (event.payload as { toolName?: string }).toolName;
        closeSegment(t, toolName ? `tool:${toolName}` : undefined, {
          error: (event.payload as { error?: unknown }).error !== undefined,
        });
        break;
      }

      // Other events become annotations on the topmost active segment
      // (cheaper than spawning a subsegment per event).
      default: {
        const t = activeTurns.get(runId);
        const top = t?.stack[t.stack.length - 1];
        if (!t?.sampled || !top) break;
        // Annotate cost ticks specially so they're queryable in
        // X-Ray Insights.
        if (event.type === 'agentfootprint.cost.tick') {
          const p = event.payload as { cumulativeCostUsd?: number };
          if (typeof p.cumulativeCostUsd === 'number') {
            top.annotations = { ...top.annotations, cumulativeCostUsd: p.cumulativeCostUsd };
          }
        }
        break;
      }
    }
  }

  return {
    name: 'xray',
    capabilities: { events: true, traces: true },
    exportEvent: handleEvent,
    async flush(): Promise<void> {
      // Force-close any in-flight turn segments so partial traces
      // make it into X-Ray on shutdown.
      for (const [, t] of activeTurns) {
        if (!t.sampled) continue;
        while (t.stack.length > 0) closeSegment(t, undefined);
      }
      while (outbox.length > 0) {
        const before = lastFlushPromise;
        await before;
        if (outbox.length > 0) {
          lastFlushPromise = doFlush();
        }
        if (lastFlushPromise === before && outbox.length === 0) break;
      }
    },
    stop(): void {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    _onError(err: Error, event?: AgentfootprintEvent): void {
      onErrorHook =
        onErrorHook ??
        ((e) => {
          // eslint-disable-next-line no-console
          console.error(`[xrayObservability] flush failed:`, e.message);
        });
      onErrorHook(err, event);
    },
  };
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

function createXRayClient(region: string | undefined): XRayLikeClient {
  let mod: XRaySdkModule;
  try {
    mod = lazyRequire<XRaySdkModule>('@aws-sdk/client-xray');
  } catch {
    throw new Error(
      'xrayObservability requires the `@aws-sdk/client-xray` peer dependency.\n' +
        '  Install:  npm install @aws-sdk/client-xray\n' +
        '  Or pass `_client` for test injection.',
    );
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
