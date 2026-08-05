/**
 * hosting/webSocketFrames — the frame codec the conversation door speaks, and
 * nothing else.
 *
 * Pure bytes in, pure bytes out: no socket, no session, no handler, no port
 * vocabulary. That is what makes it testable the only way protocol code is
 * worth testing — against the byte sequences the specification itself
 * publishes, rather than against a client we also wrote.
 *
 * ── Why this file exists instead of a dependency ─────────────────────────────
 * The alternative was an optional peer dependency carrying a complete
 * implementation. It was rejected for a reason that is about honesty rather
 * than about lines of code: `capabilities` is declared at CONSTRUCTION and is
 * static thereafter, so a host whose conversation door only works when an
 * optional package happens to be installed can only either claim
 * `'conversation'` and then refuse to do it — the library declaring a promise
 * it cannot keep, which is the one thing the capability union forbids — or
 * probe `node_modules` and let feature detection depend on install state, so a
 * deployment that forgot the dependency silently gets a host that quietly does
 * not do conversations. The shipped adapter honours what it declares, always,
 * with nothing to install. That was worth these bytes.
 *
 * ── What is implemented, exactly ─────────────────────────────────────────────
 * The server half of RFC 6455 for a text channel: the handshake, text frames,
 * continuation frames, ping/pong, and close. Payloads are unmasked on the way
 * in (client frames MUST be masked) and written unmasked on the way out (server
 * frames MUST NOT be), which is the asymmetry the RFC requires.
 *
 * ── What is NOT, and how far the verification goes ───────────────────────────
 * No extensions and no compression: `permessage-deflate` is negotiated, and
 * this door never negotiates it, so the RSV bits must always be zero and a peer
 * that sets one is refused. No binary frames — the port carries text, and
 * binary is a capability nobody has minted evidence for. No client role.
 *
 * Verification is: the byte vectors published in RFC 6455 §5.7, which were
 * authored by the specification and not by this repository, plus a live
 * exchange against the platform's own WebSocket client where the runtime has
 * one, plus the conversation conformance suite over a real socket. It is **not**
 * run against the Autobahn test suite, and this file does not claim more
 * coverage than the tests beside it actually execute.
 *
 * Pattern: pure codec. Role: innermost ring — imports nothing from this package.
 */

import { createHash } from 'node:crypto';

/** The frame kinds this door speaks. Numbers, because the wire uses numbers. */
export const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

/**
 * Close codes this door produces. The RFC's own numbers, named — a bare `1009`
 * in a branch is a fact nobody can check without opening the specification.
 */
export const CLOSE_CODE = {
  /** Ordinary end: the work is done. */
  normal: 1000,
  /** The host is shutting down. */
  goingAway: 1001,
  /** The peer broke the protocol. */
  protocolError: 1002,
  /** Data this endpoint cannot accept — a binary frame, here. */
  unsupportedData: 1003,
  /** Reserved: never sent on the wire, used only as "we were not told". */
  noStatus: 1005,
  /** Text that is not valid UTF-8. */
  invalidPayload: 1007,
  /** Past a declared ceiling. */
  tooBig: 1009,
} as const;

/** One frame, as it came off the wire, already unmasked. */
export interface WebSocketFrame {
  /** Last frame of its message? */
  readonly fin: boolean;
  /** One of {@link OPCODE}. */
  readonly opcode: number;
  /** The unmasked payload. */
  readonly payload: Buffer;
}

/**
 * A peer that broke the protocol, carrying the close code the RFC names for
 * that breakage — so the caller does not have to re-derive which number means
 * what at the point it has to write one.
 */
export class FrameProtocolError extends Error {
  readonly closeCode: number;

  constructor(closeCode: number, message: string) {
    super(message);
    this.name = 'FrameProtocolError';
    this.closeCode = closeCode;
  }
}

/** The magic string RFC 6455 §1.3 appends before hashing. Not ours to change. */
const HANDSHAKE_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * The `Sec-WebSocket-Accept` value for a client's `Sec-WebSocket-Key`:
 * base64(sha1(key + GUID)). Deterministic, and pinned against the RFC's own
 * worked example.
 */
export function acceptKey(clientKey: string): string {
  return createHash('sha1')
    .update(clientKey + HANDSHAKE_GUID)
    .digest('base64');
}

/**
 * The 101 response, as bytes.
 *
 * `protocol` is echoed only when the caller selected one. Echoing a subprotocol
 * the client did not offer would make the client fail the connection, so
 * choosing one is the wire's job (it read the offer) and not this function's.
 */
export function handshakeResponse(clientKey: string, protocol?: string): Buffer {
  const lines = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(clientKey)}`,
  ];
  if (protocol !== undefined && protocol.length > 0) {
    lines.push(`Sec-WebSocket-Protocol: ${protocol}`);
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8');
}

/**
 * One frame, ready to write. **Never masked**: a server that masks its frames
 * is a server the client closes on, per RFC 6455 §5.1.
 */
export function encodeFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 0x10000) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    // Two 32-bit halves rather than a BigInt write: the high half is always
    // zero for anything this door will ever send, and saying so in bytes is
    // clearer than converting through a type nothing else here uses.
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  return Buffer.concat([header, payload]);
}

/** A text frame carrying one whole message. */
export function encodeText(text: string): Buffer {
  return encodeFrame(OPCODE.text, Buffer.from(text, 'utf8'));
}

/**
 * A close frame carrying a code and, when there is one, a reason.
 *
 * The reason is truncated to 123 bytes because a control frame's payload may
 * not exceed 125 and the code takes two of them. Truncating a REASON is safe in
 * a way truncating a message never is: it is diagnostic prose about an ending
 * that has already been decided.
 */
export function encodeClose(code: number, reason?: string): Buffer {
  const text = reason === undefined ? Buffer.alloc(0) : Buffer.from(reason, 'utf8');
  const trimmed = text.length > 123 ? text.subarray(0, 123) : text;
  const payload = Buffer.alloc(2 + trimmed.length);
  payload.writeUInt16BE(code, 0);
  trimmed.copy(payload, 2);
  return encodeFrame(OPCODE.close, payload);
}

/** What a close frame said, pulled apart. */
export interface CloseFramePayload {
  /** The peer's code, or `noStatus` when it sent none — which is legal. */
  readonly code: number;
  /** The peer's words, when it sent any. */
  readonly reason?: string;
}

/** Read a close frame's payload. An empty payload is "no status", never an error. */
export function decodeClose(payload: Buffer): CloseFramePayload {
  if (payload.length < 2) return { code: CLOSE_CODE.noStatus };
  const code = payload.readUInt16BE(0);
  const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : undefined;
  return { code, ...(reason !== undefined && reason.length > 0 && { reason }) };
}

/** Is this one of the three control opcodes? */
export function isControlFrame(opcode: number): boolean {
  return (opcode & 0x8) !== 0;
}

/**
 * Turns a stream of TCP chunks into whole frames.
 *
 * Stateful by necessity — a frame arrives in as many pieces as the network
 * feels like, and two frames arrive in one piece just as often. Every branch
 * that gives up does so by throwing a {@link FrameProtocolError} carrying the
 * code to close with, so the layer above never has to invent one.
 */
export class FrameReader {
  private buffered: Buffer = Buffer.alloc(0);
  private readonly maxFrameBytes: number | undefined;

  /**
   * @param maxFrameBytes The declared ceiling, when there is one. Checked
   * against the length in the HEADER — before the payload is buffered, so an
   * announced 4GB frame costs nothing to refuse.
   */
  constructor(maxFrameBytes?: number) {
    this.maxFrameBytes = maxFrameBytes;
  }

  /** Feed one chunk; get back every frame that completed. */
  push(chunk: Buffer): WebSocketFrame[] {
    this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);
    const frames: WebSocketFrame[] = [];
    for (;;) {
      const frame = this.readOne();
      if (frame === undefined) return frames;
      frames.push(frame);
    }
  }

  /** One frame, or `undefined` when the bytes for a whole one are not here yet. */
  private readOne(): WebSocketFrame | undefined {
    const buffer = this.buffered;
    if (buffer.length < 2) return undefined;

    const first = buffer[0];
    const second = buffer[1];
    const fin = (first & 0x80) !== 0;
    const reserved = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (reserved !== 0) {
      // RSV bits mean an extension, and this door negotiates none — so a peer
      // that set one is describing a frame we would have to guess at.
      throw new FrameProtocolError(
        CLOSE_CODE.protocolError,
        'a reserved bit is set, and this door negotiated no extension that would define it',
      );
    }
    if (!masked) {
      // RFC 6455 §5.1: every client frame is masked, and a server that accepts
      // an unmasked one is a server that can be fed frames by a naive proxy.
      throw new FrameProtocolError(
        CLOSE_CODE.protocolError,
        'a client frame arrived unmasked, which the protocol does not allow',
      );
    }
    if (isControlFrame(opcode) && (length > 125 || !fin)) {
      throw new FrameProtocolError(
        CLOSE_CODE.protocolError,
        'a control frame was fragmented or longer than 125 bytes',
      );
    }

    if (length === 126) {
      if (buffer.length < offset + 2) return undefined;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.length < offset + 8) return undefined;
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      if (high !== 0) {
        throw new FrameProtocolError(
          CLOSE_CODE.tooBig,
          'a frame announced a length above 4 GiB, which no ceiling here permits',
        );
      }
      length = low;
      offset += 8;
    }

    if (this.maxFrameBytes !== undefined && length > this.maxFrameBytes) {
      // Refused on the ANNOUNCED length, before a byte of payload is kept: a
      // ceiling that only notices after buffering is not a ceiling.
      throw new FrameProtocolError(
        CLOSE_CODE.tooBig,
        `a frame announced ${length} bytes, past the declared maxFrameBytes of ${this.maxFrameBytes}`,
      );
    }

    const maskOffset = offset;
    offset += 4;
    if (buffer.length < offset + length) return undefined;

    const payload = Buffer.allocUnsafe(length);
    buffer.copy(payload, 0, offset, offset + length);
    for (let i = 0; i < length; i++) payload[i] ^= buffer[maskOffset + (i & 3)];

    this.buffered = buffer.subarray(offset + length);
    return { fin, opcode, payload };
  }
}

/**
 * Decode a whole message's bytes as UTF-8, refusing anything that is not.
 *
 * Strict on purpose (RFC 6455 §8.1): a text frame that is not valid UTF-8 is a
 * protocol violation, and the lenient alternative silently replaces the bad
 * bytes with `U+FFFD` — handing the consumer a string the far side never sent
 * and no way to know it happened.
 */
export function decodeText(payload: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    throw new FrameProtocolError(
      CLOSE_CODE.invalidPayload,
      'a text frame carried bytes that are not valid UTF-8',
    );
  }
}
