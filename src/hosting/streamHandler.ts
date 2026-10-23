/**
 * streamHandler — one run per request, streamed in a wire protocol, as a
 * framework-agnostic Fetch-API handler: `(request: Request) => Promise<Response>`.
 *
 * Pattern: Template method over a {@link ProtocolAdapter} (the protocol is a
 *          strategy; AG-UI is one). Everything HTTP happens here once — the
 *          door guard, the body ceiling, the JSON parse, binding the
 *          conversation to its caller, keeping it between requests, the client
 *          hanging up, a failure that is never the process's — so an adapter
 *          only reads its request, plans the turn and translates.
 * Role:    the host for a protocol whose response is a STREAM OF EVENTS rather
 *          than text pieces (`httpHost`'s port). It mounts in anything that
 *          speaks `Request`/`Response` — a framework's route handler, an edge
 *          or serverless runtime, or Node through any fetch adapter.
 *          Deliberately names no vendor, like every file in this folder.
 *
 * THE REQUEST IS UNTRUSTED. A body is what anybody could send. It decides
 * nothing the server owns:
 *   - WHO is calling and WHICH conversation is theirs come from the app's
 *     {@link ThreadBinder} (`threads`), from the request's headers — the id a
 *     request names is format-checked caller data and never a key;
 *   - WHAT WAS SAID BEFORE comes from the server: the session store
 *     (`sessions`), or the agent's own memory keyed by the bound session;
 *   - WHAT A PAUSED RUN WAITS ON is the stored run's own record — an answer is
 *     matched to it by the adapter, never taken on the request's word;
 *   - identity and redaction settings never come from a request. A credential
 *     the request CARRIES (a gateway's per-request token) reaches its own run
 *     only through the app's `sealRequest`, sealed: never a frame, a stored
 *     session or a checkpoint.
 *
 * NOTHING IS SHARED BETWEEN REQUESTS. Every request builds a FRESH runner
 * (`agent`, a factory): footprintjs runs one executor per run and a runner
 * holds one run's context, so a request can neither see another's events nor
 * leave anything behind for one — no shared listener, recorder, buffer, tool
 * session or frame count (each stream numbers its own frames, and hands the
 * number to the framing: `SseFramePosition`). A factory that hands back a
 * runner it handed back before is refused; so is a `sealRequest` that hands
 * back a sealed request twice. The handler's own state is KEYS, never content:
 * the bound conversations with a turn in flight and who holds each (a second
 * turn on one conversation is refused rather than racing the first for the
 * stored state), and the runners and sealed requests already used (by
 * identity, held weakly).
 *
 * ONE TURN PER THREAD IS A PER-PROCESS GUARD. Two instances of the handler
 * (several serverless instances, several workers) do not see each other's
 * turns: route a thread to one instance (sticky sessions), or a double-sent
 * answer can resume one paused run twice and a later persist can overwrite an
 * earlier one. The session store port has no compare-and-set yet.
 *
 * The laws it keeps from `httpHost`:
 *   - The door guard runs first, on the headers alone (`doorGuard.ts`): a Host
 *     not configured (421), a browser origin not allowed (403), a POST that
 *     does not say it is JSON (415). A refused body is never read.
 *   - A body over `maxBodyBytes` is refused at the byte that crosses it (413).
 *   - A refusal answers with its own status and code (`refusalStatus.ts`);
 *     anything else is a 500 that names nothing the caller sent and no thrown
 *     message.
 *   - Nothing in a request's lifecycle is the process's failure: every step is
 *     caught, and a stream always ends.
 */

import { CONSUMER_SCOPE_RUN_ID, eventBelongsToRun } from '../bridge/eventMeta.js';
import { isPaused, type RunnerPauseOutcome } from '../core/pause.js';
import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type { Runner } from '../core/runner.js';
import { toWireJson } from '../lib/wireJson.js';
import { checkSessionId, doorGuard, type CrossSiteOptions } from './doorGuard.js';
import {
  envelopeOwner,
  readEnvelope,
  readPausedRun,
  toEnvelope,
  toPausedEnvelope,
} from './envelope.js';
import { RequestTooLargeError, WireRequestRefusal } from './errors.js';
import { describePause } from './pendingAsk.js';
import type {
  HeldConversation,
  ProtocolAdapter,
  ProtocolPlan,
  RunSettlement,
  RunTranslation,
  StreamRunContext,
  ThreadBinder,
  ThreadBinding,
} from './protocolAdapter.js';
import { REFUSAL_STATUS } from './refusalStatus.js';
import { AnswerValidationError } from '../answer-validation/types.js';
import { requestSealing, type RequestSealer } from './requestSealing.js';
import type { PausedRun, SessionLifecycle } from './types.js';
import type { RequestContext } from '../identity/requestContext.js';

/** The default body ceiling — 1 MiB, the same as `nodeHost`. */
export const DEFAULT_STREAM_MAX_BODY_BYTES = 1_048_576;

/** The default keep-alive interval: an SSE comment every 15 s of silence. */
export const DEFAULT_STREAM_HEARTBEAT_MS = 15_000;

/**
 * The runner one request runs — an `Agent`, an `LLMCall`, a composition. An
 * Agent's `checkpoint()` is the conversation a session store keeps; a runner
 * without one answers each request's message on its own.
 */
export type StreamRunner = Pick<Runner, 'on' | 'run' | 'resume'> & {
  checkpoint?(): AgentRunCheckpoint | undefined;
  shutdown?(options?: { readonly stop?: boolean }): Promise<void>;
};

/** Options for {@link streamHandler}. */
export interface StreamHandlerOptions<TRequest, TEvent> extends CrossSiteOptions {
  /**
   * Builds a FRESH runner for every request — called once per request, with
   * what that request's runner is built with ({@link StreamRunContext}: the
   * tools the caller runs, the values the app's validators accepted, the bound
   * conversation). A runner is never shared between requests; one handed back
   * twice is refused.
   */
  readonly agent: (run: StreamRunContext) => StreamRunner;
  /** The wire protocol — `agUi()` from `agentfootprint/ag-ui`. */
  readonly adapter: ProtocolAdapter<TRequest, TEvent>;
  /**
   * The app's port that binds the conversation a request names to the caller
   * the app authenticates ({@link ThreadBinder}). Without it every request is
   * a conversation of one message: no session, no identity, nothing kept.
   */
  readonly threads?: ThreadBinder;
  /**
   * Where a bound conversation is kept between requests — what was said (an
   * Agent's `checkpoint()`) and a run paused on an answer — under the key
   * `threads` binds (`memorySessions()`, `sqliteSessions()`, or yours). Needs
   * `threads`: nothing is ever kept under the id a request names.
   */
  readonly sessions?: SessionLifecycle;
  /**
   * Seal the credential a request carries for its run ({@link RequestSealer}) —
   * a gateway's per-request token in a header, read by a `requestCredentials`
   * provider for the tools that declare a `needs` for it. Called once per
   * request that runs, after the thread is bound and the turn is planned, with
   * the request's headers; its handle goes to THAT request's
   * `run()` / `resume()` and nowhere else — never a frame, a stored session or
   * a checkpoint. A handle returned twice is refused; a sealer that throws
   * refuses the request in fixed words (`ERR_REQUEST_NOT_SEALED`, 400).
   * Without it, no run carries a request.
   */
  readonly sealRequest?: RequestSealer;
  /** The largest request body read, in bytes. Default {@link DEFAULT_STREAM_MAX_BODY_BYTES}. */
  readonly maxBodyBytes?: number;
  /**
   * An SSE comment (`: ping`) every this many milliseconds, so a proxy does not
   * cut a stream that is quiet while the model thinks. Default
   * {@link DEFAULT_STREAM_HEARTBEAT_MS}; `0` turns it off.
   */
  readonly heartbeatMs?: number;
  /** Names this handler in refusals. Default `'<adapter name> stream'`. */
  readonly name?: string;
}

/** A Fetch-API handler: one request in, one streamed response out. */
export type StreamHandler = (request: Request) => Promise<Response>;

/** What the server holds for one bound conversation, read once per request. */
interface Held {
  readonly view: HeldConversation;
  readonly prior?: AgentRunCheckpoint;
  readonly paused?: PausedRun;
}

/** Everything one accepted request runs with. */
interface Turn<TEvent> {
  readonly plan: ProtocolPlan;
  readonly held: Held;
  readonly thread?: ThreadBinding;
  readonly runner: StreamRunner;
  readonly translation: RunTranslation<TEvent>;
  /** This request's sealed credential — its run's alone. */
  readonly request?: RequestContext;
}

/**
 * Serve runs in `adapter`'s protocol: POST a protocol request, read a stream
 * of the protocol's events.
 *
 * @throws TypeError at construction for options that cannot be served, and
 *   when the adapter's framing cannot be built (an optional peer missing) —
 *   refused at boot, never mid-request.
 *
 * @example A route handler that speaks `Request`/`Response`
 * ```ts
 * import { memorySessions, streamHandler } from 'agentfootprint/hosting';
 * import { agUi } from 'agentfootprint/ag-ui';
 *
 * export const POST = streamHandler({
 *   agent: ({ tools }) => buildAgent(tools), // a fresh agent per request
 *   adapter: agUi(),
 *   threads: { bind: ({ conversation, headers }) => bindToUser(conversation, headers) },
 *   sessions: memorySessions(),
 * });
 * ```
 */
export function streamHandler<TRequest, TEvent>(
  options: StreamHandlerOptions<TRequest, TEvent>,
): StreamHandler {
  const { adapter, threads, sessions } = options;
  const name = options.name ?? `${adapter.name} stream`;
  if (typeof options.agent !== 'function') {
    throw new TypeError(
      `[hosting] '${name}': agent must be a function that builds a FRESH runner for every ` +
        `request — a runner holds one run's context, and one shared between requests would ` +
        `hand one caller's run to another.`,
    );
  }
  if (sessions !== undefined && threads === undefined) {
    throw new TypeError(
      `[hosting] '${name}': sessions needs threads. A conversation is kept under the key the ` +
        `app binds to its caller (threads.bind), never under the id a request names.`,
    );
  }
  const limit = positive(options.maxBodyBytes, DEFAULT_STREAM_MAX_BODY_BYTES, 'maxBodyBytes', name);
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_STREAM_HEARTBEAT_MS;
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 0) {
    throw new TypeError(`[hosting] '${name}': heartbeatMs must be 0 (off) or a positive number.`);
  }
  const guard = doorGuard({ ...options, name });
  const framing = adapter.framing();
  const seal = requestSealing(options.sealRequest, name);
  const bytes = new TextEncoder();
  /**
   * Bound conversations with a turn in flight — the key, and who holds it (so
   * anybody else hears "not found", never "busy").
   */
  const inFlight = new Map<string, string | undefined>();
  /** Runners already used, by identity — so a factory that shares one is caught. */
  const used = new WeakSet<object>();

  /** One answer for "none", "another's" and "nobody's" — a caller learns no ids. */
  const notFound = (): WireRequestRefusal =>
    new WireRequestRefusal(
      'ERR_SESSION_NOT_FOUND',
      `'${name}': that conversation is not one you can open.`,
      404,
    );

  /** Bind the conversation the request names to its caller — the app's port decides. */
  async function bind(request: TRequest, headers: Readonly<Record<string, string>>) {
    if (threads === undefined) return undefined;
    const thread = await threads.bind({ conversation: adapter.conversation(request), headers });
    if (thread === null || typeof thread !== 'object' || typeof thread.sessionId !== 'string') {
      throw new TypeError('threads.bind returned no session');
    }
    const bad = checkSessionId(thread.sessionId, name);
    if (bad !== undefined) throw bad;
    return thread;
  }

  /**
   * The stored conversation, when it is the caller's — refusing one that is not.
   * Asked BEFORE anything about the conversation's activity, so a caller it is
   * not learns "not found" and never "busy" — and never holds its turn.
   */
  async function ownersOnly(thread: ThreadBinding | undefined) {
    if (sessions === undefined || thread === undefined) return undefined;
    await sessions.onWake?.(thread.sessionId, 'invoke');
    const stored = await sessions.hydrate(thread.sessionId);
    // Whose conversation this is, before a line of it is read. One answer for
    // "none", "another's" and "nobody's", so a caller learns no ids.
    if (stored !== undefined && envelopeOwner(stored) !== thread.identity?.principal)
      throw notFound();
    return stored;
  }

  /** Read what the server holds for the bound conversation — under the turn's claim. */
  async function hold(thread: ThreadBinding | undefined): Promise<Held> {
    const stored = await ownersOnly(thread);
    if (stored === undefined) return { view: { continues: false } };
    if (stored.format === 'flowchart-v1') {
      const paused = readPausedRun(stored);
      const record = paused.wire?.protocol === adapter.name ? paused.wire.record : undefined;
      return {
        paused,
        view: {
          continues: false,
          awaiting: {
            pending: paused.pending,
            ...(record !== undefined && { suspension: record }),
          },
        },
      };
    }
    const prior = readEnvelope(stored);
    return { prior, view: { continues: true } };
  }

  /** A fresh runner for this request — never one the factory handed out before. */
  function build(context: StreamRunContext): StreamRunner {
    const runner = options.agent(context);
    if (
      runner === null ||
      typeof runner !== 'object' ||
      typeof runner.on !== 'function' ||
      typeof runner.run !== 'function'
    ) {
      throw new TypeError('agent returned no runner');
    }
    if (used.has(runner)) {
      throw new WireRequestRefusal(
        'ERR_RUNNER_REUSED',
        `'${name}': the agent factory returned a runner it returned before. Every ` +
          `request needs a FRESH runner — a shared one hands one caller's run to another.`,
        500,
      );
    }
    used.add(runner);
    return runner;
  }

  /** Keep what the run left behind, then say how it ended — kept FIRST, told after. */
  async function keep(
    turn: Turn<TEvent>,
    out: unknown,
    recordRunId: string | undefined,
  ): Promise<RunSettlement> {
    const { thread, runner, held, translation } = turn;
    const store = thread === undefined ? undefined : sessions;
    if (isPaused(out)) {
      const awaiting = adapter.awaitsCaller?.(out.pauseData) === true ? 'caller' : 'person';
      if (store !== undefined && thread !== undefined) {
        const record = translation.suspension?.(awaiting);
        const conversation =
          runner.checkpoint?.() ?? noConversation(turn, recordRunId, thread.identity);
        await store.persist(
          thread.sessionId,
          toPausedEnvelope({
            checkpoint: out.checkpoint,
            conversation,
            pending: describePause(out as RunnerPauseOutcome, thread.sessionId),
            ...(record !== undefined && { wire: { protocol: adapter.name, record } }),
          }),
        );
      }
      return { kind: 'paused', awaiting };
    }
    if (store !== undefined && thread !== undefined) {
      const conversation = runner.checkpoint?.();
      if (conversation !== undefined)
        await store.persist(thread.sessionId, toEnvelope(conversation));
      // A runner that keeps no conversation still clears the pause it continued.
      else if (held.paused !== undefined)
        await store.persist(
          thread.sessionId,
          toEnvelope(noConversation(turn, recordRunId, thread.identity)),
        );
    }
    return { kind: 'finished' };
  }

  /** Run the turn; every event the run serves goes through the translation; settle once. */
  async function serve(
    turn: Turn<TEvent>,
    write: (events: readonly TEvent[]) => void,
    signal: AbortSignal,
    release: () => void,
  ): Promise<void> {
    const { plan, held, thread, runner, translation, request } = turn;
    // A translation that throws is a fault in the adapter, never the run's: the
    // run goes on, and the stream still ends.
    const safely = (produce: () => readonly TEvent[]): void => {
      try {
        write(produce());
      } catch {
        // nothing more this request can be told
      }
    };
    let runId: string | undefined;
    let off: unknown;
    let settlement: RunSettlement;
    try {
      // The runner is this request's alone; the run filter still holds a fact a
      // shared resource stamped for another run or session out of the stream.
      off = runner.on('*', (event) => {
        const named = event.meta?.runId;
        if (runId === undefined && typeof named === 'string' && named !== CONSUMER_SCOPE_RUN_ID)
          runId = named;
        if (!eventBelongsToRun(event.meta, { runId: runId ?? '', sessionId: thread?.sessionId }))
          return;
        safely(() => translation.event(event));
      });
      if (signal.aborted) throw new Error('the caller left before the run started');
      const runOptions = {
        signal,
        ...(thread !== undefined && { sessionId: thread.sessionId }),
        ...(thread?.identity !== undefined && { identity: thread.identity }),
        ...(request !== undefined && { request }),
      };
      const out =
        plan.turn.kind === 'answer'
          ? await runner.resume(
              (held.paused as PausedRun).checkpoint as never,
              plan.turn.answer as never,
              runOptions as never,
            )
          : await runner.run(
              (typeof runner.checkpoint === 'function' && held.prior !== undefined
                ? { message: plan.turn.message, continueFrom: held.prior }
                : { message: plan.turn.message }) as never,
              runOptions as never,
            );
      settlement = await keep(turn, out, runId);
    } catch (err) {
      settlement = signal.aborted ? { kind: 'cancelled' } : failedSettlement(err);
    } finally {
      // The conversation is free BEFORE the caller hears the end — and before
      // anything else that could throw: a client that answers on RUN_FINISHED
      // must not find its own turn still running, ever.
      release();
      try {
        if (typeof off === 'function') off();
      } catch {
        // a runner that cannot unsubscribe is thrown away with this request
      }
    }
    safely(() => translation.settle(settlement));
    // Tool sessions this request's runner opened close with it; a strategy the
    // app shares between runners is drained, never stopped.
    void runner.shutdown?.({ stop: false })?.catch(() => undefined);
  }

  function respond(turn: Turn<TEvent>, request: Request, release: () => void): Response {
    const abort = new AbortController();
    const hangUp = (): void => abort.abort();
    // A caller already gone never starts its run.
    if (request.signal?.aborted === true) abort.abort();
    else request.signal?.addEventListener('abort', hangUp, { once: true });
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stop = (): void => {
      closed = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      request.signal?.removeEventListener('abort', hangUp);
    };

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (text: string): void => {
          if (closed) return;
          try {
            controller.enqueue(bytes.encode(text));
          } catch {
            stop(); // the stream went away under us
          }
        };
        // This stream's own count — never the framing's, never another stream's.
        let written = 0;
        const write = (events: readonly TEvent[]): void => {
          for (const event of events) {
            const frame = framing.frame(event, { sequence: written + 1 });
            written += 1;
            send(frame);
          }
        };
        if (heartbeatMs > 0) {
          heartbeat = setInterval(() => send(': ping\n\n'), heartbeatMs);
          (heartbeat as { unref?: () => void }).unref?.();
        }
        const end = (): void => {
          if (closed) return;
          stop();
          try {
            controller.close();
          } catch {
            // already closed by the reader
          }
        };
        void serve(turn, write, abort.signal, release).then(end, end);
      },
      cancel() {
        stop();
        abort.abort();
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': framing.contentType,
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  }

  return async (request) => {
    /** The conversation this request holds while it is in flight — released exactly once. */
    let claimed: string | undefined;
    const release = (): void => {
      if (claimed !== undefined) inFlight.delete(claimed);
      claimed = undefined;
    };
    try {
      if (request.method !== 'POST') {
        return refusal(405, `[hosting] '${name}' answers POST only.`, 'ERR_METHOD_NOT_ALLOWED', {
          allow: 'POST',
        });
      }
      // Frozen: the reader, the binder and the sealer each read the same headers.
      const headers = Object.freeze(headersOf(request));
      const refused = guard.check({ method: request.method, headers });
      if (refused !== undefined) return refusal(refused.status, refused.message, refused.code);
      const text = await readBody(request, limit, name);
      let body: unknown;
      try {
        body = text.trim() === '' ? {} : JSON.parse(text);
      } catch {
        return refusal(
          400,
          `[hosting] '${name}': the request body is not JSON.`,
          'ERR_INVALID_JSON',
        );
      }
      const read = adapter.readRequest({ body, headers });
      const thread = await bind(read, headers);
      if (thread !== undefined) {
        // Ownership first: a caller the conversation is not answered "not
        // found" whether or not a turn is running, and never claims it.
        await ownersOnly(thread);
        const principal = thread.identity?.principal;
        if (inFlight.has(thread.sessionId)) {
          // Even before a first turn has stored anything: the claimant is the owner.
          if (inFlight.get(thread.sessionId) !== principal) throw notFound();
          return refusal(
            409,
            `[hosting] '${name}': a turn of that conversation is already in flight. Send the ` +
              `next turn when it ends.`,
            'ERR_CONCURRENT_RUN',
          );
        }
        inFlight.set(thread.sessionId, principal);
        claimed = thread.sessionId;
      }
      const held = await hold(thread);
      const plan = adapter.plan(read, held.view, {
        headers,
        ...(thread !== undefined && { thread }),
        keepsConversation: threads !== undefined,
        keepsPauses: threads !== undefined && sessions !== undefined,
      });
      // Sealed only for a request that runs: every refusal is behind it.
      const sealed = await seal?.({ headers });
      const runner = build({
        tools: plan.tools ?? [],
        accepted: plan.accepted ?? {},
        ...(thread !== undefined && { thread }),
      });
      const translation = adapter.open(
        read,
        plan.turn.kind === 'answer' ? held.view.awaiting?.suspension : undefined,
      );
      // The stream owns the claim from here: released when the run ends.
      const owned = claimed;
      claimed = undefined;
      return respond(
        {
          plan,
          held,
          ...(thread !== undefined && { thread }),
          runner,
          translation,
          ...(sealed !== undefined && { request: sealed }),
        },
        request,
        () => {
          if (owned !== undefined) inFlight.delete(owned);
        },
      );
    } catch (err) {
      return failure(err, name);
    } finally {
      release();
    }
  };
}

/**
 * A conversation record for a runner that keeps none (an `LLMCall`, a
 * composition): no history, only what a stored session needs — the run, the
 * message, and whose it is.
 */
function noConversation(
  turn: Turn<unknown>,
  recordRunId: string | undefined,
  identity: ThreadBinding['identity'],
): AgentRunCheckpoint {
  const message =
    turn.plan.turn.kind === 'message'
      ? turn.plan.turn.message
      : turn.held.paused?.conversation.originalInput.message ?? '';
  return {
    version: 1,
    runId: recordRunId ?? 'unknown',
    history: [],
    lastCompletedIteration: 0,
    originalInput: { message },
    checkpointedAt: Date.now(),
    ...(identity !== undefined && { identity }),
  };
}

/**
 * How a rejected run settles: failed — naming a library refusal by its code
 * when the error's CLASS is one (never its words; a thrown value that only
 * claims the code is a failure like any other).
 */
function failedSettlement(err: unknown): RunSettlement {
  return err instanceof AnswerValidationError
    ? { kind: 'failed', refusal: 'ERR_ANSWER_VALIDATION' }
    : { kind: 'failed' };
}

/** The refusal an error means — its own status and code, or a 500 that quotes nothing. */
function failure(err: unknown, name: string): Response {
  if (err instanceof RequestTooLargeError) return refusal(413, err.message, err.code);
  if (err instanceof WireRequestRefusal) return refusal(err.status, err.message, err.code);
  const code = (err as { code?: unknown } | null)?.code;
  if (err instanceof Error && typeof code === 'string' && REFUSAL_STATUS[code] !== undefined) {
    return refusal(REFUSAL_STATUS[code] as number, err.message, code);
  }
  // Never the thrown message: it is the author's note to their own logs.
  return refusal(500, `[hosting] '${name}' could not serve the request.`, 'ERR_INTERNAL');
}

/** A JSON refusal: `{ error, code }` under the refusal's own status. */
function refusal(
  status: number,
  message: string,
  code: string,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(toWireJson({ error: message, code }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** The request's headers, names lower-cased (the door guard's and an adapter's view). */
function headersOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** The body as text, refused at the byte that crosses `limit`. */
async function readBody(request: Request, limit: number, name: string): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new RequestTooLargeError(limit, name);
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new RequestTooLargeError(limit, name);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

function positive(
  value: number | undefined,
  fallback: number,
  field: string,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`[hosting] '${name}': ${field} must be a positive whole number of bytes.`);
  }
  return value;
}
