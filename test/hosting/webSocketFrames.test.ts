/**
 * THE CODEC, AGAINST BYTES THIS REPOSITORY DID NOT AUTHOR.
 *
 * The conversation door hand-rolls its frame codec rather than taking a
 * dependency, and the reason that is defensible is this file: RFC 6455 §5.7
 * publishes exact byte sequences for the frames it defines, so the encoder can
 * be checked against bytes the specification wrote and the decoder against
 * bytes a real client would send. "Our client agrees with our server" would
 * prove nothing; this does.
 *
 * The boundary, stated so nobody reads more into it than is here: these are the
 * §5.7 vectors plus the branches that guard memory and framing. This suite is
 * **not** the Autobahn test suite, no extension or compression is implemented
 * or claimed, and the live-socket half of the verification is in the
 * conversation conformance suite next door.
 *
 * 7-pattern coverage: unit (each vector), property (round-trip at every length
 * form), security (masking required, ceilings enforced before buffering,
 * invalid UTF-8 refused), scenario (a frame split across TCP reads).
 */

import { describe, expect, it } from 'vitest';

import {
  acceptKey,
  CLOSE_CODE,
  decodeClose,
  decodeText,
  encodeClose,
  encodeFrame,
  encodeText,
  FrameProtocolError,
  FrameReader,
  handshakeResponse,
  isControlFrame,
  OPCODE,
} from '../../src/hosting/webSocketFrames.js';

/** Mask a payload the way a client must, and frame it. The CLIENT half, written
 *  independently of the server codec on purpose. */
function clientFrame(opcode: number, payload: Buffer, fin = true, mask = [0x37, 0xfa, 0x21, 0x3d]) {
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
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
  return Buffer.concat([header, Buffer.from(mask), masked]);
}

describe('webSocketFrames — the handshake, against the RFC’s worked example', () => {
  it('computes Sec-WebSocket-Accept exactly as RFC 6455 §1.3 does', () => {
    // The specification's own key and its own answer. If this line ever
    // changes, the door has stopped speaking WebSocket.
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('writes a 101 that carries the accept value, and echoes a subprotocol only when told to', () => {
    const plain = handshakeResponse('dGhlIHNhbXBsZSBub25jZQ==').toString('utf8');
    expect(plain).toContain('HTTP/1.1 101 Switching Protocols');
    expect(plain).toContain('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    expect(plain).not.toContain('Sec-WebSocket-Protocol');
    expect(plain.endsWith('\r\n\r\n')).toBe(true);

    const chosen = handshakeResponse('dGhlIHNhbXBsZSBub25jZQ==', 'bearer').toString('utf8');
    expect(chosen).toContain('Sec-WebSocket-Protocol: bearer');
  });
});

describe('webSocketFrames — the encoder, against RFC 6455 §5.7', () => {
  it('a single-frame unmasked text message is the RFC’s exact bytes', () => {
    // §5.7: 0x81 0x05 0x48 0x65 0x6c 0x6c 0x6f — "Hello".
    expect([...encodeText('Hello')]).toEqual([0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it('an unmasked ping is the RFC’s exact bytes', () => {
    // §5.7: 0x89 0x05 0x48 0x65 0x6c 0x6c 0x6f.
    expect([...encodeFrame(OPCODE.ping, Buffer.from('Hello'))]).toEqual([
      0x89, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f,
    ]);
  });

  it('a fragmented message is written as the RFC frames it', () => {
    // §5.7: 0x01 0x03 "Hel" then 0x80 0x02 "lo".
    expect([...encodeFrame(OPCODE.text, Buffer.from('Hel'), false)]).toEqual([
      0x01, 0x03, 0x48, 0x65, 0x6c,
    ]);
    expect([...encodeFrame(OPCODE.continuation, Buffer.from('lo'))]).toEqual([
      0x80, 0x02, 0x6c, 0x6f,
    ]);
  });

  it('picks the length form the RFC specifies at each boundary', () => {
    // §5.7 gives 256 bytes as 0x7E 0x0100 and 64KiB as 0x7F + eight bytes.
    const small = encodeFrame(OPCODE.text, Buffer.alloc(125));
    expect(small[1]).toBe(125);
    const medium = encodeFrame(OPCODE.text, Buffer.alloc(256));
    expect([medium[1], medium[2], medium[3]]).toEqual([0x7e, 0x01, 0x00]);
    const large = encodeFrame(OPCODE.text, Buffer.alloc(65_536));
    expect(large[1]).toBe(0x7f);
    expect([...large.subarray(2, 10)]).toEqual([0, 0, 0, 0, 0, 1, 0, 0]);
  });

  it('never sets the mask bit — a server that masks is a server the client drops', () => {
    for (const payload of [Buffer.alloc(3), Buffer.alloc(300), Buffer.alloc(70_000)]) {
      expect(encodeFrame(OPCODE.text, payload)[1] & 0x80).toBe(0);
    }
  });

  it('a close frame carries its code, and a long reason is trimmed to what a control frame holds', () => {
    const short = encodeClose(CLOSE_CODE.normal, 'done');
    expect(short[0]).toBe(0x88);
    expect(decodeClose(short.subarray(2))).toEqual({ code: 1000, reason: 'done' });

    const long = encodeClose(CLOSE_CODE.tooBig, 'x'.repeat(500));
    // 125 is the control-frame ceiling: two bytes of code, 123 of reason.
    expect(long[1]).toBe(125);
    expect(decodeClose(long.subarray(2)).reason).toHaveLength(123);
  });

  it('an empty close payload is "no status", which is legal and not an error', () => {
    expect(decodeClose(Buffer.alloc(0))).toEqual({ code: CLOSE_CODE.noStatus });
  });
});

describe('webSocketFrames — the reader, against bytes a client would really send', () => {
  it('reads the RFC’s masked "Hello" byte for byte', () => {
    // §5.7: 0x81 0x85 0x37 0xfa 0x21 0x3d 0x7f 0x9f 0x4d 0x51 0x58.
    const bytes = Buffer.from([0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58]);
    const [frame] = new FrameReader().push(bytes);
    expect(frame.fin).toBe(true);
    expect(frame.opcode).toBe(OPCODE.text);
    expect(frame.payload.toString('utf8')).toBe('Hello');
  });

  it('reads the RFC’s masked pong byte for byte', () => {
    // §5.7: 0x8a 0x85 0x37 0xfa 0x21 0x3d 0x7f 0x9f 0x4d 0x51 0x58.
    const [frame] = new FrameReader().push(
      Buffer.from([0x8a, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58]),
    );
    expect(frame.opcode).toBe(OPCODE.pong);
    expect(isControlFrame(frame.opcode)).toBe(true);
    expect(frame.payload.toString('utf8')).toBe('Hello');
  });

  it('a frame split across TCP reads is one frame, and two frames in one read are two', () => {
    const reader = new FrameReader();
    const whole = clientFrame(OPCODE.text, Buffer.from('split me'));
    // Byte by byte: the worst split a network can hand you.
    let produced: unknown[] = [];
    for (const byte of whole) produced = produced.concat(reader.push(Buffer.from([byte])));
    expect(produced).toHaveLength(1);

    const pair = Buffer.concat([
      clientFrame(OPCODE.text, Buffer.from('one')),
      clientFrame(OPCODE.text, Buffer.from('two')),
    ]);
    const frames = new FrameReader().push(pair);
    expect(frames.map((f) => f.payload.toString('utf8'))).toEqual(['one', 'two']);
  });

  it('round-trips every length form a client can use', () => {
    for (const size of [0, 1, 125, 126, 127, 1000, 65_535, 65_536, 70_000]) {
      const payload = Buffer.alloc(size, 0x61);
      const [frame] = new FrameReader().push(clientFrame(OPCODE.text, payload));
      expect(frame.payload.length).toBe(size);
      expect(frame.payload.equals(payload)).toBe(true);
    }
  });

  it('SECURITY: an unmasked client frame is refused — masking is not optional', () => {
    // The server codec's own output is unmasked, which makes it exactly the
    // shape a client must never send.
    expect(() => new FrameReader().push(encodeText('Hello'))).toThrow(FrameProtocolError);
    try {
      new FrameReader().push(encodeText('Hello'));
    } catch (err) {
      expect((err as FrameProtocolError).closeCode).toBe(CLOSE_CODE.protocolError);
      expect((err as Error).message).toMatch(/unmasked/);
    }
  });

  it('SECURITY: a reserved bit means an extension nobody negotiated, and is refused', () => {
    const frame = clientFrame(OPCODE.text, Buffer.from('x'));
    frame[0] |= 0x40; // RSV1 — what permessage-deflate would set.
    expect(() => new FrameReader().push(frame)).toThrow(/reserved bit/);
  });

  it('SECURITY: a fragmented or oversized control frame is refused', () => {
    expect(() => new FrameReader().push(clientFrame(OPCODE.ping, Buffer.alloc(126)))).toThrow(
      /control frame/,
    );
    expect(() => new FrameReader().push(clientFrame(OPCODE.ping, Buffer.from('x'), false))).toThrow(
      /control frame/,
    );
  });

  it('SECURITY: the ceiling is enforced on the ANNOUNCED length, before a payload is buffered', () => {
    const reader = new FrameReader(16);
    // A header claiming 70,000 bytes, with none of them sent: refused now, so
    // an attacker cannot make this process hold what it never received.
    const header = clientFrame(OPCODE.text, Buffer.alloc(70_000)).subarray(0, 14);
    expect(() => reader.push(header)).toThrow(/past the declared maxFrameBytes/);
    try {
      new FrameReader(16).push(header);
    } catch (err) {
      expect((err as FrameProtocolError).closeCode).toBe(CLOSE_CODE.tooBig);
    }
  });

  it('SECURITY: a length above 4 GiB is refused rather than truncated into a number', () => {
    const header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(1, 2); // high half non-zero
    header.writeUInt32BE(0, 6);
    expect(() => new FrameReader().push(header)).toThrow(/above 4 GiB/);
  });

  it('SECURITY: text that is not valid UTF-8 is refused, never silently replaced', () => {
    // A lone continuation byte. Lenient decoding would hand the consumer
    // U+FFFD and no way to know the far side never sent it.
    expect(() => decodeText(Buffer.from([0x80]))).toThrow(FrameProtocolError);
    try {
      decodeText(Buffer.from([0xc3, 0x28]));
    } catch (err) {
      expect((err as FrameProtocolError).closeCode).toBe(CLOSE_CODE.invalidPayload);
    }
    expect(decodeText(Buffer.from('héllo — ok', 'utf8'))).toBe('héllo — ok');
  });
});
