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
import type { Runner } from '../core/runner.js';
import type { Unsubscribe } from '../events/dispatcher.js';
import { runnerLive } from '../core/runnerLive.js';
import { toWireJson } from '../lib/wireJson.js';
import { unstreamedText } from './unstreamedText.js';

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
   *   - 'text' — the answer as plain text (no event/data prefix), for
   *     piping straight into a chat UI: each `agentfootprint.stream.token`'s
   *     content, then the rest of the root turn's `turn_end.finalContent`.
   *     An end marked `meta.rootTurn` qualifies even on resume. With older
   *     metadata the stream must have observed the root opening. With no
   *     event metadata the runner is treated as one root. A filter
   *     that drops only trailing tokens gets them back with the rest, such
   *     as the limits block or the standing line. When no tokens were
   *     written (the provider did not stream or the filter dropped them all),
   *     the whole answer is written. A gap that leaves the written text
   *     different from the answer's prefix, a rewritten prefix, or a
   *     refused answer produces no additional text. A newly opened text
   *     stream on a resumed Agent waits for the root turn to end or pause
   *     again. Other streams end at the first `agent.turn_end`, so use the
   *     returned outcome to read a composition's full reply. This is the
   *     caller's own answer, so a redaction policy never masks it.
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
  runner: Pick<Runner<TIn, TOut>, 'on'>,
  options: ToSSEOptions = {},
): AsyncIterable<string> {
  const filter = options.filter;
  const format = options.format ?? 'full';
  const heartbeatMs = options.heartbeatMs ?? 0;
  const framing = framingOf(options);

  // The public event port is sufficient; native private state stays encapsulated.

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
  // handed to consumer code. The answer and refusal status come from the
  // same `turn_end` event, paired by the stage that ended the turn. A runner
  // that is not a RunnerBase has no redaction and no live taps: its events
  // are the record and the reply at once.
  const live = format === 'text' ? runnerLive(runner) : undefined;
  const replies = new Map<string, string[]>();
  const answers = new Map<string, string | undefined>();
  const offReplies = live?.onRealEvent((event) => {
    if (event.type === 'agentfootprint.agent.turn_end') {
      answers.set(event.meta?.runtimeStageId ?? '', unrefusedAnswerOf(event));
      return;
    }
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
  /**
   * Use only the real, unrefused answer of a root turn. For an end without a
   * marker, an observed root start and no matching inner mount identify it.
   */
  const answerFor = (event: AgentfootprintEvent, rootEnd: boolean): string | undefined => {
    const key = event.meta?.runtimeStageId ?? '';
    const answer = live === undefined ? unrefusedAnswerOf(event) : answers.get(key);
    answers.delete(key);
    if (
      !rootEnd &&
      ((event.meta !== undefined && !rootTurnOpen) ||
        innerTurns.some((mount) => leads(mount, pathOf(event))))
    ) {
      return undefined;
    }
    rootTurnOpen = false;
    return answer;
  };
  let rootTurnOpen = false;
  let awaitingResumedRoot = false;
  const innerTurns: (readonly string[])[] = [];
  const listener = (event: AgentfootprintEvent): void => {
    // These boundaries establish scope even when the output filter drops them.
    if (format === 'text' && event.type === 'agentfootprint.agent.turn_start') {
      const path = pathOf(event);
      if (path.length === 0) rootTurnOpen = true;
      else innerTurns.push(path);
    }
    if (event.type === 'agentfootprint.pause.resume' && live?.turn !== undefined && !rootTurnOpen) {
      // Only an Agent has an owning turn that can end after its children.
      awaitingResumedRoot = true;
    }
    const turnEnd = event.type === 'agentfootprint.agent.turn_end';
    const rootEnd = turnEnd && event.meta?.rootTurn === true;
    // Taken before the filter, so a filtered-out token still consumes its text.
    const reply =
      live !== undefined && event.type === 'agentfootprint.stream.token'
        ? replyFor(event)
        : undefined;
    const answer = format === 'text' && turnEnd ? answerFor(event, rootEnd) : undefined;
    const admitted = filter === undefined || filter(event);
    if (admitted) {
      queue.push(
        reply !== undefined
          ? ({ type: event.type, payload: { content: reply } } as unknown as AgentfootprintEvent)
          : format === 'text' && turnEnd
          ? ({
              type: event.type,
              payload: { finalContent: answer },
            } as unknown as AgentfootprintEvent)
          : event,
      );
    }
    // A resumed Agent's completion is independent of output selection.
    // Fresh streams and compositions still close on an admitted end.
    const fatal = event.type === 'agentfootprint.error.fatal';
    const terminal = awaitingResumedRoot
      ? rootEnd || fatal || event.type === 'agentfootprint.pause.request'
      : admitted && (turnEnd || fatal);
    if (terminal) done = true;
    if (admitted || terminal) wakeup();
  };
  const offRecord: Unsubscribe = runner.on('*', listener);
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
  /** 'text': what this stream wrote since the last `llm_start`; `undefined` = nothing. */
  let streamed: string | undefined;
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
          if (event.type === 'agentfootprint.stream.llm_start') streamed = undefined;
          else if (event.type === 'agentfootprint.stream.token') {
            const payload = (event as { payload?: { content?: string } }).payload;
            if (payload?.content) {
              streamed = (streamed ?? '') + payload.content;
              yield payload.content;
            }
          } else if (event.type === 'agentfootprint.agent.turn_end') {
            const answer = unrefusedAnswerOf(event);
            const rest = answer === undefined ? undefined : unstreamedText(streamed, answer);
            streamed = undefined;
            if (rest !== undefined) yield rest;
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
    private readonly runner: Pick<Runner<TIn, TOut>, 'on'>,
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
 * Where an event stands — its `meta.subflowPath`. A runner whose events carry
 * no `meta` (not a RunnerBase) is one run with no mounts: `[]`.
 */
function pathOf(event: AgentfootprintEvent): readonly string[] {
  return event.meta?.subflowPath ?? [];
}

/** Whether `mount` is `path` or one of its ancestors. */
function leads(mount: readonly string[], path: readonly string[]): boolean {
  return mount.length <= path.length && mount.every((segment, i) => segment === path[i]);
}

/** A turn's answer, if the event carrying it did not mark it refused. */
function unrefusedAnswerOf(event: AgentfootprintEvent): string | undefined {
  const payload = event.payload as { finalContent?: unknown; refused?: unknown } | undefined;
  return payload?.refused === undefined && typeof payload?.finalContent === 'string'
    ? payload.finalContent
    : undefined;
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
