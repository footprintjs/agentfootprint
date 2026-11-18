import { eitherSignal } from '../../../lib/abort.js';
import { isLocalSessionHandleLost } from '../../../tools/toolSessions.js';
import type { PooledClientSeam } from '../../clientPort.js';
import { withGuard, type RequestGuard } from '../../requestGuard.js';
import type { ThrottleFetch } from '../../throttleRetry.js';
import type { McpPoolRefusedError } from '../errors.js';
import type { PooledClient } from '../pooledClient.js';
import { Work } from '../work.js';
import { isToolCall, passesUnguarded } from './requests.js';
import { isServerAnswer } from './responses.js';

/** The transport delegate's access to the pool's existing guard and callbacks. */
export interface TransportHost {
  readonly unmatched: RequestGuard;
  refused(reason: McpPoolRefusedError['reason'], cause?: unknown): McpPoolRefusedError;
  toolsChangedOn(client: PooledClient): void;
}

/** Guarded transport work, with no independent pool state. */
export class PoolTransport {
  constructor(private readonly host: TransportHost) {}

  /** What only a pool asks of the client it opens (`clientPort.ts`). */
  seamFor(client: PooledClient, connectSignal: AbortSignal): PooledClientSeam {
    return {
      connectSignal,
      wrapFetch: (inner, claim) => this.pooledFetch(client, inner, claim),
      guardFor: (message) => this.guardOf(client, message),
      onToolsChanged: () => this.host.toolsChangedOn(client),
    };
  }

  /**
   * The guard for a message on `client` that carries none of its own: a tool
   * call always brings its call's guard, so one without it is refused; any
   * other request runs under the client's open, listing or ending — and with
   * none under way, it is refused too. Nothing pooled is sent unchecked.
   */
  private guardOf(client: PooledClient, message: unknown): RequestGuard {
    if (isToolCall(message)) return this.host.unmatched;
    return client.phase ?? this.host.unmatched;
  }

  /**
   * The pool's own fetch, outermost on every pooled transport: a request is
   * checked against its guard (the pooled call's, else the client's phase) and
   * counted under it; the guard's signal is linked in; and the answer is read
   * for the two pieces of evidence the pool classifies on — a 404 the MCP server
   * itself sent to a request that carried its session id, and a handle this
   * process lost. The client's own standalone stream (a GET), a notification and
   * an answer to the server's own request are the client's, not an operation's:
   * they pass untouched. Any other request with no guard is refused unsent.
   */
  private pooledFetch(
    client: PooledClient,
    inner: ThrottleFetch,
    claim: (body: unknown) => RequestGuard | undefined,
  ): ThrottleFetch {
    return async (input, init) => {
      // The client's own stream, a notification, an answer to the server —
      // never refused, never cut by an operation; a cancellation is counted
      // under its call at `send`.
      if ((init?.method ?? 'GET').toUpperCase() === 'GET' || passesUnguarded(init?.body)) {
        return inner(input, init);
      }
      const guard = claim(init?.body) ?? client.phase;
      if (guard === undefined) throw this.host.refused('request-unmatched');
      guard.check();
      const carriesSession = new Headers(init?.headers).has('mcp-session-id');
      const signal = eitherSignal(init?.signal ?? undefined, guard.signal);
      const sent = inner(input, {
        ...withGuard(init, guard),
        ...(signal !== undefined && { signal }),
      });
      guard.track(sent);
      try {
        const response = await sent;
        if (response.status === 404 && carriesSession && guard instanceof Work) {
          if (await isServerAnswer(response)) guard.note('server-404');
        }
        return response;
      } catch (error) {
        if (isLocalSessionHandleLost(error) && guard instanceof Work) guard.note('handle-lost');
        throw error;
      }
    };
  }
}
