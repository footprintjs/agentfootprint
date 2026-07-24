/**
 * recordedChat — surface + composition with the 7.5 context-bisect loop.
 *
 * Everything $0: the chat-desk fixture (scripted mock provider + mock
 * embedder + a domain comparator), so every counterfactual is a REAL re-run.
 */
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent';
import { mock } from '../../../src/adapters/llm/MockProvider';
import { pauseHere } from '../../../src/core/pause';
import { recordedChat, type MakeChatAgent } from '../../../src/lib/recorded-chat';
import { removableSources, type RerunWithoutSourcesResult } from '../../../src/lib/context-bisect';
import { chatDeskFixture, REPLY } from './chatDeskFixture';

// Every test runs REAL agent + re-run probes ($0 mock, but multiple runs).
vi.setConfig({ testTimeout: 30000 });

const T1 = 'How is the position looking?';
const T2 = 'Should we BUY or HOLD this position?';
const T3 = 'How much should we allocate?';

function freshChat() {
  const fx = chatDeskFixture();
  return { chat: recordedChat({ makeAgent: fx.makeAgent, format: fx.format }), fx };
}

describe('recordedChat — send + the frozen ChatTurn', () => {
  it('returns a frozen turn with every field populated; turns/turn(k) agree', async () => {
    const { chat } = freshChat();
    const turn = await chat.send(T1);

    expect(turn.index).toBe(0);
    expect(turn.userMessage).toBe(T1);
    expect(turn.reply).toBe(REPLY.overviewSocial);
    expect(turn.message).toBe(`User: ${T1}`); // no preamble on the first turn
    expect(turn.transcriptBefore).toEqual([]); // opened empty
    expect(turn.artifacts.snapshot).toBeDefined();
    expect(turn.artifacts.events.length).toBeGreaterThan(0);
    expect(typeof turn.lastLlmCallId).toBe('string');
    expect(turn.identity).toBeUndefined();

    expect(Object.isFrozen(turn)).toBe(true);
    expect(Object.isFrozen(turn.transcriptBefore)).toBe(true);
    expect(Object.isFrozen(turn.artifacts.events)).toBe(true);

    expect(chat.turns).toHaveLength(1);
    expect(chat.turn(0)).toBe(turn);
    expect(chat.turns[0]).toBe(turn);
  });

  it('turn(k) out of range throws naming the valid range', async () => {
    const { chat } = freshChat();
    expect(() => chat.turn(0)).toThrow(/no turns recorded yet/);
    await chat.send(T1);
    expect(() => chat.turn(9)).toThrow(/valid range is 0\.\.0/);
    expect(() => chat.turn(-1)).toThrow(/no turn -1/);
  });

  it('threads byte-exact history into later turns (Advisor: labels intact)', async () => {
    const { chat } = freshChat();
    await chat.send(T1);
    const t2 = await chat.send(T2);
    expect(t2.transcriptBefore).toEqual([`User: ${T1}`, `Advisor: ${REPLY.overviewSocial}`]);
    expect(t2.message).toContain('Recent conversation:');
    expect(t2.message).toContain(`User: ${T1}`);
    expect(t2.message.endsWith(`User: ${T2}`)).toBe(true);
  });
});

describe('recordedChat — the example-7 story reproduces', () => {
  it('T2 → BUY, T3 → ADD (transcript carries Advisor: BUY)', async () => {
    const { chat } = freshChat();
    await chat.send(T1);
    const t2 = await chat.send(T2);
    const t3 = await chat.send(T3);
    expect(t2.reply).toBe(REPLY.buy);
    expect(t2.reply).toContain('BUY');
    expect(t3.reply).toBe(REPLY.add);
    expect(t3.reply).toContain('ADD');
  });
});

describe('recordedChat — reason() composes with the 7.5 surface', () => {
  it('reason(1) returns a real report; removableSources offers social-sentiment', async () => {
    const { chat, fx } = freshChat();
    await chat.send(T1);
    await chat.send(T2);
    const report = await chat.reason(1, { embedder: fx.embedder });
    expect(report.suspects.length).toBeGreaterThan(0);
    const ids = removableSources(report).map((s) => s.id);
    expect(ids).toContain('social-sentiment');
  });

  it('memoizes per turn; fresh: true recomputes', async () => {
    const { chat, fx } = freshChat();
    await chat.send(T1);
    await chat.send(T2);
    // The localizer embeds via embedBatch (with an embed fallback) — count both.
    const batchSpy = vi.spyOn(fx.embedder, 'embedBatch');
    const embedSpy = vi.spyOn(fx.embedder, 'embed');
    const embedCalls = (): number => batchSpy.mock.calls.length + embedSpy.mock.calls.length;

    const r1 = await chat.reason(1, { embedder: fx.embedder });
    const afterFirst = embedCalls();
    expect(afterFirst).toBeGreaterThan(0);

    const r2 = await chat.reason(1, { embedder: fx.embedder });
    expect(r2).toBe(r1); // memo — the SAME report object
    expect(embedCalls()).toBe(afterFirst); // no new embedding work

    const r3 = await chat.reason(1, { embedder: fx.embedder, fresh: true });
    expect(r3).not.toBe(r1);
    expect(embedCalls()).toBeGreaterThan(afterFirst);
  });
});

describe('recordedChat — rerunTurn() returns the af result UNMODIFIED', () => {
  it('checkBaseline: true → HOLD, flipped, verdict confirmed', async () => {
    const { chat, fx } = freshChat();
    await chat.send(T1);
    await chat.send(T2);
    const result = await chat.rerunTurn(1, {
      ignore: ['social-sentiment'],
      embedder: fx.embedder,
      answerChanged: fx.decisionChanged,
      checkBaseline: true,
    });
    expect(result.answer).toContain('HOLD');
    expect(result.whatChanged.answerFlipped).toBe(true);
    expect(result.verdict?.verdict).toBe('confirmed');
    expect(result.removed).toEqual([
      { kind: 'injection', excludeInjectionIds: ['social-sentiment'] },
    ]);
  });

  it('without checkBaseline → verdict undefined, baselineChecked false (honesty tiers pass through)', async () => {
    const { chat, fx } = freshChat();
    await chat.send(T1);
    await chat.send(T2);
    const result = await chat.rerunTurn(1, {
      ignore: ['social-sentiment'],
      embedder: fx.embedder,
      answerChanged: fx.decisionChanged,
    });
    expect(result.answer).toContain('HOLD');
    expect(result.whatChanged.answerFlipped).toBe(true);
    expect(result.verdict).toBeUndefined();
    expect(result.whatChanged.baselineChecked).toBe(false);
  });

  it('an unknown ignore id throws the rerunWithoutSources error verbatim', async () => {
    const { chat, fx } = freshChat();
    await chat.send(T1);
    await chat.send(T2);
    await expect(
      chat.rerunTurn(1, {
        ignore: ['no-such-source'],
        embedder: fx.embedder,
        answerChanged: fx.decisionChanged,
      }),
    ).rejects.toThrow(/removable ids/);
  });
});

describe('recordedChat — fork() branches, never rewrites', () => {
  it('fromRerun seeds the what-if; the fork diverges while the original is untouched', async () => {
    const { chat, fx } = freshChat();
    await chat.send(T1);
    await chat.send(T2);
    await chat.send(T3); // original T3 = ADD

    const rerun = await chat.rerunTurn(1, {
      ignore: ['social-sentiment'],
      embedder: fx.embedder,
      answerChanged: fx.decisionChanged,
      checkBaseline: true,
    });

    const fork = chat.fork(1, { fromRerun: rerun });
    expect(fork.forkedFrom?.turnIndex).toBe(1);
    expect(fork.forkedFrom?.viaRerun).toBe(true);
    expect(fork.forkedFrom?.parent).toBe(chat);
    // Seed = transcript through T1 + the HOLD what-if.
    expect(fork.seed).toEqual([
      { role: 'user', text: T1 },
      { role: 'assistant', text: REPLY.overviewSocial },
      { role: 'user', text: T2 },
      { role: 'assistant', text: REPLY.hold },
    ]);
    expect(fork.removed).toEqual([
      { kind: 'injection', excludeInjectionIds: ['social-sentiment'] },
    ]);

    const forkT3 = await fork.send(T3); // KEEP — the fork's transcript says Advisor: HOLD
    expect(forkT3.reply).toContain('KEEP');

    // Branch, never rewrite: the original is unchanged.
    expect(chat.turns).toHaveLength(3);
    expect(chat.turn(2).reply).toContain('ADD');
  });

  it('fork without fromRerun keeps the original reply and carries no new removals', async () => {
    const { chat } = freshChat();
    await chat.send(T1);
    await chat.send(T2);
    const fork = chat.fork(1);
    expect(fork.forkedFrom?.viaRerun).toBe(false);
    expect(fork.removed).toEqual([]);
    expect(fork.seed.at(-1)).toEqual({ role: 'assistant', text: REPLY.buy });
  });

  it('the fromRerun guard rejects results from a different session / turn / a literal', async () => {
    const { chat, fx } = freshChat();
    await chat.send(T1);
    await chat.send(T2);
    const rerun1 = await chat.rerunTurn(1, {
      ignore: ['social-sentiment'],
      embedder: fx.embedder,
      answerChanged: fx.decisionChanged,
    });

    // Wrong turn (produced for 1, forking 0).
    expect(() => chat.fork(0, { fromRerun: rerun1 })).toThrow(/rerunTurn for turn 0/);

    // Different session.
    const other = freshChat();
    await other.chat.send(T1);
    await other.chat.send(T2);
    expect(() => other.chat.fork(1, { fromRerun: rerun1 })).toThrow(/not produced by this session/);

    // A hand-built literal.
    const fake = {
      answer: 'x',
      answers: ['x'],
      removed: [],
    } as unknown as RerunWithoutSourcesResult;
    expect(() => chat.fork(1, { fromRerun: fake })).toThrow(/not produced by this session/);
  });

  it('fork turns are first-class — their own reason/rerunTurn/fork work', async () => {
    const { chat, fx } = freshChat();
    await chat.send(T1);
    await chat.send(T2);
    const rerun = await chat.rerunTurn(1, {
      ignore: ['social-sentiment'],
      embedder: fx.embedder,
      answerChanged: fx.decisionChanged,
    });
    const fork = chat.fork(1, { fromRerun: rerun });
    const ft = await fork.send(T3);
    expect(ft.index).toBe(0);
    const report = await fork.reason(0, { embedder: fx.embedder });
    expect(report.suspects.length).toBeGreaterThan(0);
  });
});

describe('recordedChat — one send at a time', () => {
  it('a concurrent send throws; sequential sends are fine', async () => {
    const { chat } = freshChat();
    const p1 = chat.send(T1);
    await expect(chat.send('and another')).rejects.toThrow(/already in flight/);
    await p1;
    await expect(chat.send(T2)).resolves.toBeDefined(); // fine after the awaited send
    expect(chat.turns).toHaveLength(2);
  });
});

describe('recordedChat — pauses are unsupported inside a recorded turn', () => {
  it('a paused run throws and records nothing', async () => {
    const makeAgent: MakeChatAgent = () =>
      Agent.create({
        provider: mock({
          respond: (req) =>
            req.messages.at(-1)?.role === 'tool'
              ? 'done'
              : { toolCalls: [{ id: 't1', name: 'approve', args: {} }] },
        }),
        model: 'mock-1',
        maxIterations: 2,
      })
        .system('approve then answer')
        .tool({
          schema: { name: 'approve', description: 'ask a human', inputSchema: { type: 'object' } },
          execute: () => {
            pauseHere({ question: 'ok?', risk: 'low' });
            return '';
          },
        })
        .build();

    const chat = recordedChat({ makeAgent });
    await expect(chat.send('go')).rejects.toThrow(/paused/);
    expect(chat.turns).toHaveLength(0); // nothing recorded
  });
});

describe('recordedChat — rehydration from a persisted seed', () => {
  it('opens with the seed preamble and applies persistent removals', async () => {
    const fx = chatDeskFixture();
    const chat = recordedChat({
      makeAgent: fx.makeAgent,
      format: fx.format,
      seed: [
        { role: 'user', text: T1 },
        { role: 'assistant', text: REPLY.overviewSocial },
      ],
      removed: [{ kind: 'injection', excludeInjectionIds: ['social-sentiment'] }],
    });
    expect(chat.seed).toHaveLength(2);
    const turn = await chat.send(T2);
    // Preamble present…
    expect(turn.transcriptBefore).toEqual([`User: ${T1}`, `Advisor: ${REPLY.overviewSocial}`]);
    // …and the persistent removal makes the driver absent → HOLD.
    expect(turn.reply).toContain('HOLD');
  });
});
