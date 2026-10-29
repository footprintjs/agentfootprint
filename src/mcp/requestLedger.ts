/**
 * requestLedger — which dispatched tool call an MCP request belongs to, so the
 * retry series that sends it files its attempts into THAT call's run; and when
 * the MCP SDK cancels a request, so the series sending it stops.
 *
 * Pattern: a per-connection ledger + the SDK transport's `send`, watched in place.
 * Role:    The middle of the evidence seam (`tools/requestEvidence.ts` is its
 *          door). The retry series runs inside the transport's `fetch`, which
 *          the MCP SDK calls with a serialized body and nothing else — no tool
 *          call, no run. Three hops carry the call down to it, each by an
 *          identity the hop already holds:
 *
 *   1. call → params    `issue`: the MCP tool keys its ticket by the request's
 *                       params OBJECT. The SDK puts that very object into the
 *                       JSON-RPC message it hands the transport.
 *   2. params → id      the watched `send` finds the ticket by `message.params`
 *                       and keys it by the JSON-RPC `id` the SDK assigned, until
 *                       that send settles.
 *   3. id → series      `claim`: the series reads the `id` back out of the body
 *                       it is about to send.
 *
 * CANCELLATION DOES NOT WAIT ON ATTRIBUTION. Every `tools/call` in flight gets
 * an entry, ticket or not, and the SDK says when it gives a request up: it sends
 * `notifications/cancelled` naming the request's id — on its own timeout, or
 * when the call's signal fires — through this same `send`. The ledger aborts
 * that request's series there and then, so a request nobody waits for is never
 * asked again, even when its params could not be matched to a call.
 *
 * Nothing is added to the wire: the request the server receives is
 * byte-identical, and the SDK's own options keep their meanings. Ids are the
 * client's, one ledger per connection, so concurrent calls — and concurrent
 * runs sharing one client — can never claim each other's request. A request
 * that is not a `tools/call` (a `tools/list`, a notification, a response)
 * claims nothing.
 *
 * `send` is installed as an OWN property of the transport instance — the same
 * object, its own `send` bound to it, so a transport class with `#private`
 * fields works as it always did. Assigning `send` again afterwards THROWS: a
 * send that bypassed the ledger would quietly lose every call's attempts.
 *
 * Each `tools/call` in flight also gets ONE `RequestReplay` (`replay.ts`), the
 * facts its series, this ledger and its call share: the series' claim hands it
 * over by the request's id, the call finds it by its own params object
 * (`replayOf`). The series writes what HTTP showed (an attempt with no
 * response, the status it delivered); this ledger writes whether the JSON-RPC
 * answer to that id arrived — a 202, or a stream, is not that answer; the call
 * writes how it settled. When the SDK copied the params, the call finds none —
 * and fails with its own error, as before.
 *
 * What it does NOT do: retry, wait, or decide anything. The series is the one
 * retry owner; this only tells it whose attempts it is making, and when the SDK
 * has stopped waiting for them.
 */

import type { RequestEvidenceSink } from '../tools/requestEvidence.js';
import { RequestReplay } from './replay.js';

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

type JsonRpcId = string | number;
type Send = (message: unknown, options?: unknown) => Promise<unknown>;
type OnMessage = (message: unknown, extra?: unknown) => void;

/** One `tools/call` in flight. */
interface InFlight {
  readonly ticket?: RequestTicket;
  readonly cut: AbortController;
  readonly replay: RequestReplay;
}

/** The method whose requests a tool call issues tickets for. */
const TOOLS_CALL = 'tools/call';
/** The notification the SDK sends when it gives up one of its own requests. */
const CANCELLED = 'notifications/cancelled';

/** Per connection: the tickets issued and not yet sent, and the requests being sent. */
export class RequestLedger {
  /** Issued, not yet sent — keyed by the request's params object. Collected with it. */
  private readonly issued = new WeakMap<object, RequestTicket>();
  /** Tickets a request was bound to. */
  private readonly bound = new WeakSet<RequestTicket>();
  /** Every `tools/call` sent and not yet settled — keyed by its JSON-RPC id. */
  private readonly sending = new Map<JsonRpcId, InFlight>();
  /** Each `tools/call` request's replay facts, by the params object it was sent with. Collected with it. */
  private readonly replays = new WeakMap<object, RequestReplay>();
  /** Requests whose JSON-RPC answer has not arrived yet — by id, until it does or the call settles. */
  private readonly awaiting = new Map<JsonRpcId, RequestReplay>();
  /** The connection's incoming messages reach `observe` — the logical layer is known. */
  private observing = false;
  private calls = 0;
  private unboundNamed = false;

  /** The call about to send `params` files its attempts through `ticket`. */
  issue(params: object, ticket: RequestTicket): void {
    this.issued.set(params, ticket);
  }

  /** Whether a request the transport sent was bound to `ticket`. */
  wasBound(ticket: RequestTicket): boolean {
    return this.bound.has(ticket);
  }

  /**
   * The replay facts of the `tools/call` sent with `params` — the call's own
   * params object — or `undefined` when no such request was sent, or the SDK
   * copied the params before sending them.
   */
  replayOf(params: object): RequestReplay | undefined {
    return this.replays.get(params);
  }

  /** The call that sent `params` settled: its answer is no longer awaited. */
  release(params: object): void {
    const replay = this.replays.get(params);
    if (replay !== undefined && this.awaiting.get(replay.id) === replay) {
      this.awaiting.delete(replay.id);
    }
  }

  /** How many `tools/call` requests the watched transport has sent — matched to a call or not. */
  get toolCallsSent(): number {
    return this.calls;
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
   * Its incoming messages are watched too, for each request's JSON-RPC answer:
   * an `onmessage` set before the client connects, which the MCP SDK's
   * `Protocol.connect` keeps and calls before its own dispatch. Until a message
   * has actually been seen there (the `initialize` answer, always first), the
   * logical layer counts as unknown and decides nothing.
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
      // A transport that refuses it keeps the logical layer unknown: nothing is decided on it.
    }
  }

  /** One incoming message: the answer to a `tools/call` in flight, when it is one. */
  private observe(message: unknown): void {
    this.observing = true;
    const id = responseIdOf(message);
    if (id === undefined) return;
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
    const id = this.bind(message);
    if (id === undefined) return original(message, options);
    const entry = this.sending.get(id);
    const release = (): void => {
      if (this.sending.get(id) === entry) this.sending.delete(id);
    };
    try {
      return Promise.resolve(original(message, options)).finally(release);
    } catch (err) {
      release();
      throw err;
    }
  }

  /** Register a `tools/call` in flight, with the ticket its params were issued — if any. */
  private bind(message: unknown): JsonRpcId | undefined {
    const id = requestIdOf(message);
    if (id === undefined) return undefined;
    this.calls += 1;
    const params = (message as { readonly params?: unknown }).params;
    const ticket =
      params !== null && typeof params === 'object' ? this.issued.get(params) : undefined;
    if (ticket !== undefined) {
      // One request per ticket: a second message reusing these params is not this call's.
      this.issued.delete(params as object);
      this.bound.add(ticket);
    }
    const replay = new RequestReplay(id, this.observing);
    if (params !== null && typeof params === 'object') this.replays.set(params, replay);
    if (this.observing) this.awaiting.set(id, replay);
    this.sending.set(id, {
      ...(ticket !== undefined && { ticket }),
      cut: new AbortController(),
      replay,
    });
    return id;
  }

  /** The SDK gave a request up: stop the series still sending it. */
  private cancelIfAsked(message: unknown): void {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) return;
    const { method, params } = message as { readonly method?: unknown; readonly params?: unknown };
    if (method !== CANCELLED || params === null || typeof params !== 'object') return;
    const requestId = (params as { readonly requestId?: unknown }).requestId;
    if (typeof requestId !== 'string' && typeof requestId !== 'number') return;
    this.sending.get(requestId)?.cut.abort(sdkCancelled());
  }
}

/** The reason a series stops when the SDK cancelled its request — a fixed sentence. */
function sdkCancelled(): Error {
  return Object.assign(new Error('The MCP SDK cancelled this request.'), { name: 'AbortError' });
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
