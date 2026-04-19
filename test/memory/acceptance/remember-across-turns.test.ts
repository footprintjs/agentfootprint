/**
 * Acceptance test — agent remembers information across turns.
 *
 * This is the end-to-end proof that Layers 0-5 compose correctly. A minimal
 * "agent" flowchart uses the three building blocks we've shipped:
 *
 *   1. mountMemoryRead  — load prior memory into scope.memoryInjection
 *   2. a CallLLM stage  — mock LLM that echoes the injected context back,
 *                          letting us assert memory was actually delivered
 *   3. mountMemoryWrite — persist the turn's messages to the shared store
 *
 * Scenario:
 *   Turn 1: user says "My name is Alice."
 *   Turn 1 result: written to store as two messages
 *   Turn 2: user asks "What's my name?"
 *   Turn 2 pre-LLM: memory pipeline loads Alice's name from store, injects
 *                    as a system message
 *   Turn 2 LLM: receives prompt containing the injected memory; records
 *               the prompt so the test can assert "Alice" was in it
 *   Turn 2 result: persisted alongside turn 1
 *
 * Passing this test means: identity isolation works, read pipeline
 * composes (load → pick → format), write pipeline persists, cross-turn
 * state is durable, and the whole stack talks to itself correctly
 * through shared scope.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { TypedScope } from 'footprintjs';
import { InMemoryStore } from '../../../src/memory/store';
import { defaultPipeline } from '../../../src/memory/pipeline/default';
import { mountMemoryRead, mountMemoryWrite } from '../../../src/memory/wire';
import type { MemoryIdentity } from '../../../src/memory/identity';
import type { Message } from '../../../src/types/messages';

interface AgentState {
  identity: MemoryIdentity;
  turnNumber: number;
  contextTokensRemaining: number;
  userMessage: string;
  assistantReply: string;
  // Memory injection — read subflow writes this before LLM runs.
  memoryInjection: Message[];
  // What gets persisted at turn end — populated after the LLM call.
  newMessages: Message[];
  // Test fixtures — what the mock LLM saw, so we can assert on its input.
  lastLLMPrompt: Message[];
  [key: string]: unknown;
}

/**
 * Build a complete agent-like flowchart wired with memory.
 * Structure: Seed → [Memory Read] → CallLLM → PackageMessages → [Memory Write]
 */
function buildAgent(args: {
  store: InMemoryStore;
  identity: MemoryIdentity;
  turnNumber: number;
  userMessage: string;
  mockReply: string;
}) {
  const pipeline = defaultPipeline({ store: args.store });

  const seed = (scope: TypedScope<AgentState>) => {
    scope.identity = args.identity;
    scope.turnNumber = args.turnNumber;
    scope.contextTokensRemaining = 4000;
    scope.userMessage = args.userMessage;
    scope.assistantReply = '';
    scope.memoryInjection = [];
    scope.newMessages = [];
    scope.lastLLMPrompt = [];
  };

  // Mock "LLM call" — reads memoryInjection + userMessage, records the
  // prompt it received, writes a fixed reply. No network, deterministic.
  const callLLM = (scope: TypedScope<AgentState>) => {
    const prompt: Message[] = [
      ...(scope.memoryInjection ?? []),
      { role: 'user', content: scope.userMessage },
    ];
    scope.lastLLMPrompt = prompt;
    scope.assistantReply = args.mockReply;
  };

  // After the LLM call, package user + assistant messages for the write
  // pipeline to persist. This stage is what a real AgentRunner would do
  // between CallLLM and the memory write.
  const packageForWrite = (scope: TypedScope<AgentState>) => {
    scope.newMessages = [
      { role: 'user', content: scope.userMessage },
      { role: 'assistant', content: scope.assistantReply },
    ];
  };

  let b = flowChart<AgentState>('Seed', seed, 'seed');
  b = mountMemoryRead(b, { pipeline });
  b = b.addFunction('CallLLM', callLLM, 'call-llm');
  b = b.addFunction('Package', packageForWrite, 'package');
  b = mountMemoryWrite(b, { pipeline });

  return b.build();
}

const ID: MemoryIdentity = { tenant: 't1', principal: 'u1', conversationId: 'c-alice' };

let store: InMemoryStore;
beforeEach(() => {
  store = new InMemoryStore();
});

// ── Acceptance: the core scenario ───────────────────────────

describe('Acceptance — agent remembers across turns', () => {
  it('turn 1 writes messages to store', async () => {
    const chart = buildAgent({
      store,
      identity: ID,
      turnNumber: 1,
      userMessage: 'My name is Alice.',
      mockReply: 'Nice to meet you, Alice!',
    });
    await new FlowChartExecutor(chart).run();

    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(2); // user + assistant
    const contents = listed.entries.map((e) =>
      typeof e.value === 'object' && e.value !== null ? String((e.value as Message).content) : '',
    );
    expect(contents.some((c) => c.includes('Alice'))).toBe(true);
  });

  it('turn 2 reads prior turn via memory injection — LLM prompt contains Alice', async () => {
    // Turn 1
    await new FlowChartExecutor(
      buildAgent({
        store,
        identity: ID,
        turnNumber: 1,
        userMessage: 'My name is Alice.',
        mockReply: 'Nice to meet you, Alice!',
      }),
    ).run();

    // Turn 2 — asks about name
    const chart2 = buildAgent({
      store,
      identity: ID,
      turnNumber: 2,
      userMessage: "What's my name?",
      mockReply: 'Your name is Alice.',
    });
    const exec2 = new FlowChartExecutor(chart2);
    await exec2.run();

    const shared = exec2.getSnapshot()?.sharedState ?? {};
    const prompt = shared.lastLLMPrompt as Message[];

    // The mock LLM saw an injected system message in its prompt
    // containing "Alice" — loaded from turn 1 by the read pipeline.
    const promptStr = prompt.map((m) => String(m.content)).join('\n');
    expect(promptStr).toContain('Alice');
    // System message (memory injection) precedes the user message.
    expect(prompt[0].role).toBe('system');
    expect(prompt[prompt.length - 1].role).toBe('user');
  });

  it('three-turn accumulation — turn 3 sees turns 1 AND 2', async () => {
    for (let i = 1; i <= 2; i++) {
      await new FlowChartExecutor(
        buildAgent({
          store,
          identity: ID,
          turnNumber: i,
          userMessage: `turn-${i}-user`,
          mockReply: `turn-${i}-assistant`,
        }),
      ).run();
    }

    const chart3 = buildAgent({
      store,
      identity: ID,
      turnNumber: 3,
      userMessage: 'ignore me',
      mockReply: 'ignored',
    });
    const exec3 = new FlowChartExecutor(chart3);
    await exec3.run();

    const shared = exec3.getSnapshot()?.sharedState ?? {};
    const promptStr = (shared.lastLLMPrompt as Message[]).map((m) => String(m.content)).join('\n');

    expect(promptStr).toContain('turn-1-user');
    expect(promptStr).toContain('turn-1-assistant');
    expect(promptStr).toContain('turn-2-user');
    expect(promptStr).toContain('turn-2-assistant');
  });

  it('identity isolation — tenant A writes NOT visible to tenant B', async () => {
    const A: MemoryIdentity = { tenant: 'A', conversationId: 'c' };
    const B: MemoryIdentity = { tenant: 'B', conversationId: 'c' };

    // Tenant A writes a secret
    await new FlowChartExecutor(
      buildAgent({
        store,
        identity: A,
        turnNumber: 1,
        userMessage: 'The passphrase is swordfish.',
        mockReply: 'Got it.',
      }),
    ).run();

    // Tenant B runs next — must NOT see A's secret in its LLM prompt
    const chartB = buildAgent({
      store,
      identity: B,
      turnNumber: 1,
      userMessage: 'What did I just tell you?',
      mockReply: 'Nothing yet.',
    });
    const execB = new FlowChartExecutor(chartB);
    await execB.run();

    const shared = execB.getSnapshot()?.sharedState ?? {};
    const promptStr = (shared.lastLLMPrompt as Message[]).map((m) => String(m.content)).join('\n');

    expect(promptStr).not.toContain('swordfish');
    // Only the user's new message, no system memory injection
    expect((shared.memoryInjection as Message[]).length).toBe(0);
  });

  it('memory injection survives JSON round-trip via getSnapshot', async () => {
    // The snapshot's sharedState is the durable view the viewer / consumer
    // sees. Pin that memoryInjection is serializable.
    await new FlowChartExecutor(
      buildAgent({
        store,
        identity: ID,
        turnNumber: 1,
        userMessage: 'remember X',
        mockReply: 'noted',
      }),
    ).run();

    const chart2 = buildAgent({
      store,
      identity: ID,
      turnNumber: 2,
      userMessage: 'what was X',
      mockReply: '-',
    });
    const exec2 = new FlowChartExecutor(chart2);
    await exec2.run();

    const snap = exec2.getSnapshot();
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json);
    // Injection is in there
    expect(JSON.stringify(parsed.sharedState.memoryInjection)).toContain('remember X');
  });

  it('narrative shows memory subflow boundaries', async () => {
    const chart = buildAgent({
      store,
      identity: ID,
      turnNumber: 1,
      userMessage: 'hi',
      mockReply: 'hi',
    });
    const executor = new FlowChartExecutor(chart);
    executor.enableNarrative();
    await executor.run();

    const narrative = executor.getNarrative().join('\n');
    // Both subflow mount points appear in the combined narrative —
    // we explicitly name them 'Load Memory' and 'Save Memory'.
    expect(narrative).toMatch(/Load Memory|sf-memory-read/);
    expect(narrative).toMatch(/Save Memory|sf-memory-write/);
  });
});
