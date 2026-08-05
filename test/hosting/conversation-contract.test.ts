/**
 * The portability proof for the conversation port: one handler, three hosts.
 *
 * `nodeHost` takes a real WebSocket upgrade on a real socket, driven by a raw
 * TCP client written from the other side of the protocol. The second subject is
 * in-process plumbing with no socket and different declared ceilings, so
 * nothing WebSocket-shaped can hide in the port. The third is
 * `agentCoreRuntimeHost` — a cloud runtime's second door (`/ws`, its own
 * ceilings, its own session affinity) — and every assertion below holds for it
 * unchanged, over plain WebSocket with no SDK anywhere near it. **That is real
 * verification, in the same sense 7.15 used the phrase**, not a mapping
 * asserted in prose.
 *
 * A final pair of cases invokes all three with the same frames and compares the
 * answers directly: if a future adapter changes one, this file goes red.
 */

import { describe, expect, it } from 'vitest';

import { nodeHost } from '../../src/hosting/index.js';
import type { HostHandle } from '../../src/hosting/index.js';
import type { HttpHostHandle } from '../../src/hosting/httpHost.js';
import { agentCoreRuntimeHost } from '../../src/hosting-providers.js';
import {
  conversationHandler,
  describeConversationContract,
  expectedEcho,
  resetObserved,
  type ConversationUnderTest,
  type OpenConversation,
} from './conversationContract.js';
import {
  inProcessConversationHost,
  type InProcessConversationHost,
} from './testConversationHost.js';
import { connectConversation } from './wsClient.js';

// ─── Subject 1: the shipped node:http upgrade adapter ────────────────

const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

/** One upgrade-adapter subject, parameterised by the adapter's own dialect. */
function upgradeSubject(options: {
  label: string;
  create: () => ReturnType<typeof nodeHost>;
  path: string;
  /** How this dialect carries a session id on a handshake. */
  session: (id: string) => { headers?: Record<string, string>; query?: string };
}): ConversationUnderTest {
  return {
    label: options.label,
    create: options.create,
    async open(handle, opened): Promise<OpenConversation> {
      const { port } = handle as HttpHostHandle;
      const affinity = opened.sessionId ? options.session(opened.sessionId) : {};
      const client = connectConversation(port, {
        path: options.path + (affinity.query ?? ''),
        headers: { ...affinity.headers, ...opened.headers },
      });
      const { status } = await client.opened;
      expect(status).toBe(101);
      return {
        send: (frame) => client.send(frame),
        frames: () => client.frames(),
        waitForFrames: (count) => client.waitForFrames(count),
        close: (reason) => client.close(1000, reason ?? ''),
        ended: async () => {
          await client.closed;
        },
      };
    },
    async openRefused(handle): Promise<string> {
      const { port } = handle as HttpHostHandle;
      const client = connectConversation(port, { path: options.path });
      try {
        const { status } = await Promise.race([
          client.opened,
          client.closed.then(() => ({ status: 0 })),
        ]);
        return status === 101 ? '' : `refused with status ${status}`;
      } catch (err) {
        return `refused: ${(err as Error).message}`;
      } finally {
        client.destroy();
      }
    },
  };
}

const nodeSubject = upgradeSubject({
  label: 'nodeHost (node:http upgrade)',
  create: () => nodeHost({ port: 0, hostname: '127.0.0.1' }),
  path: '/conversation',
  session: (id) => ({ headers: { 'x-session-id': id } }),
});

// ─── Subject 3: a cloud runtime's second door ────────────────────────
//
// Different path (`/ws`), different ceilings (32KB frames, a 15-minute idle it
// reports but does not impose), and a session id a BROWSER has to put in the
// query string because the WebSocket API cannot set a header. Same handler,
// same suite, same answers.

const agentCoreSubject = upgradeSubject({
  label: 'agentCoreRuntimeHost (/ws, container contract)',
  create: () => agentCoreRuntimeHost({ port: 0, hostname: '127.0.0.1' }),
  path: '/ws',
  session: (id) => ({ headers: { [SESSION_HEADER]: id } }),
});

// ─── Subject 2: no socket at all ─────────────────────────────────────

let latest: InProcessConversationHost | undefined;
const inProcessSubject: ConversationUnderTest = {
  label: 'in-process conversation host (no socket)',
  create: () => {
    latest = inProcessConversationHost();
    return latest;
  },
  async open(_handle, opened): Promise<OpenConversation> {
    const far = latest!.open(opened);
    return {
      send: (frame) => far.send(frame),
      frames: () => far.frames(),
      waitForFrames: (count) => far.waitForFrames(count),
      close: (reason) => far.close(reason),
      ended: async () => {
        const deadline = Date.now() + 2000;
        while (far.ended() === undefined && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      },
    };
  },
  async openRefused(): Promise<string> {
    try {
      latest!.open({});
      return '';
    } catch (err) {
      return (err as Error).message;
    }
  },
};

// ─── Every host, the same contract ───────────────────────────────────

describeConversationContract(nodeSubject);
describeConversationContract(inProcessSubject);
describeConversationContract(agentCoreSubject);

// ─── And directly against each other ─────────────────────────────────

describe('one conversation handler, three hosts', () => {
  const subjects = [nodeSubject, inProcessSubject, agentCoreSubject];

  it('produces byte-identical answers on every host', async () => {
    const cases = [
      { frame: 'hello', options: {} },
      { frame: 'with a session', options: { sessionId: 's-1' } },
      { frame: 'with a header', options: { headers: { 'x-probe': 'yes' } } },
    ];
    for (const { frame, options } of cases) {
      const answers: string[] = [];
      for (const subject of subjects) {
        resetObserved();
        const host = subject.create();
        const handle: HostHandle = await host.serveConversations(conversationHandler);
        try {
          const conversation = await subject.open(handle, options);
          conversation.send(frame);
          answers.push((await conversation.waitForFrames(1))[0]);
        } finally {
          await handle.close();
        }
      }
      for (const answer of answers) expect(answer).toBe(expectedEcho(frame, options));
      // Pairwise too, so "all three agreed on the same wrong answer" cannot pass.
      expect(new Set(answers).size).toBe(1);
    }
  });

  it('the cloud adapter needed no port change — it differs only in path and ceilings', async () => {
    expect(nodeHost().conversationLimits).toEqual({
      maxFrameBytes: 1_048_576,
      maxPendingBytes: 1_048_576,
    });
    // Its own numbers, declared: 32KB frames and a 15-minute idle it reports
    // because the door in front of the container imposes it.
    expect(agentCoreRuntimeHost().conversationLimits).toEqual({
      maxFrameBytes: 32_768,
      idleMs: 900_000,
      maxPendingBytes: 1_048_576,
    });
    // And nothing in the port type had to learn either number.
    expect(nodeHost().capabilities).toEqual(agentCoreRuntimeHost().capabilities);
  });
});
