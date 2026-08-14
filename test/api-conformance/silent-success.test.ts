/**
 * SILENT SUCCESS — the class this suite exists to keep out.
 *
 * A silent success is a call that a competent consumer would naturally make,
 * that the library ACCEPTS, and that then does something else. Nothing throws.
 * Nothing scores zero. The run looks perfect from every angle including its own
 * trace, and the only symptom is a product that behaves slightly untruthfully:
 * an agent that has forgotten a conversation it is in the middle of, a consent
 * gate a later message walked around, a stored conversation answered by the
 * wrong agent, two runs that both "worked" and left one instance's state.
 *
 * 9.1.0 shipped one of these (`indexCorpus` half-reading a chunk and calling it
 * success). 9.2.0 audited the Agent/LLMCall surface for its siblings. This file
 * is the SEAL on that audit: every shape it found is pinned here to the outcome
 * it was ruled to have, so no future release can reintroduce a member of the
 * class without a red test.
 *
 * ## Three kinds of pin, and why the third one matters most
 *
 *   1. REFUSED — the call throws, and the message still TEACHES. Pinned by
 *      substring, so a refusal cannot quietly decay into a bare `throw`.
 *   2. ADAPTED — the call now does the right thing. Pinned by observing what
 *      reaches the model / the store / the caller, never by mocking internals.
 *   3. STATED — the behavior is deliberate and unchanged, and the LIBRARY SAYS
 *      SO. Pinned twice: the behavior, AND the sentence in the source that
 *      states it. A stated behavior whose statement was deleted is back to
 *      being a silent success, and only the second assertion catches that.
 *
 * Plus a DOCTRINE SWEEP: every public `AgentBuilder` method is classified as
 * refuses-a-second-call, repeatable-by-design, or a named last-wins exception.
 * A method that is none of the three fails the suite — so a builder setter
 * added in a later release cannot join `.system()`'s old club unnoticed.
 *
 * 7-pattern matrix: unit (each refusal in isolation) · scenario (two turns of a
 * real conversation) · integration (the wire the provider actually receives,
 * through a real chart) · property (the classification lists are pinned by
 * exact content, so neither can silently grow or shrink) · security (the
 * pending-question gate, and the cross-agent conversation refusal) ·
 * regression (every row is a shape that USED to succeed wrongly) · performance
 * (n/a — nothing here is on a hot path).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  Agent,
  codeRunnerTool,
  defineTool,
  LLMCall,
  NoConversationError,
  PendingQuestionError,
  RunInFlightError,
  ConversationMismatchError,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { pauseHere } from '../../src/core/pause.js';
import { unconfiguredCredentialProvider } from '../../src/identity/types.js';
import type { CodeResult, CodeRunner, LLMRequest } from '../../src/adapters/types.js';

const SRC = join(__dirname, '..', '..', 'src');
const read = (relative: string): string => readFileSync(join(SRC, relative), 'utf8');

/** A provider that keeps every request it was handed, so a test can assert on
 *  the bytes the model actually saw rather than on an internal field. */
function recordingProvider(reply = 'ok'): {
  provider: ReturnType<typeof mock>;
  seen: LLMRequest[];
} {
  const seen: LLMRequest[] = [];
  return {
    provider: mock({
      respond: (req) => {
        seen.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        return reply;
      },
    }),
    seen,
  };
}

const userTurns = (req: LLMRequest | undefined): string[] =>
  (req?.messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content));

/** A tool that pauses to ask a person something. */
const askTool = defineTool({
  name: 'ask',
  description: 'Ask the human to approve.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => {
    pauseHere({ question: 'Approve the refund?' });
    return 'unreachable';
  },
});

const pausingAgent = (): Agent =>
  Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'ask', args: {} }] },
        { content: 'approved and done' },
        { content: 'a fresh answer' },
      ],
    }),
    model: 'mock',
  })
    .system('You approve refunds.')
    .tool(askTool)
    .build();

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CONVERSATION — run() is one turn, and the door that continues one
// ─────────────────────────────────────────────────────────────────────────────

describe('silent success — the conversation', () => {
  it('STATED: a second run() starts a NEW conversation, and run() says so', async () => {
    const { provider, seen } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();

    await agent.run({ message: 'turn one' });
    await agent.run({ message: 'turn two' });

    // The behavior: turn two's request carries turn two and nothing else.
    expect(userTurns(seen[1])).toEqual(['turn two']);

    // The statement. Deleting it turns this from a documented primitive back
    // into a trap, so the sentence is part of the contract.
    const src = read('core/Agent.ts');
    expect(src).toContain('`run()` is ONE turn, and it starts a new conversation every time');
    expect(src).toContain('agent.followUp(message)');
  });

  it('ADAPTED: followUp() continues the conversation the model can see', async () => {
    const { provider, seen } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();

    await agent.run({ message: 'Book me a table for two.' });
    await agent.followUp('Make it three.');

    // Turn two sees turn one's question, turn one's answer, and the new turn.
    expect(userTurns(seen[1])).toEqual(['Book me a table for two.', 'Make it three.']);
    expect(seen[1]?.messages.some((m) => m.role === 'assistant' && m.content === 'ok')).toBe(true);
  });

  it('ADAPTED: run({ continueFrom }) continues a conversation from anywhere', async () => {
    const first = recordingProvider('the table is booked');
    const agentA = Agent.create({ provider: first.provider, model: 'mock' }).system('S').build();
    await agentA.run({ message: 'Book me a table for two.' });
    const stored = JSON.parse(JSON.stringify(agentA.checkpoint()));

    // A different process, a different instance, the same conversation.
    const second = recordingProvider();
    const agentB = Agent.create({ provider: second.provider, model: 'mock' }).system('S').build();
    await agentB.run({ message: 'Make it three.', continueFrom: stored });

    expect(userTurns(second.seen[0])).toEqual(['Book me a table for two.', 'Make it three.']);
  });

  it('ADAPTED: a continued turn keeps the identity it started with', async () => {
    const { provider } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();

    await agent.run({ message: 'one', identity: { conversationId: 'chat-1', tenant: 'acme' } });
    const conversation = agent.checkpoint();
    // Carried ON the conversation, so a store round-trip does not lose it.
    expect(conversation?.identity).toEqual({ conversationId: 'chat-1', tenant: 'acme' });

    await agent.followUp('two');
    const state = agent.getLastSnapshot()?.sharedState as { runIdentity?: unknown };
    // The turn ran under the conversation's namespace, not a fresh runId.
    expect(state.runIdentity).toEqual({ conversationId: 'chat-1', tenant: 'acme' });
  });

  it('ADAPTED: resumeOnError keeps the identity too (it could not carry one before)', async () => {
    const { provider } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();
    await agent.run({ message: 'one', identity: { conversationId: 'chat-9' } });
    const conversation = agent.checkpoint()!;

    await agent.resumeOnError(conversation);
    const state = agent.getLastSnapshot()?.sharedState as { runIdentity?: unknown };
    expect(state.runIdentity).toEqual({ conversationId: 'chat-9' });
  });

  it('STATED: identity.conversationId is a namespace key, not a session handle', async () => {
    const { provider, seen } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();

    await agent.run({ message: 'one', identity: { conversationId: 'chat-1' } });
    await agent.run({ message: 'two', identity: { conversationId: 'chat-1' } });

    // Same key, still two conversations — the behavior a caller must know.
    expect(userTurns(seen[1])).toEqual(['two']);

    const src = read('core/agent/types.ts');
    expect(src).toContain('`conversationId` is a namespace key, not a conversation');
    expect(src).toContain('does NOT continue the first');
  });

  it('REFUSED: followUp() before any run says which door to start with', async () => {
    const { provider } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();

    await expect(agent.followUp('and another thing')).rejects.toThrow(NoConversationError);
    await expect(agent.followUp('and another thing')).rejects.toThrow(
      /has not completed a run.*agent\.run\(\{ message \}\)/s,
    );
    await expect(agent.followUp('x')).rejects.toThrow(/continueFrom: storedConversation/);
  });

  it('REFUSED: followUp() after a pause points at resume(), not at itself', async () => {
    const agent = pausingAgent();
    await agent.run({ message: 'refund order 7712' });

    await expect(agent.followUp('actually, never mind')).rejects.toThrow(PendingQuestionError);
    await expect(agent.followUp('actually, never mind')).rejects.toThrow(
      /agent\.resume\(outcome\.checkpoint, decision\)/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TIMING — the two shapes that used to succeed into corrupted state
// ─────────────────────────────────────────────────────────────────────────────

describe('silent success — timing', () => {
  it('REFUSED: two overlapping run() calls on one instance', async () => {
    const { provider } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock', id: 'acme-support' }).system('S').build();

    const first = agent.run({ message: 'alpha' });
    await expect(agent.run({ message: 'beta' })).rejects.toThrow(RunInFlightError);
    await expect(agent.run({ message: 'beta' })).rejects.toThrow(
      /already running.*One instance answers one turn at a time/s,
    );
    await first;

    // And the guard releases: the agent is usable again straight after.
    await expect(agent.run({ message: 'beta' })).resolves.toBe('ok');
  });

  it('REFUSED: the guard releases even when the run threw', async () => {
    const provider = mock({
      respond: () => {
        throw new Error('provider exploded');
      },
    });
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();

    await expect(agent.run({ message: 'alpha' })).rejects.toThrow();
    // A run that failed must not leave the instance permanently refusing.
    await expect(agent.run({ message: 'beta' })).rejects.not.toThrow(RunInFlightError);
  });

  it('a refused continuation does not arm the NEXT run', async () => {
    // The side channel that carries a restored conversation is written on the
    // way into a run. If a refusal fired after that write, the history would
    // sit armed and the next run would silently continue a conversation
    // nobody asked it to — a silent success created by a refusal, which would
    // be a particularly bleak way to close this audit.
    const { provider, seen } = recordingProvider();
    const agent = pausingAgent();
    await agent.run({ message: 'refund order 7712' }); // pauses

    const other = Agent.create({ provider, model: 'mock' }).system('S').build();
    await other.run({ message: 'unrelated conversation' });
    const foreign = other.checkpoint()!;

    // Refused because a question is pending — and the refusal must not leave
    // `foreign` armed on this agent.
    await expect(agent.resumeOnError(foreign)).rejects.toThrow(PendingQuestionError);
    agent.abandonPause();
    await agent.run({ message: 'a fresh start' });

    const history = (agent.getLastSnapshot()?.sharedState as { history?: { content: string }[] })
      .history;
    expect(history?.map((m) => m.content)).not.toContain('unrelated conversation');
    void seen;
  });

  it('a run that died before seeding does not arm the next one either', async () => {
    const { provider } = recordingProvider();
    const source = Agent.create({ provider, model: 'mock' }).system('S').build();
    await source.run({ message: 'the earlier conversation' });
    const stored = source.checkpoint()!;

    // A provider that throws on the very first call: the run dies after the
    // continuation is armed and before `seed` consumes it.
    const exploding = Agent.create({
      provider: mock({
        respond: () => {
          throw new Error('provider exploded');
        },
      }),
      model: 'mock',
    })
      .system('S')
      .build();
    await expect(exploding.run({ message: 'continue it', continueFrom: stored })).rejects.toThrow();

    // …and the next, unrelated run starts clean.
    const clean = recordingProvider();
    const next = Agent.create({ provider: clean.provider, model: 'mock' }).system('S').build();
    await next.run({ message: 'brand new' });
    expect(userTurns(clean.seen[0])).toEqual(['brand new']);
  });

  it('REFUSED: a new message while a person still owes an answer', async () => {
    const agent = pausingAgent();
    const paused = await agent.run({ message: 'refund order 7712' });
    expect(typeof paused).toBe('object');

    await expect(agent.run({ message: 'never mind, different question' })).rejects.toThrow(
      PendingQuestionError,
    );
    // The refusal names what was abandoned and both ways out.
    await expect(agent.run({ message: 'x' })).rejects.toThrow(/'ask'.*call c1/s);
    await expect(agent.run({ message: 'x' })).rejects.toThrow(/Approve the refund\?/);
    await expect(agent.run({ message: 'x' })).rejects.toThrow(/agent\.abandonPause\(\)/);
  });

  it('ADAPTED: abandonPause() reports what it dropped, then lets run() through', async () => {
    const agent = pausingAgent();
    await agent.run({ message: 'refund order 7712' });

    const dropped = agent.abandonPause();
    expect(dropped).toEqual({
      toolName: 'ask',
      toolCallId: 'c1',
      question: 'Approve the refund?',
    });
    await expect(agent.run({ message: 'different question' })).resolves.toBe('approved and done');
    // Nothing pending now, so a second abandon has nothing to report.
    expect(agent.abandonPause()).toBeUndefined();
  });

  it('ADAPTED: answering the question clears it — resume() is the door', async () => {
    const agent = pausingAgent();
    const paused = await agent.run({ message: 'refund order 7712' });
    const answer = await agent.resume(
      (paused as { checkpoint: Parameters<Agent['resume']>[0] }).checkpoint,
      'yes',
    );
    expect(answer).toBe('approved and done');
    // The gate is settled: a later message is not refused.
    await expect(agent.run({ message: 'anything else?' })).resolves.toBeTypeOf('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CONFIGURATION — a setting that was accepted and dropped
// ─────────────────────────────────────────────────────────────────────────────

describe('silent success — a tool result that was quietly cut (9.7.0)', () => {
  /**
   * The class, in one sentence: the model reasons over a fragment of a table
   * believing it has the table.
   *
   * `codeRunnerTool` exists so big DATA is computed outside the context window
   * instead of pasted into it — the motivating failure being a real production
   * request of 879,073 tokens. A runner that quietly slices its own output to
   * fit is the same bug wearing a different hat, and there is no way for the
   * model to notice: a cut string is a valid string.
   */
  const runnerAnswering = (result: Partial<CodeResult>): CodeRunner => ({
    id: 'pinned-runner',
    start: () =>
      Promise.resolve({
        id: 's1',
        execute: () => Promise.resolve({ ok: true, stdout: '', stderr: '', ...result }),
        stop: () => Promise.resolve(),
      }),
  });

  const runCode = (result: Partial<CodeResult>, maxOutputChars?: number): Promise<string> =>
    codeRunnerTool({
      runner: runnerAnswering(result),
      ...(maxOutputChars !== undefined && { maxOutputChars }),
    }).execute(
      { code: 'x' },
      {
        toolCallId: 'c1',
        iteration: 0,
        credentials: unconfiguredCredentialProvider(),
        hasCredentials: false,
        runId: 'r1',
        teardownScopes: ['call', 'run', 'session', 'shutdown'],
        onTeardown: () => {},
      },
    );

  it('ADAPTED: a cut the TOOL makes is stated in the bytes the model reads', async () => {
    const out = await runCode({ stdout: 'x'.repeat(500) }, 20);
    expect(out).toContain('[truncated: showing 20 of 500 characters');
  });

  it('ADAPTED: a cut the RUNNER already made is stated too — it is not laundered', async () => {
    // The result FITS the tool's own ceiling, so the tool has nothing to cut.
    // Passing it through unmarked would present a 90,000-character answer's
    // first fragment as the whole answer.
    const out = await runCode({
      stdout: 'fits fine',
      truncated: { stdout: true, ofChars: 90_000 },
    });
    expect(out).toContain('[truncated:');
  });

  it('ACCEPTED: output that fits carries no marker — a false alarm teaches nothing either', async () => {
    expect(await runCode({ stdout: 'all of it' })).toBe('all of it');
  });

  it('STATED: the port says why truncation must be reported, and the source still says it', () => {
    // A stated behaviour whose statement was deleted is back to being a silent
    // success, and only this second assertion catches that.
    expect(read('adapters/types.ts')).toContain('An unstated slice is a silent success.');
    expect(read('core/codeRunnerTool.ts')).toContain('TRUNCATION IS ALWAYS STATED');
  });

  it('REFUSED: a session-scoped runner at a door with no session, rather than a silent narrowing', async () => {
    const tool = codeRunnerTool({ runner: runnerAnswering({}), scope: 'session' });
    // The two silent alternatives are both worse than a throw: widening the key
    // hands one sandbox to two people, and narrowing it multiplies start-up
    // cost by ~30 with nothing to show for it.
    await expect(
      tool.execute(
        { code: 'x' },
        {
          toolCallId: 'c1',
          iteration: 0,
          credentials: unconfiguredCredentialProvider(),
          hasCredentials: false,
          runId: 'r1',
          teardownScopes: ['call', 'run', 'session', 'shutdown'],
          onTeardown: () => {},
        },
      ),
    ).rejects.toThrow(/needs a hosting session/);
  });
});

describe('silent success — configuration', () => {
  it('REFUSED: .system() twice on an Agent, naming what to use instead', () => {
    const { provider } = recordingProvider();
    const build = (): unknown =>
      Agent.create({ provider, model: 'mock' }).system('first').system('second');

    expect(build).toThrow(/AgentBuilder\.system: already set/);
    expect(build).toThrow(/never sent and nothing said so/);
    expect(build).toThrow(/\.steering\(/);
    expect(build).toThrow(/\.configure\(/);
  });

  it('REFUSED: .system() twice on an LLMCall', () => {
    const { provider } = recordingProvider();
    expect(() => LLMCall.create({ provider, model: 'mock' }).system('a').system('b')).toThrow(
      /LLMCallBuilder\.system: already set/,
    );
  });

  it('REFUSED: .system("") counts as set — the flag is not the value', () => {
    const { provider } = recordingProvider();
    expect(() => Agent.create({ provider, model: 'mock' }).system('').system('x')).toThrow(
      /already set/,
    );
  });

  it('REFUSED: a duplicate tool name, including one arriving in a bulk list', () => {
    const { provider } = recordingProvider();
    const t = (name: string) =>
      defineTool({
        name,
        description: 'd',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => 'r',
      });

    expect(() => Agent.create({ provider, model: 'mock' }).tool(t('x')).tool(t('x'))).toThrow(
      /duplicate tool name 'x'/,
    );
    // The MCP shape: `.tools(await client.tools())` colliding with a local one.
    expect(() =>
      Agent.create({ provider, model: 'mock' })
        .tool(t('search'))
        .tools([t('other'), t('search')]),
    ).toThrow(/duplicate tool name 'search'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. STORED CONVERSATIONS — whose transcript is this?
// ─────────────────────────────────────────────────────────────────────────────

describe('silent success — stored conversations', () => {
  const withId = (id: string, systemPrompt: string) =>
    Agent.create({ provider: recordingProvider().provider, model: 'mock', id })
      .system(systemPrompt)
      .build();

  it('REFUSED: one named agent answering another named agent’s conversation', async () => {
    const billing = withId('billing', 'You handle invoices.');
    await billing.run({ message: 'what do I owe?' });
    const conversation = billing.checkpoint()!;
    expect(conversation.agent).toEqual({ id: 'billing' });

    const support = withId('support', 'You handle tickets.');
    await expect(
      support.run({ message: 'and my ticket?', continueFrom: conversation }),
    ).rejects.toThrow(ConversationMismatchError);
    await expect(support.resumeOnError(conversation)).rejects.toThrow(
      /recorded by agent 'billing'.*handed to agent 'support'/s,
    );
  });

  it('ACCEPTED: the same named agent after a deploy that changed its tools', async () => {
    const before = withId('support', 'You handle tickets.');
    await before.run({ message: 'my order is late' });
    const conversation = before.checkpoint()!;

    // Same id, new tool, edited prompt, different model — an ordinary deploy.
    const after = Agent.create({
      provider: recordingProvider().provider,
      model: 'mock-2',
      id: 'support',
    })
      .system('You handle tickets. Be brief.')
      .tool(
        defineTool({
          name: 'lookup',
          description: 'd',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => 'r',
        }),
      )
      .build();

    await expect(
      after.run({ message: 'any update?', continueFrom: conversation }),
    ).resolves.toBeTypeOf('string');
  });

  it('ACCEPTED: agents that never named themselves are never refused', async () => {
    const a = Agent.create({ provider: recordingProvider().provider, model: 'mock' })
      .system('A')
      .build();
    await a.run({ message: 'hello' });
    const conversation = a.checkpoint()!;
    // Nothing was stamped, because nobody chose an id.
    expect(conversation.agent).toBeUndefined();

    const b = Agent.create({ provider: recordingProvider().provider, model: 'mock' })
      .system('B')
      .build();
    await expect(b.run({ message: 'again', continueFrom: conversation })).resolves.toBeTypeOf(
      'string',
    );
  });

  it('STATED: the fingerprint rule is the embedder rule — both sides, or nothing', () => {
    const src = read('core/runCheckpoint.ts');
    expect(src).toContain('BOTH sides named themselves');
    expect(src).toContain("A default id (`'agent'`) is not");
    expect(src).toContain('the embedder fingerprint already uses');
  });

  it('a stored conversation still round-trips through JSON', async () => {
    const agent = withId('support', 'S');
    await agent.run({ message: 'one', identity: { conversationId: 'c1' } });
    const revived = JSON.parse(JSON.stringify(agent.checkpoint()));
    expect(revived.version).toBe(1);
    expect(revived.identity).toEqual({ conversationId: 'c1' });
    expect(revived.agent).toEqual({ id: 'support' });
    await expect(agent.run({ message: 'two', continueFrom: revived })).resolves.toBeTypeOf(
      'string',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. READING A RUN — what the accessors say before, during and after
// ─────────────────────────────────────────────────────────────────────────────

describe('silent success — reading a run', () => {
  it('ACCEPTED: the accessors answer honestly before any run', () => {
    const { provider } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();

    expect(agent.getLastSnapshot()).toBeUndefined();
    expect(agent.checkpoint()).toBeUndefined();
    expect(agent.getLastNarrativeEntries()).toEqual([]);
    expect(agent.canExplain()).toBe(false);
  });

  it('STATED: getLastSnapshot() is LIVE during a run, and says so', async () => {
    const { provider } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();

    let midRun: unknown;
    agent.on('agentfootprint.agent.turn_start', () => {
      midRun = agent.getLastSnapshot();
    });
    await agent.run({ message: 'one' });

    // It answered DURING the run, about the run in flight — not `undefined`.
    expect(midRun).toBeDefined();

    for (const [file, sentence] of [
      ['core/Agent.ts', 'It is LIVE during a run, not a completed-runs-only view'],
      ['core/RunnerBase.ts', '**Live during a run.**'],
    ] as const) {
      expect(read(file)).toContain(sentence);
    }
  });

  it('ADAPTED: canExplain() answers the binding question, both false reasons', async () => {
    const noSelfExplain = Agent.create({ provider: recordingProvider().provider, model: 'mock' })
      .system('S')
      .build();
    // Built without the feature: nothing to explain, ever.
    expect(noSelfExplain.canExplain()).toBe(false);
    await noSelfExplain.run({ message: 'one' });
    expect(noSelfExplain.canExplain()).toBe(false);

    const explains = Agent.create({ provider: recordingProvider().provider, model: 'mock' })
      .system('S')
      .selfExplain()
      .build();
    // Built with it, but no turn has completed yet.
    expect(explains.canExplain()).toBe(false);
    await explains.run({ message: 'one' });
    expect(explains.canExplain()).toBe(true);
  });

  it('STATED: with no record bound, the trace tools and the skill both say so', () => {
    const lazy = read('lib/trace-toolpack/lazyToolpack.ts');
    expect(lazy).toContain('No completed run is available yet');
    expect(lazy).toContain('Tell the user there is nothing to explain yet.');
    // The model is told the same thing by the methodology it is handed.
    expect(read('lib/trace-toolpack/debugPrompt.ts')).toContain('say so plainly');
  });

  it('ACCEPTED: a recorder attached between runs observes the next one', async () => {
    const { provider } = recordingProvider();
    const agent = Agent.create({ provider, model: 'mock' }).system('S').build();
    await agent.run({ message: 'one' });

    let stages = 0;
    agent.attach({ id: 'seal-probe', onStageExecuted: () => void stages++ });
    await agent.run({ message: 'two' });
    expect(stages).toBeGreaterThan(0);
  });

  it('STATED: attach() takes effect on the NEXT run, and says so', () => {
    expect(read('core/RunnerBase.ts')).toContain('WHEN it starts observing: the NEXT run.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE DOCTRINE SWEEP — every builder setter is classified, on purpose
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called twice, throws. "One X per agent" is the house rule, and these are
 * the methods that keep it.
 */
const REFUSES_A_SECOND_CALL = [
  'act',
  'checkIn',
  'compaction',
  'configure',
  'namesAndNumbersFromEvidence',
  'outputFallback',
  'outputSchema',
  'reliability',
  'selfExplain',
  'skillGraph',
  'system',
  'thinking',
  'thinkingHandler',
  'toolProvider',
  'window',
] as const;

/**
 * Called many times, adds many things. Calling these repeatedly is the point,
 * so a second call is never a mistake to catch.
 */
const REPEATABLE_BY_DESIGN = [
  'fact',
  'injection',
  'instruction',
  'instructions',
  'memory',
  'messageMiddleware',
  'rag',
  'skill',
  'skills',
  'steering',
  'tool',
  'toolMiddleware',
  'tools',
  'watch',
] as const;

/**
 * The NAMED exceptions: single-valued setters where the last call deliberately
 * wins, because re-stating a scalar is not the same mistake as re-stating a
 * policy. `maxIterations` is a number, and the other three are display strings
 * that decide nothing about what the model is sent or what the agent may do.
 *
 * This list is the point of the sweep. It is short, it is deliberate, and it
 * is pinned by exact content — so growing it is a decision somebody has to
 * make in a diff, not something that happens by adding a method.
 */
const LAST_WINS_BY_DECISION = [
  'appName',
  'commentaryTemplates',
  'maxIterations',
  'thinkingTemplates',
] as const;

/** Neither a setter nor a policy: the terminal, and a removed name kept as a
 *  throwing signpost. */
const NOT_A_SETTER = ['build', 'recorder'] as const;

describe('silent success — the doctrine sweep', () => {
  /**
   * The PUBLIC builder surface, read from the source.
   *
   * Not from the prototype: TypeScript's `private` is a compile-time word, so
   * every internal helper is an own-property of the prototype at runtime and a
   * prototype scan would classify `assertNoWindowStrategy` as consumer API.
   * What a consumer can call is what is declared without `private`, which is
   * exactly what this reads.
   */
  const builderMethods = (): string[] => {
    const src = read('core/agent/AgentBuilder.ts');
    const declaration =
      /^ {2}(?!private |protected |\/|\*)([a-zA-Z][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\(/gm;
    const names = new Set<string>();
    for (const match of src.matchAll(declaration)) {
      const name = match[1]!;
      if (name !== 'constructor' && name !== 'if' && name !== 'for' && name !== 'return') {
        names.add(name);
      }
    }
    return [...names].sort();
  };

  it('every public builder method is classified — a new one fails until it is', () => {
    const classified = new Set<string>([
      ...REFUSES_A_SECOND_CALL,
      ...REPEATABLE_BY_DESIGN,
      ...LAST_WINS_BY_DECISION,
      ...NOT_A_SETTER,
    ]);
    const unclassified = builderMethods().filter((name) => !classified.has(name));
    expect(unclassified).toEqual([]);
  });

  it('no method is classified twice, and none has disappeared', () => {
    const all = [
      ...REFUSES_A_SECOND_CALL,
      ...REPEATABLE_BY_DESIGN,
      ...LAST_WINS_BY_DECISION,
      ...NOT_A_SETTER,
    ];
    expect(new Set(all).size).toBe(all.length);

    const live = new Set(builderMethods());
    const missing = all.filter((name) => !live.has(name));
    expect(missing).toEqual([]);
  });

  it('the last-wins exception list stays short and stays named', () => {
    // Pinned by exact content: this is the list of places the library still
    // lets a second call win in silence, and it may only change deliberately.
    expect([...LAST_WINS_BY_DECISION]).toEqual([
      'appName',
      'commentaryTemplates',
      'maxIterations',
      'thinkingTemplates',
    ]);
  });

  it('every "one per agent" method really does refuse a second call', () => {
    // Each entry is exercised through its own real arguments; a method that
    // stopped refusing would fail here rather than in a consumer's app.
    const twice: Record<(typeof REFUSES_A_SECOND_CALL)[number], () => unknown> = {
      act: () => base().act({ maxIterations: 3 }).act({ maxIterations: 4 }),
      checkIn: () => base().tool(askTool).checkIn({}).checkIn({}),
      compaction: () =>
        base()
          .compaction({ summarizer: recordingProvider().provider, model: 'm', keepRecent: 2 })
          .compaction({ summarizer: recordingProvider().provider, model: 'm', keepRecent: 2 }),
      configure: () =>
        base()
          .configure(() => ({}))
          .configure(() => ({})),
      namesAndNumbersFromEvidence: () =>
        base().namesAndNumbersFromEvidence().namesAndNumbersFromEvidence({ posture: 'guard' }),
      outputFallback: () =>
        base()
          .outputSchema({ parse: (v: string) => JSON.parse(v) })
          .outputFallback({ canned: {} })
          .outputFallback({ canned: {} }),
      outputSchema: () =>
        base()
          .outputSchema({ parse: (v: string) => JSON.parse(v) })
          .outputSchema({ parse: (v: string) => JSON.parse(v) }),
      reliability: () => base().reliability({}).reliability({}),
      selfExplain: () => base().selfExplain().selfExplain(),
      skillGraph: () =>
        base()
          .skillGraph({ skills: [], nextSkill: () => undefined })
          .skillGraph({ skills: [], nextSkill: () => undefined }),
      system: () => base().system('a').system('b'),
      thinking: () => base().thinking({ budget: 1024 }).thinking({ budget: 2048 }),
      thinkingHandler: () => base().thinkingHandler(null).thinkingHandler(null),
      toolProvider: () => base().toolProvider(noopProvider()).toolProvider(noopProvider()),
      window: () => base().window(keepAll()).window(keepAll()),
    };

    for (const name of REFUSES_A_SECOND_CALL) {
      expect(twice[name], `${name}() must refuse a second call`).toThrow();
      // …and the refusal has to TEACH: it names the door the caller used.
      expect(twice[name], `${name}()'s refusal must name itself`).toThrow(
        new RegExp(`\\b${name}\\b`),
      );
    }
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const base = (): any => Agent.create({ provider: recordingProvider().provider, model: 'mock' });
const noopProvider = (): any => ({ id: 'noop', list: async () => [] });
const keepAll = (): any => ({ name: 'keep-all', apply: (messages: unknown) => messages });
/* eslint-enable @typescript-eslint/no-explicit-any */
