/**
 * requestLedger — which dispatched tool call an MCP request belongs to, so the
 * retry series that sends it files its attempts into THAT call's run.
 *
 * Pattern: a per-connection ledger + a decorator on the SDK transport's `send`.
 * Role:    The middle of the evidence seam (`tools/requestEvidence.ts` is its
 *          door). The retry series runs inside the transport's `fetch`, which
 *          the MCP SDK calls with a serialized body and nothing else — no tool
 *          call, no run. Three hops carry the call down to it, each by an
 *          identity the hop already holds:
 *
 *   1. call → params    `issue`: the MCP tool keys its sink by the request's
 *                       params OBJECT. The SDK puts that very object into the
 *                       JSON-RPC message it hands the transport.
 *   2. params → id      `watch`: the transport's `send`, decorated, finds the
 *                       sink by `message.params` and keys it by the JSON-RPC
 *                       `id` the SDK assigned, until that send settles.
 *   3. id → series      `claim`: the series reads the `id` back out of the body
 *                       it is about to send.
 *
 * Nothing is added to the wire: the request the server receives is
 * byte-identical, and the SDK's own options keep their meanings. Ids are the
 * client's, one ledger per connection, so concurrent calls — and concurrent
 * runs sharing one client — can never claim each other's request. A request
 * no call issued (a `tools/list`, a notification, a response) claims nothing.
 *
 * What it does NOT do: retry, wait, or decide anything. The series is the one
 * retry owner; this only tells it whose attempts it is making.
 */

import type { RequestEvidenceSink } from '../tools/requestEvidence.js';

/** One call's claim on the request it sends. */
export interface RequestTicket {
  /** Where the request's attempts are filed. */
  readonly sink: RequestEvidenceSink;
  /** What cancels the call's series — the run's signal, the client's, either one. */
  readonly signal?: AbortSignal;
}

type JsonRpcId = string | number;

/** The method whose requests a tool call issues tickets for. */
const TOOLS_CALL = 'tools/call';

/** Per connection: the tickets issued and not yet sent, and the requests being sent. */
export class RequestLedger {
  /** Issued, not yet sent — keyed by the request's params object. Collected with it. */
  private readonly issued = new WeakMap<object, RequestTicket>();
  /** Sent, not yet settled — keyed by the request's JSON-RPC id. */
  private readonly sending = new Map<JsonRpcId, RequestTicket>();

  /** The call about to send `params` files its attempts through `ticket`. */
  issue(params: object, ticket: RequestTicket): void {
    this.issued.set(params, ticket);
  }

  /**
   * `transport`, with its `send` binding each issued request to its JSON-RPC id
   * for as long as the send runs. Every other property and method is the
   * transport's own, untouched.
   */
  watch<T extends object>(transport: T): T {
    const send: unknown = Reflect.get(transport, 'send');
    if (typeof send !== 'function') return transport;
    const watched = (message: unknown, options?: unknown): Promise<unknown> => {
      const id = this.bind(message);
      if (id === undefined) return Reflect.apply(send, transport, [message, options]);
      try {
        const sent = Reflect.apply(send, transport, [message, options]) as Promise<unknown>;
        return Promise.resolve(sent).finally(() => this.sending.delete(id));
      } catch (err) {
        this.sending.delete(id);
        throw err;
      }
    };
    return new Proxy(transport, {
      get: (target, key, receiver) =>
        key === 'send' ? watched : Reflect.get(target, key, receiver),
    });
  }

  /**
   * The ticket of the `tools/call` request `body` carries, while its send runs —
   * or `undefined`. Parses only while some request is being sent.
   */
  claim(body: unknown): RequestTicket | undefined {
    if (this.sending.size === 0 || typeof body !== 'string') return undefined;
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      return undefined;
    }
    const id = requestIdOf(message);
    return id === undefined ? undefined : this.sending.get(id);
  }

  /** Bind the ticket `message`'s params were issued, by the message's id. */
  private bind(message: unknown): JsonRpcId | undefined {
    const id = requestIdOf(message);
    if (id === undefined) return undefined;
    const params = (message as { readonly params?: unknown }).params;
    if (params === null || typeof params !== 'object') return undefined;
    const ticket = this.issued.get(params);
    if (ticket === undefined) return undefined;
    // One request per ticket: a second message reusing these params is not this call's.
    this.issued.delete(params);
    this.sending.set(id, ticket);
    return id;
  }
}

/** The id of a `tools/call` REQUEST — a response or a notification has none to claim. */
function requestIdOf(message: unknown): JsonRpcId | undefined {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return undefined;
  const { method, id } = message as { readonly method?: unknown; readonly id?: unknown };
  if (method !== TOOLS_CALL) return undefined;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
}
