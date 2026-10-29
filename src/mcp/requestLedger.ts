/**
 * requestLedger — which dispatched tool call an MCP request belongs to, so the
 * retry series that sends it files its attempts into THAT call's run; when the
 * MCP SDK cancels a request, so the series sending it stops; and whether the
 * request's JSON-RPC answer arrived.
 *
 * Pattern: a per-connection ledger + the SDK transport's `send`, watched in place.
 * Role:    The middle of the evidence seam (`tools/requestEvidence.ts` is its
 *          door). The retry series runs inside the transport's `fetch`, which
 *          the MCP SDK calls with a serialized body and nothing else — no tool
 *          call, no run. Three hops carry the call down to it:
 *
 *   1. call → marker    `issue`: the MCP tool gets a library-private marker and
 *                       puts it in its request's `_meta` (`callMarker.ts`). It
 *                       survives an SDK that copies the params.
 *   2. marker → id      the watched `send` takes the marker out of the message
 *                       — the server receives the bytes it always did — and
 *                       keys the call by the JSON-RPC `id` the SDK assigned.
 *   3. id → series      `claim`: the series reads the `id` back out of the body
 *                       it is about to send.
 *
 * CANCELLATION DOES NOT WAIT ON ATTRIBUTION. Every `tools/call` in flight gets
 * an entry, matched or not, and the SDK says when it gives a request up: it
 * sends `notifications/cancelled` naming the request's id — on its own
 * timeout, or when the call's signal fires — through this same `send`. The
 * ledger aborts that request's series there and then, so a request nobody waits
 * for is never asked again, even when it could not be matched to a call.
 *
 * Under `'app-authorized'` (`strict`), two more things hold:
 *   - A `tools/call` that reaches `send` without a marker this ledger issued
 *     and has not used is REFUSED there (`replayUnavailable.ts`,
 *     `'request-unmatched'`): its answer could not be tied to any call, so it
 *     is never sent rather than guessed at.
 *   - Each matched request's answer is AWAITED, by its id: the connection's
 *     incoming messages are observed for the JSON-RPC response to it. A 202, or
 *     a stream, is not that answer. The watch ends when the answer arrives,
 *     when the SDK cancels the request, when the call settles (found by its
 *     marker, never by its params object) or when the connection closes —
 *     never when only the HTTP send finished, since a 202 or a stream can still
 *     carry the answer later.
 *
 * Whether the answers are observed at all is established once, at
 * initialization: the `initialize` answer must pass the observer
 * (`answersObserved`). An SDK whose `connect` replaces the transport's
 * `onmessage` instead of keeping it leaves the observer out, and a call under
 * `'app-authorized'` is then refused before it is sent (`replayUnavailable.ts`).
 *
 * Ids are the client's, one ledger per connection, so concurrent calls — and
 * concurrent runs sharing one client — can never claim each other's request. A
 * request that is not a `tools/call` (a `tools/list`, a notification, a
 * response) claims nothing.
 *
 * `send` is installed as an OWN property of the transport instance — the same
 * object, its own `send` bound to it, so a transport class with `#private`
 * fields works as it always did. Assigning `send` again afterwards THROWS: a
 * send that bypassed the ledger would quietly lose every call's attempts.
 *
 * Each matched `tools/call` also gets ONE `RequestReplay` (`replay.ts`), the
 * facts its series, this ledger and its call share: the series' claim hands it
 * over by the request's id, the call reads it from the entry it was issued
 * (`IssuedCall`), which outlives the connection's close. The
 * series writes what HTTP showed; this ledger writes whether the JSON-RPC
 * answer arrived; the call writes how it settled.
 *
 * What it does NOT do: retry, wait, or decide anything. The series is the one
 * retry owner; this only tells it whose attempts it is making, and when the SDK
 * has stopped waiting for them.
 */

import type { RequestEvidenceSink } from '../tools/requestEvidence.js';
import { takeMarker } from './callMarker.js';
import { RequestReplay } from './replay.js';
import { McpReplayUnavailableError } from './replayUnavailable.js';

/** One call's claim on the request it sends. */
export interface RequestTicket {
  /** Where the request's attempts are filed. */
  readonly sink: RequestEvidenceSink;
  /** What cancels the call's series — the call's own signal, the client's, the call settling. */
  readonly signal?: AbortSignal;
}

/** What a series claims for the `tools/call` request it sends. */
export interface ClaimedRequest {
  /** The ticket a dispatched call issued for this request — absent when none was matched. */
  readonly ticket?: RequestTicket;
  /** Fires when the MCP SDK cancels this request (`notifications/cancelled`). */
  readonly cancelled: AbortSignal;
  /** What this request's series and its call share (`replay.ts` · `RequestReplay`). */
  readonly replay: RequestReplay;
}

/** How a connection's ledger is set up. */
export interface RequestLedgerOptions {
  /** The client's name, which a refusal names. */
  readonly server: string;
  /** The `'app-authorized'` policy is in force: see the module note. */
  readonly strict: boolean;
}

type JsonRpcId = string | number;
type Send = (message: unknown, options?: unknown) => Promise<unknown>;
type OnMessage = (message: unknown, extra?: unknown) => void;

/** The request a call's marker was matched to. */
export interface MatchedRequest {
  readonly id: JsonRpcId;
  readonly replay: RequestReplay;
}

/**
 * One call, from `issue` until it settles: the marker it sends, and the
 * request matched to it once one was. The call holds this entry itself, so
 * what it reads does not depend on the ledger still holding it.
 */
export interface IssuedCall {
  readonly marker: string;
  readonly ticket?: RequestTicket;
  /** Set once, by the watched `send`: a marker matches ONE request. */
  readonly request?: MatchedRequest;
}

/** The ledger's own, writable view of an issued call. */
type Issued = { -readonly [K in keyof IssuedCall]: IssuedCall[K] };

/** One `tools/call` in flight. */
interface InFlight {
  readonly ticket?: RequestTicket;
  readonly cut: AbortController;
  readonly replay: RequestReplay;
}

/** The method whose requests a tool call issues markers for. */
const TOOLS_CALL = 'tools/call';
/** The notification the SDK sends when it gives up one of its own requests. */
const CANCELLED = 'notifications/cancelled';
/** The request whose answer proves the observer sees this connection's answers. */
const INITIALIZE = 'initialize';

const LENIENT: RequestLedgerOptions = { server: 'mcp', strict: false };

/** Per connection: the calls issued and not yet settled, the requests being sent, the answers awaited. */
export class RequestLedger {
  /** Every call issued and not yet settled — keyed by its marker. */
  private readonly issued = new Map<string, Issued>();
  /** Every `tools/call` sent and not yet settled — keyed by its JSON-RPC id. */
  private readonly sending = new Map<JsonRpcId, InFlight>();
  /** Matched requests whose JSON-RPC answer is awaited (`strict` only) — by id. */
  private readonly awaiting = new Map<JsonRpcId, RequestReplay>();
  private initializeId: JsonRpcId | undefined;
  private initializeAnswered = false;
  private markers = 0;
  private calls = 0;
  private unboundNamed = false;

  constructor(private readonly options: RequestLedgerOptions = LENIENT) {}

  /**
   * A call is about to send its request: its entry, whose `marker` the call
   * puts in the request's `_meta` (`callMarker.ts` · `markParams`). `ticket`
   * is where its attempts are filed, when the call carries the run's evidence
   * port.
   */
  issue(ticket?: RequestTicket): IssuedCall {
    this.markers += 1;
    const call: Issued = {
      marker: `call-${this.markers}`,
      ...(ticket !== undefined && { ticket }),
    };
    this.issued.set(call.marker, call);
    return call;
  }

  /** `call` settled: forget it, and stop awaiting its request's answer. */
  settle(call: IssuedCall): void {
    if (this.issued.get(call.marker) === call) this.issued.delete(call.marker);
    const request = call.request;
    if (request !== undefined && this.awaiting.get(request.id) === request.replay) {
      this.awaiting.delete(request.id);
    }
  }

  /** The connection closed: nothing it sent is awaited, and no call is pending, any more. */
  close(): void {
    this.issued.clear();
    this.sending.clear();
    this.awaiting.clear();
  }

  /**
   * Whether this connection's answers pass the observer: the `initialize`
   * answer did. Read once the connection is initialized.
   */
  get answersObserved(): boolean {
    return this.initializeAnswered;
  }

  /** How many `tools/call` requests the watched transport has sent — matched to a call or not. */
  get toolCallsSent(): number {
    return this.calls;
  }

  /**
   * @internal How many entries the ledger holds: calls issued and not settled,
   * requests being sent, answers awaited. Zero once every call settled.
   */
  get retained(): number {
    return this.issued.size + this.sending.size + this.awaiting.size;
  }

  /** `true` the first time it is asked, then never again: an unmatched request is named once per connection. */
  firstUnbound(): boolean {
    if (this.unboundNamed) return false;
    this.unboundNamed = true;
    return true;
  }

  /**
   * Watch `transport`'s `send`: install a wrapped `send` as its OWN property, the
   * original bound to the instance itself. Returns the SAME object — or
   * `undefined` when it has no `send` to watch or refuses the property, and
   * then nothing is watched and no call should expect its attempts filed.
   *
   * Its incoming messages are watched too: an `onmessage` set before the
   * client connects, which the current MCP SDK's `Protocol.connect` keeps and
   * calls before its own dispatch. Whether it was kept is known once the
   * `initialize` answer has, or has not, passed it (`answersObserved`).
   */
  watch<T extends object>(transport: T): T | undefined {
    const send: unknown = Reflect.get(transport, 'send');
    if (typeof send !== 'function') return undefined;
    const original = (send as Send).bind(transport);
    const watched: Send = (message, options) => this.send(original, message, options);
    try {
      Object.defineProperty(transport, 'send', {
        configurable: false,
        enumerable: false,
        get: () => watched,
        set: () => {
          throw new TypeError(
            "mcpClient: this transport's `send` is watched by its request ledger, which " +
              'matches each tools/call request to the call that sent it. Assigning `send` ' +
              'again would send requests the ledger never sees, so it is refused.',
          );
        },
      });
    } catch {
      return undefined;
    }
    this.watchMessages(transport);
    return transport;
  }

  /** Observe incoming messages before whatever handled them already — never instead of it. */
  private watchMessages(transport: object): void {
    try {
      const before: unknown = Reflect.get(transport, 'onmessage');
      const handled = typeof before === 'function' ? (before as OnMessage) : undefined;
      const observing: OnMessage = (message, extra) => {
        this.observe(message);
        handled?.(message, extra);
      };
      Reflect.set(transport, 'onmessage', observing);
    } catch {
      // A transport that refuses it is never observed: `answersObserved` stays false.
    }
  }

  /** One incoming message: the `initialize` answer, or the answer to an awaited request. */
  private observe(message: unknown): void {
    const id = responseIdOf(message);
    if (id === undefined) return;
    if (id === this.initializeId) this.initializeAnswered = true;
    const replay = this.awaiting.get(id);
    if (replay === undefined) return;
    this.awaiting.delete(id);
    replay.answered();
  }

  /**
   * The `tools/call` request `body` carries, while its send runs — its ticket
   * when a call issued one, and the signal its cancellation fires. `undefined`
   * for any other body. Parses only while some request is being sent.
   */
  claim(body: unknown): ClaimedRequest | undefined {
    if (this.sending.size === 0 || typeof body !== 'string') return undefined;
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      return undefined;
    }
    const id = requestIdOf(message);
    const entry = id === undefined ? undefined : this.sending.get(id);
    if (entry === undefined) return undefined;
    return {
      ...(entry.ticket !== undefined && { ticket: entry.ticket }),
      cancelled: entry.cut.signal,
      replay: entry.replay,
    };
  }

  /** One message through the watched transport. */
  private send(original: Send, message: unknown, options: unknown): Promise<unknown> {
    this.cancelIfAsked(message);
    this.noteInitialize(message);
    const id = requestIdOf(message);
    if (id === undefined) return original(message, options);
    // The marker comes out before anything else: the server never sees it.
    const taken = takeMarker(message);
    const call = taken.marker === undefined ? undefined : this.issued.get(taken.marker);
    // One request per marker: a second message carrying it is not this call's.
    const matched = call !== undefined && call.request === undefined ? call : undefined;
    if (matched === undefined && this.options.strict) {
      return Promise.reject(
        new McpReplayUnavailableError(
          'request-unmatched',
          this.options.server,
          toolNameOf(message),
        ),
      );
    }
    this.calls += 1;
    const replay = new RequestReplay(id, this.initializeAnswered);
    if (matched !== undefined) {
      matched.request = { id, replay };
      if (this.options.strict) this.awaiting.set(id, replay);
    }
    const entry: InFlight = {
      ...(matched?.ticket !== undefined && { ticket: matched.ticket }),
      cut: new AbortController(),
      replay,
    };
    this.sending.set(id, entry);
    const release = (): void => {
      if (this.sending.get(id) === entry) this.sending.delete(id);
    };
    try {
      return Promise.resolve(original(taken.message, options)).finally(release);
    } catch (err) {
      release();
      throw err;
    }
  }

  /** The `initialize` request: its answer is the one that proves the observer is in place. */
  private noteInitialize(message: unknown): void {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) return;
    const { method, id } = message as { readonly method?: unknown; readonly id?: unknown };
    if (method !== INITIALIZE || (typeof id !== 'string' && typeof id !== 'number')) return;
    this.initializeId = id;
    this.initializeAnswered = false;
  }

  /** The SDK gave a request up: stop the series still sending it, and stop awaiting its answer. */
  private cancelIfAsked(message: unknown): void {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) return;
    const { method, params } = message as { readonly method?: unknown; readonly params?: unknown };
    if (method !== CANCELLED || params === null || typeof params !== 'object') return;
    const requestId = (params as { readonly requestId?: unknown }).requestId;
    if (typeof requestId !== 'string' && typeof requestId !== 'number') return;
    this.sending.get(requestId)?.cut.abort(sdkCancelled());
    this.awaiting.delete(requestId);
  }
}

/** The reason a series stops when the SDK cancelled its request — a fixed sentence. */
function sdkCancelled(): Error {
  return Object.assign(new Error('The MCP SDK cancelled this request.'), { name: 'AbortError' });
}

/** The tool a `tools/call` names — what a refusal names. Never its arguments. */
function toolNameOf(message: unknown): string {
  const params = (message as { readonly params?: unknown }).params;
  const name =
    params !== null && typeof params === 'object'
      ? (params as { readonly name?: unknown }).name
      : undefined;
  return typeof name === 'string' ? name : 'tools/call';
}

/** The id of a JSON-RPC RESPONSE — a result or an error, never a request or a notification. */
function responseIdOf(message: unknown): JsonRpcId | undefined {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return undefined;
  const fields = message as {
    readonly id?: unknown;
    readonly method?: unknown;
    readonly result?: unknown;
    readonly error?: unknown;
  };
  if (fields.method !== undefined || !('result' in fields || 'error' in fields)) return undefined;
  return typeof fields.id === 'string' || typeof fields.id === 'number' ? fields.id : undefined;
}

/** The id of a `tools/call` REQUEST — a response or a notification has none to claim. */
function requestIdOf(message: unknown): JsonRpcId | undefined {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return undefined;
  const { method, id } = message as { readonly method?: unknown; readonly id?: unknown };
  if (method !== TOOLS_CALL) return undefined;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
}
