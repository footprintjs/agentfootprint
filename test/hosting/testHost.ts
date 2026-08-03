/**
 * A minimal `AgentHost` for tests — no socket, no protocol, no HTTP.
 *
 * It exists to prove the port is a port: if a handler written for `nodeHost`
 * runs unchanged against ~60 lines of in-process plumbing, nothing HTTP-shaped
 * leaked into the contract.
 *
 * By default it declares NO capabilities, which is the interesting case: it
 * implements `emit` by BUFFERING (what an adapter that cannot stream must do)
 * and never surfaces the buffer, because `complete(output)` is what the caller
 * is entitled to. Pass `{ streaming: true }` for the other side of the branch.
 */

import { HostClosedError } from '../../src/hosting/index.js';
import type {
  AgentHost,
  HostCapability,
  HostHandle,
  HostHandler,
  HostReply,
  PendingAsk,
} from '../../src/hosting/index.js';

/** Everything a caller can observe about one delivered request. */
export interface DeliveredReply {
  readonly output?: string;
  readonly error?: string;
  readonly code?: string;
  /** The question the run stopped on, when it stopped on one. */
  readonly awaiting?: PendingAsk;
  readonly chunks: readonly string[];
}

export interface InProcessHost extends AgentHost {
  /** Drive one request straight into the served handler. */
  deliver(request: {
    readonly input: string;
    readonly sessionId?: string;
    /** A person's answer to an outstanding ask — makes this a resume. */
    readonly decision?: unknown;
    readonly headers?: Readonly<Record<string, string>>;
  }): Promise<DeliveredReply>;
}

export function inProcessHost(options: { readonly streaming?: boolean } = {}): InProcessHost {
  const streams = options.streaming === true;
  const name = streams ? 'inProcessStreamingHost' : 'inProcessHost';
  let handler: HostHandler | undefined;
  let accepting = false;
  const inFlight = new Set<Promise<unknown>>();

  return {
    name,
    capabilities: (streams ? ['streaming'] : []) as readonly HostCapability[],
    serve(incoming: HostHandler): Promise<HostHandle> {
      handler = incoming;
      accepting = true;
      return Promise.resolve({
        async close(): Promise<void> {
          accepting = false;
          await Promise.allSettled([...inFlight]);
        },
      });
    },
    async deliver(request): Promise<DeliveredReply> {
      if (!accepting) {
        const refusal = new HostClosedError(name);
        return { error: refusal.message, code: refusal.code, chunks: [] };
      }
      const seen: string[] = [];
      let output: string | undefined;
      let error: string | undefined;
      let code: string | undefined;
      let awaiting: PendingAsk | undefined;
      let settled = false;
      const reply: HostReply = {
        emit: (chunk) => {
          if (!settled) seen.push(chunk);
        },
        complete: (value) => {
          if (settled) return;
          settled = true;
          output = value;
        },
        // The third terminal. A pause leaves through here, never through
        // fail() — this host implements it so the tests can watch the
        // difference between "unfinished" and "failed".
        awaiting: (pending) => {
          if (settled) return;
          settled = true;
          awaiting = pending;
        },
        fail: (err) => {
          if (settled) return;
          settled = true;
          error = err.message;
          code = (err as { code?: string }).code;
        },
      };
      const work = (async () => {
        try {
          await handler?.(
            {
              input: request.input,
              ...(request.sessionId !== undefined && { sessionId: request.sessionId }),
              ...(request.decision !== undefined && { decision: request.decision }),
              ...(request.headers !== undefined && { headers: request.headers }),
            },
            reply,
          );
        } catch (err) {
          reply.fail(err instanceof Error ? err : new Error(String(err)));
        }
        if (!settled) {
          reply.fail(
            new Error('[hosting] the handler returned without calling complete() or fail().'),
          );
        }
      })();
      inFlight.add(work);
      try {
        await work;
      } finally {
        inFlight.delete(work);
      }
      return {
        ...(output !== undefined && { output }),
        ...(error !== undefined && { error }),
        ...(code !== undefined && { code }),
        ...(awaiting !== undefined && { awaiting }),
        // Chunks reach the caller only on a host that declares streaming; on
        // the default one the buffer is settled by the completion.
        chunks: streams ? seen : [],
      };
    },
  };
}
