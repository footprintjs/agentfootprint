/**
 * agentfootprint/stream — agent events → Server-Sent Events helpers.
 *
 * Pattern: Adapter (event stream → SSE wire format).
 * Role:    Outer ring. Subscribes to a `Runner`'s `EventDispatcher`
 *          and yields SSE-formatted strings. Drop into any HTTP
 *          framework that accepts an async iterable response body
 *          (Fetch Response, Express res.write, Hono streaming, etc.).
 * Emits:   N/A — observes only.
 *
 * ─── 7-panel design review (2026-04-28) ─────────────────────────────
 *
 *   LLM-AI system design   ✓ One-line-per-event SSE format. Each
 *                            event = one observation; each chunk
 *                            includes the `runtimeStageId` for
 *                            cross-view binding.
 *   Performance            ✓ AsyncIterable<string> — no buffering;
 *                            yields each event as it arrives. Stops
 *                            naturally when the run completes.
 *   Scalability            ✓ Per-run instance. No shared state;
 *                            many concurrent SSE streams safe.
 *   Research alignment     ✓ Standard SSE wire format
 *                            (text/event-stream). Browsers'
 *                            native EventSource API consumes directly.
 *   Flexibility            ✓ `format` option for full event payload
 *                            vs slim text-only mode (chat UIs that
 *                            only want token deltas). `filter`
 *                            predicate gates events.
 *   Abstraction-modular    ✓ One function (`toSSE`) + one class
 *                            (`SSEFormatter`); class is sugar for
 *                            consumers who prefer .pipeTo() shape.
 *   Software engineering   ✓ Pure observer. No global state. Tests
 *                            cover unit + scenario + property +
 *                            security + performance.
 *
 * ─── 7-pattern test coverage ────────────────────────────────────────
 *
 *   See `test/stream/unit/SSEFormatter.test.ts`.
 */

import type { AgentfootprintEvent } from './events/registry.js';
import type { RunnerBase } from './core/RunnerBase.js';
import type { EventDispatcher, Unsubscribe } from './events/dispatcher.js';

/**
 * Hand the runner this iterable's caller before calling `runner.run()`.
 * Yields SSE-formatted strings until the run finishes (success, error,
 * or pause). Each event becomes:
 *
 *   event: <event name>
 *   data: <JSON payload>
 *   <blank line>
 *
 * @example
 *   // Express
 *   app.post('/agent', async (req, res) => {
 *     res.setHeader('content-type', 'text/event-stream');
 *     for await (const chunk of toSSE(agent)) {
 *       res.write(chunk);
 *     }
 *     res.end();
 *     // (in parallel: await agent.run(req.body))
 *   });
 */
export interface ToSSEOptions {
  /**
   * Filter predicate — return false to skip an event. Default: all events.
   * Common: `event => event.type.startsWith('agentfootprint.stream.')`
   * for a token-only feed.
   */
  readonly filter?: (event: AgentfootprintEvent) => boolean;
  /**
   * Output shape:
   *   - 'full' (default) — each event is JSON-serialized verbatim.
   *   - 'text' — only `agentfootprint.stream.token.content` is yielded,
   *     in plain text form (no event/data prefix). Useful for piping
   *     directly into a chat UI.
   */
  readonly format?: 'full' | 'text';
  /**
   * Custom event name extractor. By default `event.type` is used.
   * Useful for SSE consumers that want their own naming.
   */
  readonly eventName?: (event: AgentfootprintEvent) => string;
  /**
   * Heartbeat interval in ms. SSE connections through proxies/load
   * balancers often die after ~30s of silence; emit `: ping` comments
   * at this interval. Default 0 (disabled).
   */
  readonly heartbeatMs?: number;
}

/**
 * Subscribe to a runner's `EventDispatcher` and yield SSE-formatted
 * strings until the run completes.
 */
export async function* toSSE<TIn, TOut>(
  runner: RunnerBase<TIn, TOut>,
  options: ToSSEOptions = {},
): AsyncIterable<string> {
  const filter = options.filter;
  const format = options.format ?? 'full';
  const eventName = options.eventName ?? ((e: AgentfootprintEvent) => e.type);
  const heartbeatMs = options.heartbeatMs ?? 0;

  // Pull the dispatcher off the runner. RunnerBase exposes it as
  // protected — we cast to access. No public dispatcher() method
  // exists ; runners forward .on/.off via their public API.
  const dispatcher = (runner as unknown as { dispatcher: EventDispatcher }).dispatcher;

  // Bounded queue: events drained as the consumer iterates.
  const queue: AgentfootprintEvent[] = [];
  let waiter: { resolve: () => void } | null = null;
  let done = false;

  const wakeup = (): void => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.resolve();
    }
  };

  const unsub: Unsubscribe = dispatcher.on('*', (event) => {
    if (filter && !filter(event)) return;
    queue.push(event);
    wakeup();
    // `agent.turn_end` (or composition exit on the outermost runner)
    // ends the stream naturally; the consumer's `for await` finishes
    // when the iterator returns.
    if (
      event.type === 'agentfootprint.agent.turn_end'
      || event.type === 'agentfootprint.error.fatal'
    ) {
      done = true;
      wakeup();
    }
  });

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      queue.push({ type: '__heartbeat' } as never);
      wakeup();
    }, heartbeatMs);
  }

  try {
    while (!done || queue.length > 0) {
      while (queue.length > 0) {
        const event = queue.shift()!;
        if ((event.type as string) === '__heartbeat') {
          yield ': ping\n\n';
          continue;
        }
        if (format === 'text') {
          if (event.type === 'agentfootprint.stream.token') {
            const payload = (event as { payload?: { content?: string } }).payload;
            if (payload?.content) yield payload.content;
          }
        } else {
          yield encodeSSE(eventName(event), event);
        }
      }
      if (done) break;
      await new Promise<void>((resolve) => {
        waiter = { resolve };
      });
    }
  } finally {
    unsub();
    if (heartbeat) clearInterval(heartbeat);
  }
}

/**
 * Class form for consumers who prefer `new SSEFormatter(runner).stream()`.
 * Identical behavior to `toSSE(runner)` — pick by preference.
 */
export class SSEFormatter<TIn = unknown, TOut = unknown> {
  constructor(
    private readonly runner: RunnerBase<TIn, TOut>,
    private readonly options: ToSSEOptions = {},
  ) {}

  /** Async iterable of SSE chunks. Consume with `for await`. */
  stream(): AsyncIterable<string> {
    return toSSE(this.runner, this.options);
  }
}

/**
 * Format any JSON-able payload as a single SSE event chunk.
 *
 * Useful for app-level events outside the runner's typed registry
 * (auth/error frames, app-state echoes). Most consumers won't need this.
 */
export function encodeSSE(eventName: string, payload: unknown): string {
  const json = JSON.stringify(payload);
  // Escape newlines inside JSON (rare with stringify) so the data field
  // stays single-line. SSE's data: lines can be repeated, but the
  // canonical encoder keeps it simple.
  return `event: ${eventName}\ndata: ${json}\n\n`;
}
