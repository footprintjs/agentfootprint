/**
 * hosting/webSocketConversation — one upgraded socket, presented as a
 * {@link HostConversation}.
 *
 * This is the whole adapter side of the conversation port: it takes the
 * `'upgrade'` event a `node:http` server hands it, answers the handshake, and
 * turns the frames flowing over the socket into the six-member port a handler
 * sees. Everything protocol-shaped lives in `webSocketFrames.ts`; everything
 * port-shaped lives in `types.ts`; this file is the join.
 *
 * ── The laws it keeps, all of them pinned by tests ───────────────────────────
 *  - **A path this door does not own is not touched.** `node:http` calls EVERY
 *    `'upgrade'` listener for every upgrade, exactly as it calls every
 *    `'request'` listener — so a caller's own protocol lives beside this one on
 *    the same socket. Whether an unclaimed path gets an answer is the caller's
 *    business on a server they own, and this door's only on a server it owns.
 *  - **Frames that arrive before the handler subscribes are held, up to a
 *    declared bound.** An `async` handler that awaits before calling `onFrame`
 *    would otherwise lose the far side's opening frame. The bound is in BYTES
 *    and overflow ends the conversation with a stated reason, because an
 *    unbounded queue somebody else fills is a way to kill this process, and an
 *    undeclared ceiling is the exact thing the declared-ceilings rule exists to
 *    forbid.
 *  - **`close()` ends every live conversation before the socket is released.**
 *    Measured, not assumed: an upgraded socket keeps `server.close()` waiting
 *    forever, so a door that let go of its conversations would hang the whole
 *    shutdown.
 *  - **The port's frame is the whole message.** A message the transport
 *    delivered in fragments counts against `maxFrameBytes` in total, so
 *    fragmentation cannot be used to walk around the ceiling.
 *  - **Nothing in a conversation's lifecycle is ever the PROCESS's failure.**
 *    Node calls a socket's listeners from its own stack, so a throw inside one
 *    is uncaught and ends the container. Every listener body here that computes
 *    is wrapped: a surprise costs THIS conversation, with a reason, and the
 *    door keeps carrying everybody else's.
 *
 * Pattern: Adapter. Role: outer ring, one transport.
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { ConversationClosedError, FrameTooLargeError } from './errors.js';
import { lowerCasedHeaders } from './headers.js';
import type {
  ConversationClose,
  ConversationHandler,
  ConversationLimits,
  HostConversation,
  Unsubscribe,
} from './types.js';
import {
  CLOSE_CODE,
  decodeClose,
  decodeText,
  encodeClose,
  encodeFrame,
  encodeText,
  FrameProtocolError,
  FrameReader,
  isControlFrame,
  OPCODE,
  handshakeResponse,
} from './webSocketFrames.js';

/**
 * What a wire read out of one handshake — the conversation half of a
 * deployment's dialect.
 *
 * There is no body to read here, which is the whole difference from a request:
 * a handshake is a URL and some headers, so a dialect that wants a session id
 * or a credential has to find it in those.
 */
export interface ConversationHandshake {
  /** The session this conversation claims. Caller data; never identity. */
  readonly sessionId?: string;
  /**
   * Headers to merge OVER the raw lower-cased ones the transport delivered.
   *
   * This is how an adapter maps its own spelling into the port's vocabulary —
   * a credential a browser could only send as a subprotocol becomes an ordinary
   * `authorization` header here. The raw headers are never removed, so nothing
   * a mapping did not understand is lost.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * The subprotocol to echo in the 101, when this dialect selects one.
   *
   * Selecting is the wire's job because only the wire read the offer. Echoing
   * something the client did not offer makes the client fail the connection.
   */
  readonly protocol?: string;
}

/** How long a politely-closed socket has to say goodbye before it is dropped. */
const CLOSE_GRACE_MS = 1_000;

/** Everything the door needs to answer one upgrade. */
export interface ConversationDoorOptions {
  /** The adapter's name — every refusal carries it. */
  readonly hostName: string;
  /** The path this door owns. Anything else is not ours. */
  readonly path: string;
  /** The ceilings this door declares, already defaulted. */
  readonly limits: ConversationLimits;
  /** This deployment's handshake dialect. Absent ⇒ raw headers and no session. */
  readonly readConversation?: (facts: HandshakeFacts) => ConversationHandshake;
  /** Where a new conversation goes. */
  readonly handler: ConversationHandler;
  /** Whether the host is still taking conversations — false after `close()`. */
  readonly accepting: () => boolean;
}

/** What a handshake dialect may read. Deliberately the same shape a request wire gets, minus the body. */
export interface HandshakeFacts {
  /** Header names lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  /** The query string, already parsed — where a browser has to put things it cannot header. */
  readonly query: URLSearchParams;
}

/** A door: hand it upgrades, close it when you are done. */
export interface ConversationDoor {
  /**
   * Take one upgrade, or decline it. Returns whether this door claimed the
   * path — the caller decides what an unclaimed upgrade deserves.
   */
  handleUpgrade(request: IncomingMessage, socket: Duplex): boolean;
  /** End every live conversation politely, then resolve. */
  closeAll(reason: string): Promise<void>;
  /** How many conversations are open right now. */
  readonly liveCount: number;
}

/** One live conversation, plus the levers the door needs on it. */
interface LiveConversation {
  readonly port: HostConversation;
  readonly ended: Promise<void>;
  end(reason: string): void;
}

export function conversationDoor(options: ConversationDoorOptions): ConversationDoor {
  const live = new Set<LiveConversation>();

  return {
    get liveCount(): number {
      return live.size;
    },

    handleUpgrade(request: IncomingMessage, socket: Duplex): boolean {
      const url = request.url ?? '';
      if (url.split('?')[0] !== options.path) return false;

      // From here the upgrade is ours, and every exit answers it.
      socket.on('error', () => undefined);

      if (!options.accepting()) {
        refuse(
          socket,
          503,
          `the '${options.hostName}' host is closed and is not taking new conversations`,
        );
        return true;
      }

      const headers = lowerCasedHeaders(request.headers);
      const key = headers['sec-websocket-key'];
      const upgrade = (headers.upgrade ?? '').toLowerCase();
      if (upgrade !== 'websocket' || headers['sec-websocket-version'] !== '13' || !key) {
        refuse(
          socket,
          400,
          `the '${options.hostName}' host serves version-13 WebSocket conversations on ` +
            `${options.path}, and this upgrade did not offer one`,
        );
        return true;
      }

      const facts: HandshakeFacts = {
        headers,
        query: new URLSearchParams(url.split('?')[1] ?? ''),
      };
      // A dialect is somebody else's code, and it runs on node's own stack: a
      // throw here is UNCAUGHT and would end the process — every other
      // conversation on this door and every request beside them — for one
      // handshake it could not read. Nothing in a request's lifecycle may ever
      // be the process's failure, and a handshake is the start of one.
      let read: ConversationHandshake;
      try {
        read = options.readConversation?.(facts) ?? {};
      } catch (err) {
        refuse(
          socket,
          500,
          `the '${options.hostName}' host could not read this handshake: ${asMessage(err)}`,
        );
        return true;
      }
      socket.write(handshakeResponse(key, read.protocol));

      const conversation = openConversation(socket, {
        hostName: options.hostName,
        limits: options.limits,
        ...(read.sessionId !== undefined && { sessionId: read.sessionId }),
        headers: { ...headers, ...read.headers },
      });
      live.add(conversation);
      void conversation.ended.finally(() => live.delete(conversation));

      // A handler that throws ends THAT conversation and nothing else: one
      // caller's bad frame is not an outage for everyone else on this door.
      void (async () => {
        try {
          await options.handler(conversation.port);
        } catch (err) {
          conversation.end(`the conversation handler threw: ${asMessage(err)}`);
        }
      })();
      return true;
    },

    async closeAll(reason: string): Promise<void> {
      const ending = [...live];
      for (const conversation of ending) conversation.end(reason);
      // Waited on, not fired and forgotten: an upgraded socket that is still
      // open keeps `server.close()` waiting forever, so "the door is closed"
      // has to mean the sockets are actually gone.
      await Promise.allSettled(ending.map((conversation) => conversation.ended));
    },
  };
}

/** The three statuses this door answers a pre-101 socket with. */
const REFUSAL_REASON: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** Answer an upgrade we will not carry, in the one language a pre-101 socket speaks. */
function refuse(socket: Duplex, status: number, message: string): void {
  const text = `[hosting] ${message}.`;
  const reason = REFUSAL_REASON[status] ?? 'Bad Request';
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      `content-type: text/plain\r\n` +
      `content-length: ${Buffer.byteLength(text)}\r\n` +
      `connection: close\r\n\r\n${text}`,
  );
}

interface OpenOptions {
  readonly hostName: string;
  readonly limits: ConversationLimits;
  readonly sessionId?: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * One socket, presented as a conversation.
 *
 * Written as a closure rather than a class because everything here is one
 * socket's state and none of it is anybody else's business — there is nothing
 * to subclass and nothing to inject.
 */
function openConversation(socket: Duplex, options: OpenOptions): LiveConversation {
  const { hostName, limits, sessionId } = options;
  const maxFrameBytes = limits.maxFrameBytes;
  const maxPendingBytes = limits.maxPendingBytes;

  const reader = new FrameReader(maxFrameBytes);
  const frameSubscribers = new Set<(frame: string) => void>();
  const closeSubscribers = new Set<(reason: ConversationClose) => void>();

  /** Frames the far side sent before anybody was listening. Bounded (see below). */
  let pending: string[] = [];
  let pendingBytes = 0;

  /** The message being assembled out of fragments, if any. */
  let assembling: Buffer[] = [];
  let assemblingBytes = 0;
  let assemblingText = false;

  let ending: ConversationClose | undefined;
  let resolveEnded: () => void;
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });

  function finish(close: ConversationClose, wireCode?: number, wireReason?: string): void {
    if (ending !== undefined) return;
    ending = close;
    // Saying goodbye is the part that touches the transport, so it is the part
    // that can fail — and a failure to say goodbye must not stop the handler
    // being TOLD, or leave `ended` unresolved and every shutdown sharing this
    // socket waiting on it.
    try {
      if (wireCode !== undefined && socket.writable) {
        socket.write(encodeClose(wireCode, wireReason ?? close.reason));
      }
      // end() flushes what is queued and then sends FIN — the polite half of
      // the close. The timer is the impolite half, for a peer that never
      // answers.
      socket.end();
      const grace = setTimeout(() => socket.destroy(), CLOSE_GRACE_MS);
      if (typeof grace.unref === 'function') grace.unref();
      socket.once('close', () => clearTimeout(grace));
    } catch {
      // The socket could not be told. It is going away either way, and the
      // conversation is over regardless of how politely.
      socket.destroy();
    }

    const subscribers = [...closeSubscribers];
    closeSubscribers.clear();
    for (const cb of subscribers) {
      try {
        cb(close);
      } catch {
        // A close subscriber that throws has nothing left to be told; the
        // conversation is already over and there is nothing to protect.
      }
    }
    resolveEnded();
  }

  function deliver(frame: string): void {
    if (ending !== undefined) return;
    if (frameSubscribers.size === 0) {
      pendingBytes += Buffer.byteLength(frame, 'utf8');
      if (maxPendingBytes !== undefined && pendingBytes > maxPendingBytes) {
        pending = [];
        finish(
          {
            by: 'host',
            reason:
              `${pendingBytes} bytes arrived before onFrame(...) was subscribed, past the ` +
              `declared maxPendingBytes of ${maxPendingBytes}`,
          },
          CLOSE_CODE.tooBig,
        );
        return;
      }
      pending.push(frame);
      return;
    }
    for (const cb of [...frameSubscribers]) {
      try {
        cb(frame);
      } catch (err) {
        // Feeding more frames to a consumer whose parser already threw is how a
        // channel keeps looking healthy while nothing on it is being read.
        finish({ by: 'host', reason: `a frame subscriber threw: ${asMessage(err)}` });
        return;
      }
    }
  }

  function handleFrame(frame: { fin: boolean; opcode: number; payload: Buffer }): void {
    if (ending !== undefined) return;
    if (isControlFrame(frame.opcode)) {
      if (frame.opcode === OPCODE.ping) {
        // Answered because the protocol says so, and because a peer's liveness
        // check is not the same thing as this port inventing a heartbeat.
        if (socket.writable) socket.write(encodeFrame(OPCODE.pong, frame.payload));
        return;
      }
      if (frame.opcode === OPCODE.pong) return;
      const said = decodeClose(frame.payload);
      finish(
        { by: 'far-side', ...(said.reason !== undefined && { reason: said.reason }) },
        said.code === CLOSE_CODE.noStatus ? CLOSE_CODE.normal : said.code,
        said.reason,
      );
      return;
    }

    if (frame.opcode === OPCODE.binary) {
      // Refused by name rather than silently stringified: this port carries
      // text, and binary is a capability nobody has shown evidence for yet.
      finish(
        {
          by: 'host',
          reason:
            'a binary frame arrived, and this port carries text frames only — binary is a ' +
            'capability that will be minted when a consumer needs it, not guessed at now',
        },
        CLOSE_CODE.unsupportedData,
      );
      return;
    }

    if (frame.opcode === OPCODE.text) {
      if (assemblingText) {
        protocolFailure(
          new FrameProtocolError(
            CLOSE_CODE.protocolError,
            'a new message started before the previous fragmented one finished',
          ),
        );
        return;
      }
      assemblingText = true;
    } else if (!assemblingText) {
      protocolFailure(
        new FrameProtocolError(
          CLOSE_CODE.protocolError,
          'a continuation frame arrived with no message to continue',
        ),
      );
      return;
    }

    assemblingBytes += frame.payload.length;
    if (maxFrameBytes !== undefined && assemblingBytes > maxFrameBytes) {
      // The ceiling is on the MESSAGE, so a peer cannot fragment its way past it.
      protocolFailure(
        new FrameProtocolError(
          CLOSE_CODE.tooBig,
          `a fragmented message reached ${assemblingBytes} bytes, past the declared ` +
            `maxFrameBytes of ${maxFrameBytes}`,
        ),
      );
      return;
    }
    assembling.push(frame.payload);
    if (!frame.fin) return;

    const whole = assembling.length === 1 ? assembling[0] : Buffer.concat(assembling);
    assembling = [];
    assemblingBytes = 0;
    assemblingText = false;
    let text: string;
    try {
      text = decodeText(whole);
    } catch (err) {
      protocolFailure(err);
      return;
    }
    deliver(text);
  }

  function protocolFailure(err: unknown): void {
    const code = err instanceof FrameProtocolError ? err.closeCode : CLOSE_CODE.protocolError;
    finish({ by: 'far-side', reason: asMessage(err) }, code, asMessage(err));
  }

  /**
   * One socket's version of the law the request door states: **nothing in a
   * conversation's lifecycle may ever be the process's failure.** An upgraded
   * socket is a plain stream and node calls its listeners from its own stack,
   * so a throw inside one is uncaught — and would end every OTHER conversation
   * on this door, plus the requests beside them, for one peer's bad frame.
   * Wrapped, it ends THIS conversation and says why.
   */
  function contained<A extends unknown[]>(body: (...args: A) => void): (...args: A) => void {
    return (...args: A): void => {
      try {
        body(...args);
      } catch (err) {
        finish(
          { by: 'host', reason: `this conversation could not be read: ${asMessage(err)}` },
          CLOSE_CODE.internalError,
        );
        socket.destroy();
      }
    };
  }

  // Chunks here are always BYTES, and that is node's guarantee rather than this
  // door's assumption: an upgraded socket refuses `setEncoding` outright
  // (`ERR_HTTP_SOCKET_ENCODING`, "not allowed per RFC7230 Section 3"), so the
  // co-listener that can turn a REQUEST body into strings cannot do it to a
  // conversation. Pinned by a test, because the reason this is safe lives in
  // node and could change there.
  socket.on(
    'data',
    contained((chunk: Buffer) => {
      if (ending !== undefined) return;
      let frames;
      try {
        frames = reader.push(chunk);
      } catch (err) {
        protocolFailure(err);
        return;
      }
      for (const frame of frames) handleFrame(frame);
    }),
  );
  socket.on(
    'error',
    contained((err: Error) => {
      finish({ by: 'transport', reason: err.message });
      socket.destroy();
    }),
  );
  // BOTH halves, and `'end'` is the one that matters. An upgraded socket is
  // half-open: when the far side vanishes, node delivers `'end'` and then waits
  // for THIS side to end too — no `'error'`, and no `'close'` until we act. A
  // door listening only for `'close'` would never fire onClose for a caller
  // that walked away, and would hold a socket open that keeps every shutdown
  // sharing this port waiting. Measured, not assumed.
  socket.on(
    'end',
    contained(() => {
      finish({ by: 'transport', reason: 'the connection ended without a close frame' });
    }),
  );
  socket.on(
    'close',
    contained(() => {
      // No close frame from either side: the connection went away rather than
      // ended, and those are different facts to whoever is watching.
      finish({ by: 'transport', reason: 'the connection closed without a close frame' });
    }),
  );

  const port: HostConversation = {
    ...(sessionId !== undefined && { sessionId }),
    headers: options.headers,
    send(frame: string): void {
      if (ending !== undefined) throw new ConversationClosedError(hostName, sessionId);
      const bytes = Buffer.byteLength(frame, 'utf8');
      if (maxFrameBytes !== undefined && bytes > maxFrameBytes) {
        throw new FrameTooLargeError(hostName, bytes, maxFrameBytes);
      }
      socket.write(encodeText(frame));
    },
    onFrame(cb: (frame: string) => void): Unsubscribe {
      frameSubscribers.add(cb);
      if (pending.length > 0) {
        const held = pending;
        pending = [];
        pendingBytes = 0;
        for (const frame of held) cb(frame);
      }
      return () => {
        frameSubscribers.delete(cb);
      };
    },
    onClose(cb: (reason: ConversationClose) => void): Unsubscribe {
      // Already over? Say so now. A subscriber that arrives late is asking the
      // same question as one that arrived early, and "never" is a wrong answer.
      if (ending !== undefined) {
        cb(ending);
        return () => undefined;
      }
      closeSubscribers.add(cb);
      return () => {
        closeSubscribers.delete(cb);
      };
    },
    close(reason?: string): void {
      finish({ by: 'host', ...(reason !== undefined && { reason }) }, CLOSE_CODE.normal, reason);
    },
  };

  return {
    port,
    ended,
    end(reason: string): void {
      finish({ by: 'host', reason }, CLOSE_CODE.goingAway, reason);
    },
  };
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
