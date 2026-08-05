/**
 * Compile-level regression test — 7.25 opens a door that stays open.
 *
 * The conversation port was designed against THREE consumers at once (a
 * browser-parked tool channel, a standardized agent↔UI protocol, and
 * agent-to-agent task serving), and the way that stays true is that decisions
 * which would only make sense for ONE of them cannot be added without the
 * compiler saying so. Six things are pinned here, and most of them are pinned
 * by ABSENCE — the only way to enforce "this field must never appear".
 *
 *   1. **`HostConversation` carries no credential.** Authentication happens
 *      above the port; a bearer a transport spells its own way arrives as an
 *      ordinary header, never as a port field.
 *   2. **It carries no ceiling.** Limits are declared on the HOST, because a
 *      conversation cannot tell you a ceiling you needed before you opened it.
 *   3. **Frames are strings.** Binary is a capability nobody has minted, and
 *      widening `send` would mint it silently.
 *   4. **`ConversationClose` has no transport-specific code.** `by` is the fact
 *      every consumer can act on; a number only one transport writes is not.
 *   5. **`StandingAgentOptions` gained nothing.** The composer is deliberately
 *      not conversation-aware, and this fails the build the day a key appears
 *      that quietly makes it so.
 *   6. `ConversationHost` is a port of its own — a host that only carries
 *      conversations satisfies it without pretending to answer requests.
 */
import { describe, expect, it } from 'vitest';
import type {
  ConversationClose,
  ConversationHandler,
  ConversationHost,
  ConversationLimits,
  HostCapability,
  HostConversation,
  StandingAgentOptions,
} from '../../src/hosting/index.js';
import { ConversationClosedError, FrameTooLargeError } from '../../src/hosting/index.js';

const conversation: HostConversation = {
  sessionId: 'c-1',
  headers: { authorization: 'Bearer t' },
  send: () => undefined,
  onFrame: () => () => undefined,
  onClose: () => () => undefined,
  close: () => undefined,
};

describe('HostConversation — what it carries, and what it must never', () => {
  it('LAW 1: no credential field — a token is a header, like everywhere else', () => {
    // The bearer a browser can only send as a subprotocol arrives HERE:
    expect(conversation.headers?.authorization).toBe('Bearer t');

    // @ts-expect-error — the port never proves who is calling, and never holds it.
    const leaky: HostConversation = { ...conversation, token: 'secret' };
    void leaky;
    // @ts-expect-error — nor under any other spelling.
    const alsoLeaky: HostConversation = { ...conversation, principal: { id: 'u1' } };
    void alsoLeaky;
  });

  it('LAW 2: no ceiling on the conversation — ceilings are the HOST’s declaration', () => {
    // @ts-expect-error — you need the ceiling BEFORE you open the conversation.
    const leaky: HostConversation = { ...conversation, maxFrameBytes: 32_768 };
    void leaky;
    // @ts-expect-error — same fact, other spelling.
    const alsoLeaky: HostConversation = { ...conversation, limits: {} };
    void alsoLeaky;
  });

  it('LAW 3: frames are strings, in both directions', () => {
    conversation.send('a frame');
    // @ts-expect-error — binary is a capability nobody has evidence for yet.
    conversation.send(Buffer.from([1, 2, 3]));
    // @ts-expect-error — and the inbound side is a string too.
    conversation.onFrame((frame: Uint8Array) => void frame);
  });

  it('LAW 4: ConversationClose says WHO, not which number one transport writes', () => {
    const ends: ConversationClose[] = [
      { by: 'far-side' },
      { by: 'host', reason: 'done' },
      { by: 'transport', reason: 'the connection ended without a close frame' },
    ];
    expect(ends).toHaveLength(3);

    // @ts-expect-error — a fourth party would need designing, not spelling.
    const invented: ConversationClose = { by: 'proxy' };
    void invented;
    // @ts-expect-error — a numeric code is one transport's vocabulary; `reason` carries it.
    const numbered: ConversationClose = { by: 'far-side', code: 1006 };
    void numbered;
  });

  it('LAW 5: standingAgent gained nothing — it is not conversation-aware', () => {
    const options: Omit<StandingAgentOptions, 'agent' | 'sessions' | 'host'> = {
      durability: 'exit',
      onConcurrentInvoke: 'reject',
    };
    expect(Object.keys(options).sort()).toEqual(['durability', 'onConcurrentInvoke']);

    // Three consumers push different things down a channel, so baking one loop
    // into the composer would be consumer bias. The absence is the design.
    const biased: Omit<StandingAgentOptions, 'agent' | 'sessions' | 'host'> = {
      // @ts-expect-error — no conversation handler on the composer.
      onConversation: () => undefined,
    };
    void biased;
  });

  it('LAW 6: ConversationHost stands alone — no serve() required', () => {
    const conversationsOnly: ConversationHost = {
      name: 'someRelay',
      capabilities: ['conversation'],
      conversationLimits: { maxFrameBytes: 1024 },
      serveConversations: () => Promise.resolve({ close: () => Promise.resolve() }),
    };
    expect(conversationsOnly.capabilities).toContain('conversation');

    // The capability is a member of the union, not free-form text.
    const capability: HostCapability = 'conversation';
    expect(capability).toBe('conversation');
    // @ts-expect-error — a capability nobody implements is a promise we cannot keep.
    const imagined: HostCapability = 'binary-frames';
    void imagined;
  });

  it('the handler is a function of one conversation, and may be async', () => {
    const sync: ConversationHandler = (c) => {
      c.onFrame(() => undefined);
    };
    const async: ConversationHandler = async (c) => {
      await Promise.resolve();
      c.onFrame(() => undefined);
    };
    expect(typeof sync).toBe('function');
    expect(typeof async).toBe('function');
  });

  it('the limits are all optional, and absent means "no ceiling this adapter knows of"', () => {
    const empty: ConversationLimits = {};
    const full: ConversationLimits = { maxFrameBytes: 1, idleMs: 2, maxPendingBytes: 3 };
    expect(empty.maxFrameBytes).toBeUndefined();
    expect(full.idleMs).toBe(2);
    // @ts-expect-error — a ceiling nobody defined is not a ceiling.
    const invented: ConversationLimits = { maxMessagesPerSecond: 10 };
    void invented;
  });

  it('the two refusals are branchable by code, without matching prose', () => {
    const closed = new ConversationClosedError('nodeHost', 'c-1');
    const tooBig = new FrameTooLargeError('nodeHost', 40_000, 32_768);
    // Literal types, so a switch over them is checked by the compiler.
    const a: 'ERR_CONVERSATION_CLOSED' = closed.code;
    const b: 'ERR_FRAME_TOO_LARGE' = tooBig.code;
    expect([a, b]).toEqual(['ERR_CONVERSATION_CLOSED', 'ERR_FRAME_TOO_LARGE']);
    // The ceiling travels ON the refusal, so a consumer that has to chunk
    // learns the number from the thing that refused it.
    expect(tooBig.maxFrameBytes).toBe(32_768);
    expect(tooBig.bytes).toBe(40_000);
  });
});
