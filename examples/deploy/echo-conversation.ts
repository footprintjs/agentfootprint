/**
 * deploy/echo-conversation — a door that stays open.
 *
 * `HostRequest → HostReply` is ONE exchange: something calls, the agent
 * answers, it is over. Some callers cannot work that way. A browser cannot host
 * an inbound endpoint, so it dials out and parks a connection that the agent
 * pushes work down — and a request/reply port has no way to express that.
 *
 *   const handle = await nodeHost({ port }).serveConversations((conversation) => {
 *     conversation.onFrame((frame) => conversation.send(answer(frame)));
 *     conversation.onClose((why) => log(why.by, why.reason));
 *   });
 *
 * Six members, and they are all of it: `sessionId`, `headers`, `send`,
 * `onFrame`, `onClose`, `close`. Frames are STRINGS — what they MEAN is your
 * protocol's business, not the port's, because the three consumers this port
 * was designed against (a browser-parked tool channel, an agent↔UI protocol,
 * agent-to-agent task serving) agree on almost nothing beyond "text".
 *
 * This file demonstrates the five things that are easy to get wrong:
 *
 *   1. **One socket, two doors.** `/invoke` and the conversation door share the
 *      port, because the runtimes that need a conversation are the ones that
 *      hand a container exactly one.
 *   2. **The ceilings are declared, not discovered.** `host.conversationLimits`
 *      tells you the frame cap BEFORE you send the frame that would have been
 *      cut in half. The port never chunks for you — how a message is split and
 *      reassembled is your protocol's question.
 *   3. **A frame past the ceiling refuses BY NAME** (`FrameTooLargeError`)
 *      instead of being truncated or silently split.
 *   4. **A closed conversation refuses too** (`ConversationClosedError`) — a
 *      send that quietly goes nowhere looks exactly like one that worked.
 *   5. **`onClose` says WHO ended it**: `'far-side'`, `'host'` or
 *      `'transport'` — the difference between "they hung up" and "it broke".
 *
 * It is its own integration test: it binds an ephemeral port, holds a real
 * WebSocket conversation with itself, and shuts down. Set `SERVE=1` to keep it
 * listening on :8080 and point a browser's `new WebSocket(...)` at it.
 *
 * Run:  npm run example examples/deploy/echo-conversation.ts
 */

import { connect } from 'node:net';

import { Agent, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { memorySessions, nodeHost, standingAgent } from '../../src/doors/hosting.js';
import type { ConversationClose, HostConversation } from '../../src/doors/hosting.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/echo-conversation',
  title: 'A door that stays open — serveConversations() beside serve()',
  group: 'deploy',
  description:
    'The conversation port: a session-scoped two-way channel for callers that dial out instead of being called. One socket serves /invoke and the conversation door together; the ceilings are declared rather than hidden behind auto-chunking; a frame past the cap and a send on a closed channel each refuse by name; onClose says who ended it.',
  defaultInput: 'Tell me about the weather.',
  providerSlots: ['default'],
  tags: ['deploy', 'hosting', 'websocket', 'conversation', 'ports-and-adapters'],
};

function buildAgent(provider?: LLMProvider): Agent {
  return Agent.create({
    provider: provider ?? mock({ reply: 'It is bright and cold.' }),
    model: 'mock',
    maxIterations: 2,
  })
    .system('You are a brief assistant.')
    .build();
}

// #region conversation
/** The whole handler: one call per conversation, with that conversation. */
function answerFrames(agent: Agent, maxFrameBytes: number) {
  return async (conversation: HostConversation) => {
    // `sessionId` and `headers` are caller data, exactly as on HostRequest —
    // a claim, never identity. Authenticate above the port.
    const who = conversation.sessionId ?? 'anonymous';

    conversation.onClose((why: ConversationClose) => {
      // 'far-side' they hung up · 'host' we closed · 'transport' it broke.
      console.error(`[conversation] ${who} ended: ${why.by}${why.reason ? ` — ${why.reason}` : ''}`);
    });

    conversation.onFrame((frame) => {
      // The frame is a string. THIS is where your protocol lives — JSON, a
      // line format, whatever the far side agreed to — and the port stays out
      // of it deliberately.
      if (frame === 'bye') {
        conversation.close('the caller said bye');
        try {
          // A send down a channel that has ended refuses BY NAME. The
          // alternative — accepting it and dropping it — looks identical to a
          // send that worked, from the only side that could have noticed.
          conversation.send('one more thing');
        } catch (err) {
          const refusal = err as Error & { code?: string };
          console.error(`[conversation] after close: ${refusal.name}(${refusal.code})`);
        }
        return;
      }
      if (frame === 'oversized') {
        // The declared ceiling, met head-on. It refuses BY NAME instead of
        // truncating the frame or splitting it behind your back — how a
        // message is chunked and reassembled is your protocol's question, and
        // an adapter that answered it would answer it for every consumer.
        try {
          conversation.send('x'.repeat(maxFrameBytes + 1));
        } catch (err) {
          const refusal = err as Error & { code?: string; maxFrameBytes?: number };
          conversation.send(`${refusal.name}(${refusal.code}) cap=${refusal.maxFrameBytes}`);
        }
        return;
      }
      void agent
        .run({ message: frame })
        .then((result) =>
          conversation.send(`${who}: ${typeof result === 'string' ? result : 'paused'}`),
        )
        .catch((err: Error) => conversation.send(`error: ${err.message}`));
    });
  };
}

/** One socket, both doors: requests on /invoke, conversations on /conversation. */
async function serveBothDoors(provider: LLMProvider | undefined, port: number) {
  const host = nodeHost({ port, hostname: '127.0.0.1' });
  // Declared ceilings, read BEFORE anything is sent: chunk above the port if
  // you need to. The port never splits a frame for you.
  const limits = host.conversationLimits;

  // TWO agent instances, and this is not incidental. An `Agent` holds per-run
  // state on itself and runs one turn at a time; `standingAgent` serializes
  // the turns IT drives, and it cannot serialize turns somebody else starts.
  // Sharing one instance across both doors would let a conversation frame and
  // an HTTP request overlap on it. One agent per door, or your own lock.
  const requests = await standingAgent({
    agent: buildAgent(provider),
    sessions: memorySessions(),
    host,
  });
  const conversations = await host.serveConversations(
    answerFrames(buildAgent(provider), limits?.maxFrameBytes ?? 0),
  );
  return { host, requests, conversations, limits };
}
// #endregion conversation

// ── A WebSocket client, written out so the example needs no dependency ──
//
// A real browser writes `new WebSocket(url)`. This is the same handshake and
// the same frames, by hand, so the example runs anywhere this package does.

const MASK = [0x21, 0x09, 0x77, 0x3b];

function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  for (let i = 0; i < payload.length; i++) payload[i] ^= MASK[i & 3];
  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : (() => {
          const long = Buffer.alloc(4);
          long[0] = 0x81;
          long[1] = 0x80 | 126;
          long.writeUInt16BE(payload.length, 2);
          return long;
        })();
  return Buffer.concat([header, Buffer.from(MASK), payload]);
}

interface Chat {
  send(text: string): void;
  next(): Promise<string>;
  ended(): Promise<{ code?: number; reason?: string }>;
  destroy(): void;
}

async function openConversation(port: number, sessionId: string): Promise<Chat> {
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => undefined);
  const frames: string[] = [];
  let buffered = Buffer.alloc(0);
  let handshakeDone = false;
  let settleEnd: (value: { code?: number; reason?: string }) => void;
  const ended = new Promise<{ code?: number; reason?: string }>((resolve) => {
    settleEnd = resolve;
  });
  socket.on('close', () => settleEnd({}));

  socket.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    if (!handshakeDone) {
      const split = buffered.indexOf('\r\n\r\n');
      if (split < 0) return;
      buffered = buffered.subarray(split + 4);
      handshakeDone = true;
    }
    for (;;) {
      if (buffered.length < 2) return;
      const opcode = buffered[0] & 0x0f;
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      }
      if (buffered.length < offset + length) return;
      const payload = buffered.subarray(offset, offset + length);
      buffered = buffered.subarray(offset + length);
      if (opcode === 0x8) {
        settleEnd({
          code: payload.length >= 2 ? payload.readUInt16BE(0) : undefined,
          reason: payload.length > 2 ? payload.subarray(2).toString('utf8') : undefined,
        });
        socket.end();
        return;
      }
      if (opcode === 0x1) frames.push(payload.toString('utf8'));
    }
  });

  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  socket.write(
    `GET /conversation?sessionId=${sessionId} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
      `Connection: Upgrade\r\nUpgrade: websocket\r\n` +
      `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  for (let waited = 0; waited < 2000 && !handshakeDone; waited += 10) {
    await new Promise((r) => setTimeout(r, 10));
  }

  return {
    send: (text) => socket.write(maskedTextFrame(text)),
    async next(): Promise<string> {
      for (let waited = 0; waited < 5000; waited += 10) {
        const frame = frames.shift();
        if (frame !== undefined) return frame;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('no frame arrived');
    },
    ended: () => ended,
    destroy: () => socket.destroy(),
  };
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const { host, requests, conversations, limits } = await serveBothDoors(provider, 0);
  const port = (requests as { port: number }).port;

  try {
    // 1. The conversation door: two turns over one open channel.
    const chat = await openConversation(port, 'c-1');
    chat.send(input);
    const first = await chat.next();
    chat.send('And tomorrow?');
    const second = await chat.next();

    // 2. The SAME socket still answers ordinary requests.
    const overHttp = await fetch(`http://127.0.0.1:${port}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input, sessionId: 'c-1' }),
    });
    const { output } = (await overHttp.json()) as { output?: string };

    // 3. A frame past the declared ceiling refuses BY NAME on the sending
    //    side — never truncated, never silently split.
    chat.send('oversized');
    const refusal = await chat.next();

    // 4. Serving a second conversation handler on one host is refused too:
    //    two handlers would make which one receives a conversation depend on
    //    registration order.
    const twice = await host
      .serveConversations(() => undefined)
      .then(() => 'accepted (wrong)')
      .catch((err: Error) => err.message.split('.')[0]);

    // 5. Either side can end it, and onClose says which.
    chat.send('bye');
    const how = await chat.ended();

    return {
      declaredLimits: limits,
      overTheConversation: [first, second],
      sameSocketOverHttp: output,
      ceilingRefusesByName: refusal,
      oneDoorOneHandler: twice,
      endedWith: { code: how.code, reason: how.reason },
    };
  } finally {
    await conversations.close();
    await requests.close();
  }
}

if (isCliEntry(import.meta.url)) {
  if (process.env.SERVE === '1') {
    void (async () => {
      const { requests } = await serveBothDoors(undefined, 8080);
      console.error(`listening on ${(requests as { url: string }).url}`);
      console.error('try:  new WebSocket("ws://127.0.0.1:8080/conversation?sessionId=c-1")');
    })();
  } else {
    void run(meta.defaultInput!).then(printResult);
  }
}
