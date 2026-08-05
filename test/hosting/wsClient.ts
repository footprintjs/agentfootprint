/**
 * A WebSocket CLIENT for the tests, written from the other side of the
 * protocol — masked frames going out, unmasked frames coming in.
 *
 * Deliberately shares no code with `src/hosting/webSocketFrames.ts`. A test
 * client built out of the server's own codec would agree with the server about
 * any mistake they had in common, which is the one thing this file exists to
 * prevent. It speaks over a raw TCP socket for a second reason: the platform's
 * own `WebSocket` global does not exist on every Node this package supports, so
 * the conformance suite cannot be built on it. (Where it DOES exist, a separate
 * test drives the same door with it — an implementation nobody here wrote.)
 */

import { connect, type Socket } from 'node:net';

/** What the far side told us when it ended the conversation. */
export interface ClientClose {
  /** The close code, when a close frame arrived. */
  readonly code?: number;
  /** The reason, when the close frame carried one. */
  readonly reason?: string;
  /** True when the socket died without a close frame. */
  readonly abrupt: boolean;
}

export interface TestConversationClient {
  /** Resolves with the handshake's status line, whatever it was. */
  readonly opened: Promise<{ status: number; protocol?: string }>;
  /** Resolves when the conversation ends, from either side. */
  readonly closed: Promise<ClientClose>;
  /** Every text frame received so far. */
  frames(): readonly string[];
  /** Wait until `count` frames have arrived. */
  waitForFrames(count: number): Promise<readonly string[]>;
  /** Send one whole text message. */
  send(text: string): void;
  /** Send a message the transport splits — which the port must still deliver whole. */
  sendFragmented(parts: readonly string[]): void;
  /** Send arbitrary bytes: for the frames a well-behaved client would never write. */
  sendRaw(bytes: Buffer): void;
  /** Send a binary frame — the one data kind this port refuses by name. */
  sendBinary(payload: Buffer): void;
  /** Send a ping and wait for the pong. */
  ping(payload: string): Promise<string>;
  /** Close politely from the client side. */
  close(code?: number, reason?: string): void;
  /** Drop the socket without a close frame. */
  destroy(): void;
}

const MASK = [0x37, 0xfa, 0x21, 0x3d];

/** One masked client frame. */
function clientFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= MASK[i & 3];
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length]);
  } else if (payload.length < 0x10000) {
    header = Buffer.alloc(4);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }
  return Buffer.concat([header, Buffer.from(MASK), masked]);
}

export interface ConnectOptions {
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly protocols?: readonly string[];
  readonly host?: string;
}

/** Open one conversation against a listening port. */
export function connectConversation(
  port: number,
  options: ConnectOptions = {},
): TestConversationClient {
  const socket: Socket = connect(port, options.host ?? '127.0.0.1');
  const path = options.path ?? '/conversation';

  const received: string[] = [];
  const pongs: string[] = [];
  let assembling: Buffer[] = [];
  let buffered = Buffer.alloc(0);
  let handshakeDone = false;

  let settleOpen: (value: { status: number; protocol?: string }) => void;
  const opened = new Promise<{ status: number; protocol?: string }>((resolve) => {
    settleOpen = resolve;
  });
  let settleClosed: (value: ClientClose) => void;
  const closed = new Promise<ClientClose>((resolve) => {
    settleClosed = resolve;
  });
  let ending: ClientClose | undefined;

  function end(value: ClientClose): void {
    if (ending) return;
    ending = value;
    settleClosed(value);
  }

  socket.on('error', () => end({ abrupt: true }));
  socket.on('close', () => end({ abrupt: true }));

  socket.on('connect', () => {
    const lines = [
      `GET ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
    ];
    if (options.protocols?.length) {
      lines.push(`Sec-WebSocket-Protocol: ${options.protocols.join(', ')}`);
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      lines.push(`${name}: ${value}`);
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
  });

  socket.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    if (!handshakeDone) {
      const split = buffered.indexOf('\r\n\r\n');
      if (split < 0) return;
      const head = buffered.subarray(0, split).toString('utf8');
      buffered = buffered.subarray(split + 4);
      handshakeDone = true;
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0);
      const protocol = /^sec-websocket-protocol:\s*(.+)$/im.exec(head)?.[1]?.trim();
      settleOpen({ status, ...(protocol !== undefined && { protocol }) });
      if (status !== 101) {
        end({ abrupt: false, reason: head });
        return;
      }
    }
    for (;;) {
      if (buffered.length < 2) return;
      const first = buffered[0];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        length = buffered.readUInt32BE(6);
        offset = 10;
      }
      if (buffered.length < offset + length) return;
      const payload = buffered.subarray(offset, offset + length);
      buffered = buffered.subarray(offset + length);

      if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : undefined;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : undefined;
        end({
          abrupt: false,
          ...(code !== undefined && { code }),
          ...(reason !== undefined && { reason }),
        });
        socket.end();
        return;
      }
      if (opcode === 0xa) {
        pongs.push(payload.toString('utf8'));
        continue;
      }
      if (opcode === 0x9) continue;
      assembling.push(Buffer.from(payload));
      if (fin) {
        received.push(Buffer.concat(assembling).toString('utf8'));
        assembling = [];
      }
    }
  });

  async function until<T>(read: () => T | undefined, what: string): Promise<T> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const value = read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`never saw ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  return {
    opened,
    closed,
    frames: () => received,
    waitForFrames: (count) =>
      until(() => (received.length >= count ? [...received] : undefined), `${count} frame(s)`),
    send(text) {
      socket.write(clientFrame(0x1, Buffer.from(text, 'utf8')));
    },
    sendFragmented(parts) {
      parts.forEach((part, index) => {
        socket.write(
          clientFrame(
            index === 0 ? 0x1 : 0x0,
            Buffer.from(part, 'utf8'),
            index === parts.length - 1,
          ),
        );
      });
    },
    sendRaw(bytes) {
      socket.write(bytes);
    },
    sendBinary(payload) {
      socket.write(clientFrame(0x2, payload));
    },
    async ping(payload) {
      const before = pongs.length;
      socket.write(clientFrame(0x9, Buffer.from(payload, 'utf8')));
      return until(() => (pongs.length > before ? pongs[before] : undefined), 'a pong');
    },
    close(code = 1000, reason = '') {
      const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
      payload.writeUInt16BE(code, 0);
      payload.write(reason, 2, 'utf8');
      socket.write(clientFrame(0x8, payload));
    },
    destroy() {
      socket.destroy();
    },
  };
}

/** Frame a masked message with a LIE about its length — for the ceiling tests. */
export function oversizedHeader(announcedBytes: number): Buffer {
  const header = Buffer.alloc(14);
  header[0] = 0x81;
  header[1] = 0x80 | 127;
  header.writeUInt32BE(0, 2);
  header.writeUInt32BE(announcedBytes, 6);
  Buffer.from(MASK).copy(header, 10);
  return header;
}
