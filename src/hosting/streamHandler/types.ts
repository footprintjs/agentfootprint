import type { AgentRunCheckpoint } from '../../core/runCheckpoint.js';
import type { Runner } from '../../core/runner.js';
import type { UnanswerablePauseReason } from '../answeredPause.js';
import type { CrossSiteOptions } from '../doorGuard.js';
import type {
  HeldConversation,
  ProtocolAdapter,
  ProtocolPlan,
  RunTranslation,
  StreamRunContext,
  ThreadBinder,
  ThreadBinding,
} from '../protocolAdapter.js';
import type { RequestSealer } from '../requestSealing.js';
import type { PausedRun, SessionLifecycle } from '../types.js';
import type { RequestContext } from '../../identity/requestContext.js';

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
export interface Held {
  readonly view: HeldConversation;
  readonly prior?: AgentRunCheckpoint;
  readonly paused?: PausedRun;
  /** A pause whose decision a resume already used (`answeredPause.ts`). */
  readonly answered?: PausedRun;
  /**
   * A pause no answer can reach any more, closed by this request: `prior` is
   * the conversation it goes on from (`answeredPause.ts`), settled once the
   * request's runner is built (`settleClosed`).
   */
  readonly closed?: { readonly paused: PausedRun; readonly reason: UnanswerablePauseReason };
}

/** Everything one accepted request runs with. */
export interface Turn<TEvent> {
  readonly plan: ProtocolPlan;
  readonly held: Held;
  readonly thread?: ThreadBinding;
  readonly runner: StreamRunner;
  readonly translation: RunTranslation<TEvent>;
  /** This request's sealed credential — its run's alone. */
  readonly request?: RequestContext;
  /**
   * An answer to a pause no answer can reach (`Held.closed`): nothing runs —
   * the pause is closed and the run ends cancelled, so a client still holding
   * the question lets it go.
   */
  readonly closes?: true;
}
