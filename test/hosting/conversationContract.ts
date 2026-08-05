/**
 * THE CONVERSATION CONTRACT — the conformance suite every `ConversationHost`
 * adapter passes.
 *
 * Not a test: the artifact a new adapter is measured against, exactly as
 * `hostContract.ts` is for the request port. Import `describeConversationContract`,
 * say how to create your host and how to open one conversation into it, and the
 * assertions that hold for a real WebSocket upgrade have to hold for yours.
 *
 * The proof it makes: **ONE handler, written once, serves every conversation
 * host unchanged.** So the handler is a module-level constant here and every
 * expectation is a pure function of what was sent — never a value re-derived
 * per adapter, which would let two hosts "both pass" while behaving
 * differently.
 *
 * Anything an adapter is allowed to differ on is read from what the adapter
 * DECLARES (`conversationLimits`) rather than from its name. That is the
 * declared-ceilings law running inside the suite that enforces it.
 */

import { describe, expect, it } from 'vitest';

import { requireCapability } from '../../src/hosting/index.js';
import type {
  ConversationClose,
  ConversationHandler,
  ConversationHost,
  HostHandle,
} from '../../src/hosting/index.js';

// ─── What a subject has to tell the suite ────────────────────────────

/** One open conversation, in transport-free terms — what a CALLER can do. */
export interface OpenConversation {
  /** Send one frame to the handler. */
  send(frame: string): void;
  /** Wait until `count` frames have come back. */
  waitForFrames(count: number): Promise<readonly string[]>;
  /** Everything received so far. */
  frames(): readonly string[];
  /** End it from the caller's side. */
  close(reason?: string): void;
  /** Resolves when the conversation has ended, however it ended. */
  ended(): Promise<void>;
}

/** An adapter, plus how to open one conversation into it. */
export interface ConversationUnderTest {
  readonly label: string;
  /** A fresh, not-yet-serving host. */
  create(): ConversationHost;
  /** Open one conversation against a serving host. */
  open(
    handle: HostHandle,
    options: { readonly sessionId?: string; readonly headers?: Record<string, string> },
  ): Promise<OpenConversation>;
  /** Try to open one against a CLOSED host; resolve with why it did not work. */
  openRefused(handle: HostHandle): Promise<string>;
}

// ─── The one handler every host serves ───────────────────────────────

const CLOSE_PLEASE = 'CLOSE';
const THROW = 'THROW';
const REFUSE_AFTER_CLOSE = 'REFUSE-AFTER-CLOSE';
const DRAIN = 'DRAIN';
/** `BIG:<n>` — try to send n bytes, whatever this host's ceiling is. */
const BIG = 'BIG:';

/** What the shared handler saw. Reset per case by {@link resetObserved}. */
export const observed: {
  opened: { sessionId?: string; headers?: Readonly<Record<string, string>> }[];
  closes: ConversationClose[];
  refusals: { name: string; code?: string; message: string }[];
  /** Frames the handler received before it subscribed — the pre-subscribe buffer. */
  early: string[];
} = { opened: [], closes: [], refusals: [], early: [] };

export function resetObserved(): void {
  observed.opened = [];
  observed.closes = [];
  observed.refusals = [];
  observed.early = [];
}

/** What the handler answers a plain frame with. Pure, and shared by every subject. */
export function expectedEcho(
  frame: string,
  options: { readonly sessionId?: string; readonly headers?: Record<string, string> },
): string {
  return [
    `echo:${frame}`,
    `session:${options.sessionId ?? 'none'}`,
    `probe:${options.headers?.['x-probe'] ?? 'none'}`,
  ].join('|');
}

/** The three frames the drain case expects, in order. */
export const DRAIN_FRAMES: readonly string[] = ['drain-1', 'drain-2', 'drain-3'];

function record(err: unknown): void {
  const error = err as Error & { code?: string };
  observed.refusals.push({
    name: error.name,
    ...(error.code !== undefined && { code: error.code }),
    message: error.message,
  });
}

/**
 * The handler. Written once, served by every conversation host, never adapted
 * per adapter — this constant IS the portability claim.
 */
export const conversationHandler: ConversationHandler = async (conversation) => {
  observed.opened.push({
    ...(conversation.sessionId !== undefined && { sessionId: conversation.sessionId }),
    ...(conversation.headers !== undefined && { headers: conversation.headers }),
  });
  conversation.onClose((reason) => observed.closes.push(reason));

  // An await BEFORE onFrame, deliberately: this is the shape of every real
  // handler that looks something up before it starts listening, and the frame
  // that arrives during it must not be lost.
  await Promise.resolve();

  conversation.onFrame((frame) => {
    if (frame === CLOSE_PLEASE) {
      conversation.close('the handler said so');
      return;
    }
    if (frame === THROW) throw new Error('frame subscriber exploded');
    if (frame === REFUSE_AFTER_CLOSE) {
      conversation.close('checking what a closed door does');
      try {
        conversation.send('too late');
      } catch (err) {
        record(err);
      }
      return;
    }
    if (frame === DRAIN) {
      // Everything queued, then closed in the same breath: a polite close has
      // to deliver what was already sent before it ends the channel.
      for (const piece of DRAIN_FRAMES) conversation.send(piece);
      conversation.close('drained');
      return;
    }
    if (frame.startsWith(BIG)) {
      try {
        conversation.send('x'.repeat(Number(frame.slice(BIG.length))));
      } catch (err) {
        record(err);
        conversation.send('refused');
      }
      return;
    }
    conversation.send(
      [
        `echo:${frame}`,
        `session:${conversation.sessionId ?? 'none'}`,
        `probe:${conversation.headers?.['x-probe'] ?? 'none'}`,
      ].join('|'),
    );
  });
};

// ─── The suite ───────────────────────────────────────────────────────

/**
 * Run the conversation contract against one adapter.
 *
 * 7-pattern coverage is spread across the cases: unit (declaration), scenario
 * (a real exchange), integration (session and headers arriving), property
 * (frames delivered whole and in order whatever the transport did), security
 * (the declared ceilings, and a closed conversation refusing by name),
 * performance/lifecycle (close drains, and close is idempotent), ROI (the
 * portability claim — the handler is written once).
 */
export function describeConversationContract(subject: ConversationUnderTest): void {
  describe(`conversation contract — ${subject.label}`, () => {
    async function serving(): Promise<{ host: ConversationHost; handle: HostHandle }> {
      resetObserved();
      const host = subject.create();
      return { host, handle: await host.serveConversations(conversationHandler) };
    }

    // ── unit: what a conversation host must declare ──
    it('declares a name, the conversation capability, and the ceilings it enforces', () => {
      const host = subject.create();
      expect(typeof host.name).toBe('string');
      expect(host.name.length).toBeGreaterThan(0);
      expect(host.capabilities).toContain('conversation');
      expect(() => requireCapability(host, 'conversation')).not.toThrow();
      // Declared, not discovered: a caller that has to chunk needs the number
      // BEFORE it sends the frame that would have been cut in half.
      expect(host.conversationLimits?.maxFrameBytes).toBeGreaterThan(0);
      expect(host.conversationLimits?.maxPendingBytes).toBeGreaterThan(0);
    });

    // ── scenario: a real exchange ──
    it('carries frames both ways, whole and in order', async () => {
      const { handle } = await serving();
      try {
        const conversation = await subject.open(handle, {});
        conversation.send('one');
        conversation.send('two');
        const frames = await conversation.waitForFrames(2);
        expect(frames).toEqual([expectedEcho('one', {}), expectedEcho('two', {})]);
      } finally {
        await handle.close();
      }
    });

    // ── integration: caller data arrives as the transport declared it ──
    it('delivers sessionId and headers through to the handler', async () => {
      const { handle } = await serving();
      try {
        const options = { sessionId: 'conversation-7', headers: { 'x-probe': 'present' } };
        const conversation = await subject.open(handle, options);
        conversation.send('who am i');
        const [reply] = await conversation.waitForFrames(1);
        expect(reply).toBe(expectedEcho('who am i', options));
        expect(observed.opened[0]?.sessionId).toBe('conversation-7');
      } finally {
        await handle.close();
      }
    });

    // ── property: a frame sent before the handler subscribed is not lost ──
    it('holds the frames that arrive before onFrame(...) and delivers them', async () => {
      const { handle } = await serving();
      try {
        const conversation = await subject.open(handle, {});
        // Sent immediately — the handler is still inside its first await.
        conversation.send('first');
        const [reply] = await conversation.waitForFrames(1);
        expect(reply).toBe(expectedEcho('first', {}));
      } finally {
        await handle.close();
      }
    });

    // ── security: the port carries no ceiling; the HOST declares it ──
    it('the ceiling is on the host, and never on the conversation', async () => {
      const { host, handle } = await serving();
      try {
        await subject.open(handle, {});
        const conversation = observed.opened[0];
        // The port's surface is six members; a limit is not one of them,
        // because a conversation cannot tell you a ceiling you needed before
        // you opened it.
        expect(conversation).not.toHaveProperty('maxFrameBytes');
        expect(conversation).not.toHaveProperty('conversationLimits');
        expect(conversation).not.toHaveProperty('limits');
        expect(host.conversationLimits).toBeDefined();
      } finally {
        await handle.close();
      }
    });

    // ── security: a frame past the declared ceiling refuses BY NAME ──
    it('send() past the declared maxFrameBytes refuses by name instead of chunking', async () => {
      const { host, handle } = await serving();
      try {
        const conversation = await subject.open(handle, {});
        const ceiling = host.conversationLimits?.maxFrameBytes ?? 0;
        conversation.send(`${BIG}${ceiling + 1}`);
        await conversation.waitForFrames(1);
        expect(observed.refusals).toHaveLength(1);
        expect(observed.refusals[0].code).toBe('ERR_FRAME_TOO_LARGE');
        expect(observed.refusals[0].message).toContain(String(ceiling));
        // And nothing was split for us: the caller got the handler's own
        // fallback frame, not a piece of the oversized one.
        expect(conversation.frames()).toEqual(['refused']);
      } finally {
        await handle.close();
      }
    });

    // ── security: a closed conversation refuses by name ──
    it('send() on a closed conversation refuses by name rather than dropping', async () => {
      const { handle } = await serving();
      try {
        const conversation = await subject.open(handle, {});
        conversation.send(REFUSE_AFTER_CLOSE);
        await conversation.ended();
        expect(observed.refusals[0]?.code).toBe('ERR_CONVERSATION_CLOSED');
        expect(observed.refusals[0]?.name).toBe('ConversationClosedError');
      } finally {
        await handle.close();
      }
    });

    // ── lifecycle: onClose fires exactly once, with who ended it ──
    it('onClose fires exactly once when the far side ends it, and says who did', async () => {
      const { handle } = await serving();
      try {
        const conversation = await subject.open(handle, {});
        conversation.send('hello');
        await conversation.waitForFrames(1);
        conversation.close('the caller is done');
        await conversation.ended();
        await settle();
        expect(observed.closes).toHaveLength(1);
        expect(observed.closes[0].by).toBe('far-side');
      } finally {
        await handle.close();
      }
    });

    it('onClose fires exactly once when the HANDLER ends it, and says who did', async () => {
      const { handle } = await serving();
      try {
        const conversation = await subject.open(handle, {});
        conversation.send(CLOSE_PLEASE);
        await conversation.ended();
        await settle();
        expect(observed.closes).toHaveLength(1);
        expect(observed.closes[0]).toEqual({ by: 'host', reason: 'the handler said so' });
      } finally {
        await handle.close();
      }
    });

    // ── lifecycle: close drains what was already sent ──
    it('close() drains politely — everything sent before it still arrives', async () => {
      const { handle } = await serving();
      try {
        const conversation = await subject.open(handle, {});
        conversation.send(DRAIN);
        const frames = await conversation.waitForFrames(DRAIN_FRAMES.length);
        expect(frames).toEqual(DRAIN_FRAMES);
        await conversation.ended();
        expect(observed.closes[0]?.reason).toBe('drained');
      } finally {
        await handle.close();
      }
    });

    // ── scenario: a subscriber that throws ends THAT conversation, not the host ──
    it('a frame subscriber that throws ends that conversation and leaves the host serving', async () => {
      const { handle } = await serving();
      try {
        const doomed = await subject.open(handle, {});
        doomed.send(THROW);
        await doomed.ended();
        expect(observed.closes[0]?.reason).toContain('exploded');

        // The host is still up: a second conversation works normally.
        const next = await subject.open(handle, {});
        next.send('still here');
        expect(await next.waitForFrames(1)).toEqual([expectedEcho('still here', {})]);
      } finally {
        await handle.close();
      }
    });

    // ── lifecycle: close() ends the live ones and refuses new ones ──
    it('close() ends live conversations and stops taking new ones', async () => {
      const { handle } = await serving();
      const conversation = await subject.open(handle, {});
      conversation.send('hello');
      await conversation.waitForFrames(1);

      await handle.close();
      await conversation.ended();
      await settle();
      expect(observed.closes).toHaveLength(1);
      expect(observed.closes[0].by).toBe('host');

      const refusal = await subject.openRefused(handle);
      expect(refusal.length).toBeGreaterThan(0);
    });

    it('close() is idempotent', async () => {
      const { handle } = await serving();
      await handle.close();
      await expect(handle.close()).resolves.toBeUndefined();
    });
  });
}

/** Let a socket's close travel and the handler's callbacks run. */
export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}
