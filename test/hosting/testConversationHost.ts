/**
 * A minimal `ConversationHost` for tests — no socket, no protocol, no HTTP.
 *
 * The same job `testHost.ts` does for the request port: if one
 * `ConversationHandler` runs unchanged against ~90 lines of in-process
 * plumbing AND against a real WebSocket upgrade, nothing transport-shaped
 * leaked into the port. It also declares different ceilings from the upgrade
 * adapter, so the suite cannot accidentally depend on one adapter's numbers.
 *
 * It implements the port's promises the same way the real adapter has to —
 * the pre-subscribe buffer, the exactly-once close, the named refusal on a
 * closed `send()` — because those are the port's laws, not one transport's
 * conveniences. Where this file and the upgrade adapter agree, they agree
 * because the port says so.
 */

import { ConversationClosedError, FrameTooLargeError } from '../../src/hosting/index.js';
import type {
  ConversationClose,
  ConversationHandler,
  ConversationHost,
  ConversationLimits,
  HostCapability,
  HostConversation,
  HostHandle,
  Unsubscribe,
} from '../../src/hosting/index.js';

/** The far side of an in-process conversation — what a caller would hold. */
export interface TestFarSide {
  /** Send a frame to the handler. */
  send(frame: string): void;
  /** Frames the handler sent back. */
  frames(): readonly string[];
  /** Wait until `count` frames have arrived. */
  waitForFrames(count: number): Promise<readonly string[]>;
  /** End it from this side. */
  close(reason?: string): void;
  /** How it ended, once it has. */
  ended(): ConversationClose | undefined;
}

export interface InProcessConversationHost extends ConversationHost {
  /** Open one conversation straight into the served handler. */
  open(options?: {
    readonly sessionId?: string;
    readonly headers?: Readonly<Record<string, string>>;
  }): TestFarSide;
}

const LIMITS: ConversationLimits = {
  maxFrameBytes: 4_096,
  maxPendingBytes: 8_192,
};

export function inProcessConversationHost(): InProcessConversationHost {
  const name = 'inProcessConversationHost';
  let handler: ConversationHandler | undefined;
  let accepting = false;
  const live = new Set<{ end: (reason: string) => void }>();

  return {
    name,
    capabilities: ['conversation'] as readonly HostCapability[],
    conversationLimits: LIMITS,

    serveConversations(incoming: ConversationHandler): Promise<HostHandle> {
      handler = incoming;
      accepting = true;
      return Promise.resolve({
        async close(): Promise<void> {
          accepting = false;
          for (const conversation of [...live])
            conversation.end(`the '${name}' host is shutting down`);
          await Promise.resolve();
        },
      });
    },

    open(options = {}): TestFarSide {
      if (!accepting) throw new Error(`[hosting] the '${name}' host is closed.`);
      const outbound: string[] = [];
      const frameSubscribers = new Set<(frame: string) => void>();
      const closeSubscribers = new Set<(reason: ConversationClose) => void>();
      let pending: string[] = [];
      let pendingBytes = 0;
      let ending: ConversationClose | undefined;

      function finish(close: ConversationClose): void {
        if (ending) return;
        ending = close;
        const subscribers = [...closeSubscribers];
        closeSubscribers.clear();
        for (const cb of subscribers) cb(close);
      }

      function deliver(frame: string): void {
        if (ending) return;
        if (frameSubscribers.size === 0) {
          pendingBytes += Buffer.byteLength(frame, 'utf8');
          if (LIMITS.maxPendingBytes !== undefined && pendingBytes > LIMITS.maxPendingBytes) {
            pending = [];
            finish({
              by: 'host',
              reason:
                `${pendingBytes} bytes arrived before onFrame(...) was subscribed, past the ` +
                `declared maxPendingBytes of ${LIMITS.maxPendingBytes}`,
            });
            return;
          }
          pending.push(frame);
          return;
        }
        for (const cb of [...frameSubscribers]) {
          try {
            cb(frame);
          } catch (err) {
            // The port's law, not a transport's convenience: feeding more
            // frames to a consumer whose parser already threw is how a channel
            // keeps looking healthy while nothing on it is being read. The
            // conformance suite caught this file getting it wrong.
            finish({
              by: 'host',
              reason: `a frame subscriber threw: ${
                err instanceof Error ? err.message : String(err)
              }`,
            });
            return;
          }
        }
      }

      const port: HostConversation = {
        ...(options.sessionId !== undefined && { sessionId: options.sessionId }),
        headers: options.headers ?? {},
        send(frame: string): void {
          if (ending) throw new ConversationClosedError(name, options.sessionId);
          const bytes = Buffer.byteLength(frame, 'utf8');
          if (LIMITS.maxFrameBytes !== undefined && bytes > LIMITS.maxFrameBytes) {
            throw new FrameTooLargeError(name, bytes, LIMITS.maxFrameBytes);
          }
          outbound.push(frame);
        },
        onFrame(cb): Unsubscribe {
          frameSubscribers.add(cb);
          if (pending.length > 0) {
            const held = pending;
            pending = [];
            pendingBytes = 0;
            for (const frame of held) cb(frame);
          }
          return () => frameSubscribers.delete(cb) as unknown as void;
        },
        onClose(cb): Unsubscribe {
          if (ending) {
            cb(ending);
            return () => undefined;
          }
          closeSubscribers.add(cb);
          return () => closeSubscribers.delete(cb) as unknown as void;
        },
        close(reason?: string): void {
          finish({ by: 'host', ...(reason !== undefined && { reason }) });
        },
      };

      const entry = { end: (reason: string) => finish({ by: 'host', reason }) };
      live.add(entry);

      void (async () => {
        try {
          await handler?.(port);
        } catch (err) {
          finish({
            by: 'host',
            reason: `the conversation handler threw: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
        }
      })();

      return {
        send: (frame) => deliver(frame),
        frames: () => outbound,
        async waitForFrames(count) {
          const deadline = Date.now() + 2000;
          for (;;) {
            if (outbound.length >= count) return [...outbound];
            if (Date.now() > deadline) throw new Error(`never saw ${count} frame(s)`);
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        },
        close: (reason) => finish({ by: 'far-side', ...(reason !== undefined && { reason }) }),
        ended: () => ending,
      };
    },
  };
}
