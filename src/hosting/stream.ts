/**
 * stream — agent events → Server-Sent Events helpers.
 *
 * Pattern: Adapter (event stream → SSE wire format).
 * Role:    Outer ring. Subscribes to a `Runner`'s `EventDispatcher`
 *          and yields SSE-formatted strings. Drop into any HTTP
 *          framework that accepts an async iterable response body
 *          (Fetch Response, Express res.write, Hono streaming, etc.).
 * Emits:   N/A — observes only.
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/observe`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */

import type { AgentfootprintEvent } from '../events/registry.js';
import type { RunnerBase } from '../core/RunnerBase.js';
import type { EventDispatcher, Unsubscribe } from '../events/dispatcher.js';
import { runnerLive } from '../core/runnerLive.js';
import { toWireJson } from '../lib/wireJson.js';

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
   * for a token-only feed. It sees each event as the run's RECORD serves it —
   * under an agent's `redact`, the placeholder wherever the policy selected a
   * value — in both formats.
   */
  readonly filter?: (event: AgentfootprintEvent) => boolean;
  /**
   * Output shape:
   *   - 'full' (default) — each event is JSON-serialized verbatim: the run's
   *     RECORD, so under an agent's `redact` policy it is the served event
   *     (the placeholder wherever the policy selected a value).
   *   - 'text' — only `agentfootprint.stream.token.content` is yielded,
   *     in plain text form (no event/data prefix). Useful for piping
   *     directly into a chat UI. This is the REPLY to the person who asked —
   *     the caller's own answer, like `run()`'s return — so a redaction
   *     policy never masks it.
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
  /**
   * How each event is written as a frame in the 'full' format — the framing
   * STRATEGY ({@link SseFraming}). Default: {@link agentfootprintSse}, the
   * frames `toSSE` has always written (`event: <type>` + `data: <json>`).
   *
   * Refused together with `eventName` (which names the event line of the
   * default framing only) and with `format: 'text'` (which writes no frames).
   */
  readonly framing?: SseFraming<AgentfootprintEvent>;
}

/**
 * How ONE event becomes ONE Server-Sent Events frame — the framing strategy.
 *
 * A framing decides the bytes of a frame and nothing else: which events go out,
 * in what order, and when the stream ends belong to whoever drives it. Two
 * strategies ship: {@link agentfootprintSse} frames agentfootprint's own events
 * (what `toSSE` writes), and `agUiSse()` from `agentfootprint/ag-ui` frames AG-UI
 * events the way the official `@ag-ui/encoder` does (a `data:` line only).
 *
 * @example Frame each event under its short name (`stream.token`, not `agentfootprint.stream.token`)
 * ```ts
 * const shortNames: SseFraming<AgentfootprintEvent> = {
 *   contentType: 'text/event-stream',
 *   frame: (event) => encodeSSE(event.type.replace(/^agentfootprint\./, ''), event),
 * };
 * for await (const frame of toSSE(agent, { framing: shortNames })) res.write(frame);
 * ```
 */
export interface SseFraming<E> {
  /** The media type a response framed this way declares. */
  readonly contentType: string;
  /**
   * The whole frame for one event, its terminating blank line included.
   *
   * `at` is where the frame stands in ITS stream ({@link SseFramePosition}),
   * counted by whoever drives the stream: a framing that numbers its frames
   * (a gateway's `eventSequence`) reads the number here and keeps no counter
   * of its own, so one framing serving many streams at once never numbers one
   * stream's frames with another's.
   */
  frame(event: E, at: SseFramePosition): string;
}

/**
 * Where one frame stands in its stream — handed to {@link SseFraming.frame} by
 * whoever drives the stream (`toSSE`, `streamHandler`), never kept by a framing.
 */
export interface SseFramePosition {
  /**
   * The frame's number in this stream: 1 for the first, one more for each frame
   * written after it. Counted per stream — one response, one run — and never
   * shared: a resumed run is a new stream and counts from 1 again. Keep-alive
   * comments are not frames and are not counted.
   */
  readonly sequence: number;
}

/**
 * agentfootprint's own framing — `event: <type>` then `data: <json>` — the
 * frames `toSSE` writes by default, byte for byte as before the framing seam
 * existed. Every payload goes through the wire rule (`lib/wireJson.ts`).
 */
export const agentfootprintSse: SseFraming<AgentfootprintEvent> = {
  contentType: 'text/event-stream',
  frame: (event) => encodeSSE(event.type, event),
};

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
  const heartbeatMs = options.heartbeatMs ?? 0;
  const framing = framingOf(options);

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

  // Every event — and so every event the consumer's `filter` sees — is the
  // RECORD: served under the run's redaction policy like every other
  // listener's. 'text' then streams the REPLY to the person who asked, the
  // caller's own answer, which a policy never masks: each token's text is
  // taken from the run's real-value path (`core/runnerLive.ts` ·
  // `runnerLive`) — matched to its served event by the token's address (its
  // stage, iteration and index, none of which a policy selects), so a served
  // token that never arrives cannot shift the ones after it — and never
  // handed to consumer code. A runner that is not a RunnerBase has no
  // redaction and no live taps: its events are the record and the reply at once.
  const live = format === 'text' ? runnerLive(runner) : undefined;
  const replies = new Map<string, string[]>();
  const offReplies = live?.onRealEvent((event) => {
    if (event.type !== 'agentfootprint.stream.token') return;
    const content = (event as { payload?: { content?: unknown } }).payload?.content;
    const key = tokenAddress(event);
    const waiting = replies.get(key);
    const text = typeof content === 'string' ? content : '';
    if (waiting === undefined) replies.set(key, [text]);
    else waiting.push(text);
  });
  const replyFor = (event: AgentfootprintEvent): string | undefined => {
    const key = tokenAddress(event);
    const waiting = replies.get(key);
    const text = waiting?.shift();
    if (waiting !== undefined && waiting.length === 0) replies.delete(key);
    return text;
  };
  const listener = (event: AgentfootprintEvent): void => {
    // Taken before the filter, so a filtered-out token still consumes its text.
    const reply =
      live !== undefined && event.type === 'agentfootprint.stream.token'
        ? replyFor(event)
        : undefined;
    if (filter && !filter(event)) return;
    queue.push(
      reply !== undefined
        ? ({ type: event.type, payload: { content: reply } } as unknown as AgentfootprintEvent)
        : event,
    );
    wakeup();
    // `agent.turn_end` (or composition exit on the outermost runner)
    // ends the stream naturally; the consumer's `for await` finishes
    // when the iterator returns.
    if (
      event.type === 'agentfootprint.agent.turn_end' ||
      event.type === 'agentfootprint.error.fatal'
    ) {
      done = true;
      wakeup();
    }
  };
  const offRecord: Unsubscribe = dispatcher.on('*', listener);
  const unsub = (): void => {
    offRecord();
    offReplies?.();
  };

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      queue.push({ type: '__heartbeat' } as never);
      wakeup();
    }, heartbeatMs);
  }

  /** Frames written to THIS stream so far — the {@link SseFramePosition} of the next one. */
  let written = 0;
  try {
    while (!done || queue.length > 0) {
      while (queue.length > 0) {
        // queue.length > 0 guards the shift; result is defined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
          const frame = framing.frame(event, { sequence: written + 1 });
          written += 1;
          yield frame;
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
  // The wire rule (`lib/wireJson.ts`): an Error in a payload streams as its
  // name, message, code and cause — never its custom properties or stack.
  const json = toWireJson(payload);
  // Escape newlines inside JSON (rare with stringify) so the data field
  // stays single-line. SSE's data: lines can be repeated, but the
  // canonical encoder keeps it simple.
  return `event: ${eventName}\ndata: ${json}\n\n`;
}

/**
 * The framing `toSSE` writes with: the one the caller passed, else the default
 * — {@link agentfootprintSse}, or, when only `eventName` was given, the same
 * frames under the caller's names. A `framing` beside `eventName` or beside
 * `format: 'text'` is refused by name: each would silently ignore the other.
 */
function framingOf(options: ToSSEOptions): SseFraming<AgentfootprintEvent> {
  const { framing, eventName } = options;
  if (framing === undefined) {
    if (eventName === undefined) return agentfootprintSse;
    return { contentType: agentfootprintSse.contentType, frame: (e) => encodeSSE(eventName(e), e) };
  }
  if (eventName !== undefined) {
    throw new TypeError(
      'toSSE: `framing` and `eventName` were both given. `eventName` names the event line of ' +
        'the default framing; a framing of your own writes its own names — pass one or the other.',
    );
  }
  if (options.format === 'text') {
    throw new TypeError(
      "toSSE: `framing` was given with `format: 'text'`, which writes the reply's text and no " +
        'frames. Drop `framing`, or use the default `format`.',
    );
  }
  return framing;
}

/**
 * A token event's address — the stage that emitted it, its iteration and its
 * index: the same on the real-value path and on its served twin, and never a
 * name a redaction policy selects. `toSSE`'s 'text' pairing key.
 */
function tokenAddress(event: AgentfootprintEvent): string {
  const payload = event.payload as { iteration?: unknown; tokenIndex?: unknown } | undefined;
  return [
    event.meta?.runtimeStageId ?? '',
    String(payload?.iteration ?? ''),
    String(payload?.tokenIndex ?? ''),
  ].join('\u001f');
}
