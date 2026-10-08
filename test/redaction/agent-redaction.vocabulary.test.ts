/**
 * The vocabulary, proven per feature — `conversationRedaction()`
 * (`src/redaction/conversation.ts`).
 *
 * The library's list of names an agent's record carries the conversation
 * under is only worth having if it is complete for the features it claims.
 * Each case below turns ONE feature on, puts a canary in every place that
 * feature moves the conversation (the person's words, the model's words and
 * thinking, tool arguments and results, recalled memory, a person's reply),
 * and runs the agent twice:
 *
 *   - CONTROL, no policy: every canary reaches some record — so the case
 *     really exercises the feature (a canary that never reaches a record
 *     proves nothing under the policy);
 *   - UNDER `conversationRedaction()`: no canary reaches ANY record the run
 *     serves — events, the served snapshot, the recording (packed too), the
 *     narrative, the answer account — and the run's EVENTS are the same events
 *     (a policy keeps values out; it never takes an event away);
 *   - the answer account over the redacted recording is TOLD (no reader of it
 *     read a kept-out value it did not handle: `view.ts` · `keptOutRead`).
 *
 * `CONVERSATION_FEATURES` names these cases; a feature added there needs a
 * case here.
 */
import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import {
  Agent,
  allow,
  askHuman,
  checkInApproved,
  defineRAG,
  defineTool,
  isInputPause,
  isPaused,
} from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import { mock } from '../../src/doors/providers.js';
import {
  accountForAnswer,
  packRecording,
  recordRun,
  unpackRecording,
} from '../../src/doors/observe.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { boundedContentFieldNames } from '../../src/adapters/observability/audit.js';
import { derivedRows } from '../../src/redaction/served.js';
import { ALL_EVENT_TYPES } from '../../src/events/registry.js';
import { CONVERSATION_FEATURES } from '../../src/redaction/conversation.js';
import { mockThinkingHandler } from '../../src/thinking/MockThinkingHandler.js';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../src/memory/index.js';
import { InMemoryStore } from '../../src/memory/store/index.js';
import { mockEmbedder } from '../../src/memory/embedding/index.js';
import { indexDocuments } from '../../src/lib/rag/index.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { locationsOf, withoutAnswerBoundary } from './fixture.js';

type BuiltAgent = ReturnType<ReturnType<typeof Agent.create>['build']>;

/** What one run served, and the canaries it was handed. */
interface Served {
  readonly types: string[];
  readonly artifacts: Record<string, unknown>;
}

/** Every record a run serves, gathered the way a consumer would. */
async function serve(
  agent: BuiltAgent,
  go: (agent: BuiltAgent) => Promise<unknown>,
): Promise<Served> {
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (e) => events.push(e));
  const recorder = recordRun(agent);
  await go(agent);
  const recording = recorder.toRecording();
  return {
    types: events.map((e) => e.type),
    artifacts: {
      events,
      snapshot: agent.getLastSnapshot(),
      recording,
      packed: unpackRecording(packRecording(recording as never)),
      narrative: agent.getLastNarrativeEntries(),
      account: accountForAnswer(recording as never),
    },
  };
}

/** `secret → where it reached`, the answer's one named limit taken out. */
function reached(served: Served, secrets: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const secret of secrets) {
    const at = Object.entries(served.artifacts).flatMap(([name, value]) =>
      locationsOf(withoutAnswerBoundary(value), secret).map((path) => `${name}${path.slice(1)}`),
    );
    if (at.length > 0) out[secret] = at;
  }
  return out;
}

/** One feature's case: build the agent (with or without the policy) and drive it. */
interface FeatureCase {
  readonly feature: string;
  readonly canaries: readonly string[];
  readonly build: (redact: RedactionPolicy | undefined) => BuiltAgent;
  readonly drive: (agent: BuiltAgent) => Promise<unknown>;
}

const lookup = (result: () => unknown) =>
  defineTool<{ id: string }, unknown>({
    name: 'lookup',
    description: 'Look a citizen up.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    execute: result,
  });

const create = (provider: LLMProvider, redact: RedactionPolicy | undefined) =>
  Agent.create({ provider, model: 'mock', maxIterations: 6, ...(redact && { redact }) });

const CASES: readonly FeatureCase[] = [
  {
    feature: 'the turn (message, answer, history, streamed tokens)',
    canaries: ['CANARY-TURN-ASK', 'CANARY-TURN-ANSWER'],
    build: (redact) =>
      create(mock({ chunkDelayMs: 0, reply: 'Here: CANARY-TURN-ANSWER' }), redact).build(),
    drive: (agent) => agent.run({ message: 'CANARY-TURN-ASK, please' }),
  },
  {
    feature: 'tools (arguments, results, tool-result rules, a paused call)',
    canaries: ['CANARY-TOOL-ARG', 'CANARY-TOOL-RESULT', 'CANARY-TOOL-RULE', 'CANARY-TOOL-THROW'],
    build: (redact) =>
      create(
        mock({
          chunkDelayMs: 0,
          replies: [
            {
              toolCalls: [
                { id: 'c1', name: 'lookup', args: { id: 'CANARY-TOOL-ARG' } },
                { id: 'c2', name: 'broken', args: { id: 'CANARY-TOOL-ARG' } },
              ],
            },
            { content: 'done' },
          ],
        }),
        redact,
      )
        .tool(lookup(() => ({ rows: ['CANARY-TOOL-RESULT'] })))
        .tool(
          defineTool<{ id: string }, unknown>({
            name: 'broken',
            description: 'Always fails.',
            inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
            execute: ({ id }) => {
              throw new Error(`no citizen ${id} CANARY-TOOL-THROW`);
            },
          }),
        )
        .toolMiddleware({
          name: 'summarize',
          onToolResult: () => allow('summary CANARY-TOOL-RULE', 'summarized'),
        } as never)
        .build(),
    drive: (agent) => agent.run({ message: 'look it up' }),
  },
  {
    feature: 'model thinking',
    canaries: ['CANARY-THINKING'],
    build: (redact) =>
      create(
        {
          name: 'mock',
          thinkingHandler: mockThinkingHandler,
          complete: async (): Promise<LLMResponse> => ({
            content: 'final',
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'end_turn',
            rawThinking: {
              kind: 'anthropic',
              blocks: [{ type: 'thinking', thinking: 'I think CANARY-THINKING' }],
            },
          }),
        } as LLMProvider,
        redact,
      )
        .system('You help.')
        .build(),
    drive: (agent) => agent.run({ message: 'hi' }),
  },
  {
    feature: 'asking a person (askHuman) and resuming',
    canaries: ['CANARY-ASK-ARG', 'CANARY-ASK-QUESTION', 'CANARY-ASK-REPLY'],
    build: (redact) =>
      create(
        mock({
          chunkDelayMs: 0,
          replies: [
            { toolCalls: [{ id: 'p1', name: 'confirm', args: { id: 'CANARY-ASK-ARG' } }] },
            { content: 'confirmed' },
          ],
        }),
        redact,
      )
        .tool(
          defineTool<{ id: string }, string>({
            name: 'confirm',
            description: 'Ask a person to confirm.',
            inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
            execute: ({ id }) => askHuman({ question: `Is ${id} right? CANARY-ASK-QUESTION` }),
          }),
        )
        .build(),
    drive: async (agent) => {
      const outcome = await agent.run({ message: 'confirm it' });
      if (!isPaused(outcome)) throw new Error('the case must pause');
      return agent.resume(outcome.checkpoint, { answer: 'yes, CANARY-ASK-REPLY' });
    },
  },
  {
    // The inputs layer: the model leaves a ruled argument out, the person is
    // asked, and the call runs with their answer — which travels in working
    // state (`argumentResolutions`, `argumentAnswersKept`) and on the call.
    feature: 'the inputs layer (an argument the person is asked for)',
    canaries: ['CANARY-INPUT-SERVICE', 'CANARY-INPUT-ANSWER'],
    build: (redact) =>
      create(
        mock({
          chunkDelayMs: 0,
          replies: [
            {
              toolCalls: [
                { id: 'c1', name: 'search_logs', args: { service: 'CANARY-INPUT-SERVICE' } },
              ],
            },
            { content: 'done' },
          ],
        }),
        redact,
      )
        .tool(
          defineTool<{ service: string; focus: string }, string>({
            name: 'search_logs',
            description: 'Error lines for one service.',
            inputSchema: {
              type: 'object',
              required: ['service', 'focus'],
              properties: { service: { type: 'string' }, focus: { type: 'string' } },
            },
            askOrAssume: { focus: { ask: 'What should the search look for?' } },
            execute: ({ focus }) => `no lines for ${focus}`,
          }),
        )
        .build(),
    drive: async (agent) => {
      const outcome = await agent.run({ message: 'any errors?' });
      if (!isInputPause(outcome)) throw new Error('the case must ask for the argument');
      const field = outcome.awaitingInput.fields[0]!;
      return agent.resume(outcome.checkpoint, {
        requestId: outcome.awaitingInput.requestId,
        values: { [field.id]: 'CANARY-INPUT-ANSWER' },
      });
    },
  },
  {
    feature: 'structured output (schema retries, the output fallback)',
    canaries: ['CANARY-DRAFT'],
    build: (redact) =>
      create(
        mock({
          chunkDelayMs: 0,
          replies: Array.from({ length: 8 }, (_, i) => `draft ${i} CANARY-DRAFT`),
        }),
        redact,
      )
        .outputSchema(
          {
            parse: (value: unknown) => {
              if (typeof value === 'object' && value !== null && 'ok' in value) return value;
              throw new Error('bad shape');
            },
            description: 'an object with ok',
          } as never,
          { retries: 1 } as never,
        )
        .outputFallback({
          fallback: () => {
            throw new Error('no fallback');
          },
          canned: { ok: true },
        } as never)
        .build(),
    drive: async (agent) => {
      await agent.run({ message: 'answer as json' });
      await (agent as unknown as { runTyped(i: unknown): Promise<unknown> }).runTyped({
        message: 'again',
      });
    },
  },
  ...memoryCases(),
  {
    feature: 'the evidence gate (names and numbers)',
    canaries: ['CANARY-GATE-ARG', 'CANARY-GATE-ROW', '987654321'],
    build: (redact) =>
      create(
        mock({
          chunkDelayMs: 0,
          replies: [
            { toolCalls: [{ id: 'c1', name: 'lookup', args: { id: 'CANARY-GATE-ARG' } }] },
            { content: 'The count is 987654321.' },
            { content: 'The count is 987654321, still.' },
          ],
        }),
        redact,
      )
        .tool(lookup(() => ({ rows: ['CANARY-GATE-ROW'] })))
        .namesAndNumbersFromEvidence()
        .build(),
    drive: (agent) => agent.run({ message: 'count them' }),
  },
  {
    // The figures dial names what the answer computed, with its operands.
    feature: 'the evidence gate (names and numbers) — figures',
    canaries: ['7,654,322', '71.3'],
    build: (redact) =>
      create(
        mock({
          chunkDelayMs: 0,
          replies: [
            { toolCalls: [{ id: 'c1', name: 'sales', args: { id: 'q3' } }] },
            { content: 'Q3 revenue was about 7,654,322 dollars, 71.3% of it online.' },
            { content: 'Q3 revenue was about 7,654,322 dollars, 71.3% of it online.' },
          ],
        }),
        redact,
      )
        .tool(
          defineTool<{ id: string }, unknown>({
            name: 'sales',
            description: 'Sales figures.',
            inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
            execute: () => ({ revenue: 7654321.6, online: 5457531.0, store: 2196790.6 }),
          }),
        )
        .namesAndNumbersFromEvidence({ figures: true })
        .build(),
    drive: (agent) => agent.run({ message: 'Q3?' }),
  },
  {
    // A tool argument the schema refuses is quoted back in the validation issue.
    feature: 'tools (arguments, results, tool-result rules, a paused call) — argument validation',
    canaries: ['CANARY-BADARG'],
    build: (redact) =>
      create(
        mock({
          chunkDelayMs: 0,
          replies: [
            { toolCalls: [{ id: 'c1', name: 'lookup', args: { code: 'CANARY-BADARG-1234' } }] },
            { content: 'done' },
          ],
        }),
        redact,
      )
        .tool(
          defineTool<{ code: string }, unknown>({
            name: 'lookup',
            description: 'Look up by numeric code.',
            inputSchema: {
              type: 'object',
              properties: { code: { type: 'string', pattern: '^[0-9]+$' } },
              required: ['code'],
            },
            execute: () => 'ok',
          }),
        )
        .build(),
    drive: (agent) => agent.run({ message: 'look it up' }),
  },
  {
    // A person approves a call: the evidence pack quotes the model, the
    // arguments and the task; the decision carries the person's note.
    feature: 'a person approving a call (check-in)',
    canaries: ['CANARY-CI-USER', 'CANARY-CI-ARG', 'CANARY-CI-NOTE', 'CANARY-CI-MODELTEXT'],
    build: (redact) =>
      create(
        {
          name: 'mock',
          complete: async (req: { messages: { role: string }[] }): Promise<LLMResponse> =>
            req.messages.some((m) => m.role === 'tool')
              ? {
                  content: 'done',
                  toolCalls: [],
                  usage: { input: 1, output: 1 },
                  stopReason: 'stop',
                }
              : {
                  content: 'I will refund CANARY-CI-MODELTEXT',
                  toolCalls: [
                    {
                      id: 't1',
                      name: 'issue_refund',
                      args: { amount: 500, reason: 'CANARY-CI-ARG' },
                    },
                  ],
                  usage: { input: 1, output: 1 },
                  stopReason: 'tool_use',
                },
        } as unknown as LLMProvider,
        redact,
      )
        .tool(
          defineTool<{ amount: number; reason: string }, string>({
            name: 'issue_refund',
            description: 'Refund.',
            inputSchema: {
              type: 'object',
              properties: { amount: { type: 'number' }, reason: { type: 'string' } },
            },
            checkIn: 'always',
            execute: ({ amount }) => `refunded ${amount}`,
          } as never),
        )
        .checkIn({ evidence: 'standard' })
        .build(),
    drive: async (agent) => {
      const outcome = await agent.run({ message: 'please refund me, CANARY-CI-USER order' });
      if (!isPaused(outcome)) throw new Error('the case must pause for the check-in');
      return agent.resume(
        outcome.checkpoint,
        checkInApproved({ by: 'ops', note: 'ok per CANARY-CI-NOTE' }),
      );
    },
  },
  {
    // A skill graph routes on a matcher: the words it matched are its witness.
    feature: 'skill graphs (routing on the person’s words)',
    canaries: ['CANARY-SG-4242'],
    build: (redact) =>
      create(mock({ chunkDelayMs: 0, reply: 'ok' }), redact)
        .system('You are support.')
        .skillGraph(
          skillGraph()
            .entry(defineSkill({ id: 'vip', description: 'vip desk', body: 'vip body' }), {
              match: /vip CANARY-SG-\d+/,
            })
            .entry(defineSkill({ id: 'other', description: 'other', body: 'other body' }))
            .build(),
        )
        .build(),
    drive: (agent) => agent.run({ message: 'hello, vip CANARY-SG-4242 here' }),
  },
];

/** Memory and retrieval: a store seeded by an earlier turn (or an indexed corpus). */
function memoryCases(): FeatureCase[] {
  const episodic = (redact: RedactionPolicy | undefined): BuiltAgent => {
    const memory = defineMemory({
      id: 'chat',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store: new InMemoryStore(),
    });
    return Agent.create({
      provider: mock({ chunkDelayMs: 0, reply: 'noted CANARY-MEM-ANSWER' }),
      model: 'mock',
      recordSystemPrompt: true,
      ...(redact && { redact }),
    } as never)
      .system('You help.')
      .memory(memory)
      .build();
  };
  const semantic = (redact: RedactionPolicy | undefined, kind: 'extract' | 'topK'): BuiltAgent => {
    const memory = defineMemory({
      id: 'facts',
      type: MEMORY_TYPES.SEMANTIC,
      strategy:
        kind === 'extract'
          ? { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' }
          : { kind: MEMORY_STRATEGIES.TOP_K, topK: 3, threshold: -1, embedder: mockEmbedder() },
      store: new InMemoryStore(
        kind === 'topK' ? ({ embedder: mockEmbedder() } as never) : undefined,
      ),
    } as never);
    return create(mock({ chunkDelayMs: 0, reply: 'ok' }), redact)
      .memory(memory)
      .build();
  };
  const summarize = (redact: RedactionPolicy | undefined): BuiltAgent => {
    const memory = defineMemory({
      id: 'long',
      type: MEMORY_TYPES.EPISODIC,
      strategy: {
        kind: MEMORY_STRATEGIES.SUMMARIZE,
        recent: 4,
        size: 8,
        llm: {
          name: 'summarizer',
          complete: async () => ({
            content: 'summary: CANARY-SUMMARY',
            toolCalls: [],
            usage: { input: 1, output: 1 },
          }),
        },
        model: 'mock-small',
      },
      store: new InMemoryStore(),
    } as never);
    // Long turns: a summary replaces a span only when it is shorter than the span.
    const reply = `Noted. ${'I have the details for that period and can walk through them. '.repeat(
      4,
    )}`;
    return create(mock({ chunkDelayMs: 0, reply }), redact)
      .memory(memory)
      .build();
  };
  const twoTurns =
    (first: string, second: string) =>
    async (agent: BuiltAgent): Promise<void> => {
      const identity = { conversationId: 'c-1' };
      await agent.run({ message: first }, { identity } as never);
      await agent.run({ message: second }, { identity } as never);
    };
  return [
    {
      feature: 'memory (episodic, semantic, summarize, top-k) and retrieval (RAG) — episodic',
      canaries: ['CANARY-MEM-EARLIER', 'CANARY-MEM-ANSWER'],
      build: episodic,
      drive: twoTurns('remember CANARY-MEM-EARLIER', 'what did I say?'),
    },
    {
      feature:
        'memory (episodic, semantic, summarize, top-k) and retrieval (RAG) — semantic extract',
      canaries: ['CANARY-FACT'],
      build: (redact) => semantic(redact, 'extract'),
      drive: twoTurns('My name is CANARY-FACT.', 'who am I?'),
    },
    {
      feature: 'memory (episodic, semantic, summarize, top-k) and retrieval (RAG) — top-k',
      canaries: ['CANARY-TOPK'],
      build: (redact) => semantic(redact, 'topK'),
      drive: twoTurns('I like CANARY-TOPK', 'what do I like?'),
    },
    {
      feature: 'memory (episodic, semantic, summarize, top-k) and retrieval (RAG) — summarize',
      canaries: ['CANARY-SUMMARY', 'CANARY-LONG'],
      build: summarize,
      drive: async (agent) => {
        const identity = { conversationId: 'c-1' };
        for (let i = 0; i < 9; i++) {
          const message = `turn ${i} CANARY-LONG ${'and here is more of what I meant. '.repeat(4)}`;
          await agent.run({ message, identity } as never);
        }
      },
    },
    {
      feature: 'memory (episodic, semantic, summarize, top-k) and retrieval (RAG) — RAG',
      canaries: ['CANARY-DOC'],
      build: (redact) => {
        const store = new InMemoryStore();
        const embedder = mockEmbedder();
        const indexed = indexDocuments(
          store,
          embedder,
          [{ id: 'policy.md#0', content: 'refunds CANARY-DOC', metadata: { source: 'policy.md' } }],
          { embedderId: embedder.id } as never,
        );
        const agent = create(mock({ chunkDelayMs: 0, reply: 'per the docs' }), redact)
          .rag(defineRAG({ id: 'docs', store, embedder, threshold: -1, topK: 3 } as never))
          .build();
        // The corpus is indexed before the first run reads it.
        (agent as unknown as { ready: Promise<unknown> }).ready = indexed;
        return agent;
      },
      drive: async (agent) => {
        await (agent as unknown as { ready: Promise<unknown> }).ready;
        await agent.run({ message: 'refunds?' });
      },
    },
  ];
}

describe('conversationRedaction — the vocabulary, per feature', () => {
  it('every feature the vocabulary claims has a case here', () => {
    const covered = new Set(CASES.map((c) => c.feature.split(' — ')[0]));
    for (const feature of CONVERSATION_FEATURES) {
      if (feature.startsWith('compositions')) continue; // agent-redaction.propagation.test.ts
      expect(covered.has(feature), feature).toBe(true);
    }
  });

  for (const c of CASES) {
    describe(c.feature, () => {
      it('CONTROL — without a policy, every canary reaches a record', async () => {
        const served = await serve(c.build(undefined), c.drive);
        const hit = reached(served, c.canaries);
        expect(Object.keys(hit).sort()).toEqual([...c.canaries].sort());
      });

      it('under conversationRedaction(): no canary in any record, the same events, a told account', async () => {
        const control = await serve(c.build(undefined), c.drive);
        const served = await serve(c.build(conversationRedaction()), c.drive);
        expect(reached(served, c.canaries)).toEqual({});
        expect(served.types).toEqual(control.types);
        const account = served.artifacts.account as {
          summary: { sentence: { template: { id: string } } };
        };
        expect(account.summary.sentence.template.id).not.toBe('scope.keptOut');
      });
    });
  }
});

describe('the relayed writes hold under deferred observer delivery', () => {
  // `context.injected` / `slot_composed` are derived from the slots' writes,
  // relayed to the run as they are written (`runRedaction.ts` ·
  // `setEventSource`). With delivery one beat behind, the recorder still takes
  // each relayed value with the write it came with.
  const run = async (redact: RedactionPolicy | undefined) => {
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          { toolCalls: [{ id: 'c1', name: 'lookup', args: { id: 'CANARY-DEFERRED-ARG' } }] },
          { content: 'answered CANARY-DEFERRED-ANSWER' },
        ],
      }),
      model: 'mock',
      maxIterations: 4,
      observerDelivery: 'deferred',
      ...(redact && { redact }),
    })
      .system('You help.')
      .tool(lookup(() => ({ rows: ['CANARY-DEFERRED-RESULT'] })))
      .build();
    return serve(agent, (a) => a.run({ message: 'CANARY-DEFERRED-ASK' }));
  };

  it('the same events, context ones included, and no canary', async () => {
    const control = await run(undefined);
    const served = await run(conversationRedaction());
    expect(control.types).toContain('agentfootprint.context.injected');
    expect(served.types).toEqual(control.types);
    expect(
      reached(served, [
        'CANARY-DEFERRED-ASK',
        'CANARY-DEFERRED-ARG',
        'CANARY-DEFERRED-RESULT',
        'CANARY-DEFERRED-ANSWER',
      ]),
    ).toEqual({});
  });
});

describe('a policy that names a slot key keeps its derived events’ content out', () => {
  // The slot's injection records reach the context recorder through the relay
  // (real); a policy that selects the KEY — not the records' own field names —
  // still keeps their content out of every `context.*` event, and keeps the
  // events themselves (`ContextRecorder · structureOf`).
  const run = (redact: RedactionPolicy | undefined) =>
    serve(
      Agent.create({
        provider: mock({ chunkDelayMs: 0, reply: 'ok' }),
        model: 'mock',
        ...(redact && { redact }),
      })
        .system('System CANARY-SLOT-SYSTEM')
        .build(),
      (a) => a.run({ message: 'Please find CANARY-SLOT-USER' }),
    );

  it('the same events, structure kept, no slot content anywhere', async () => {
    const control = await run(undefined);
    const served = await run({
      keys: [
        'systemPromptInjections',
        'messagesInjections',
        'history',
        'messages',
        'userMessage',
        'userPrompt',
        'message',
        'newMessages',
        'content',
        'llmLatestContent',
        'finalContent',
      ],
    });
    expect(Object.keys(reached(control, ['CANARY-SLOT-USER', 'CANARY-SLOT-SYSTEM']))).toHaveLength(
      2,
    );
    expect(served.types).toEqual(control.types);
    const injected = (served.artifacts.events as AgentfootprintEvent[]).filter(
      (e) => e.type === 'agentfootprint.context.injected',
    );
    expect(injected.length).toBeGreaterThan(0);
    for (const event of injected) {
      const payload = event.payload as unknown as Record<string, unknown>;
      expect(payload.slot).toBeDefined();
      expect(payload.contentHash).toBeDefined();
      expect(payload.contentSummary).toBe('[REDACTED]');
    }
    expect(
      reached({ artifacts: { events: served.artifacts.events } } as Served, [
        'CANARY-SLOT-USER',
        'CANARY-SLOT-SYSTEM',
      ]),
    ).toEqual({});
  });
});

describe('conversationRedaction() — the value', () => {
  it('is one frozen policy, the same object every call', () => {
    const policy = conversationRedaction();
    expect(conversationRedaction()).toBe(policy);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(policy.keys).toEqual(expect.arrayContaining(['history', 'result', 'args', 'content']));
    expect(policy.patterns?.some((p) => p.test('memoryInjection_chat'))).toBe(true);
  });

  it('joins your names onto the library’s — never replacing them', () => {
    const joined = conversationRedaction({ keys: ['accountNumber'], patterns: [/ssn/i] });
    expect(Object.isFrozen(joined)).toBe(true);
    expect(joined.keys).toEqual(expect.arrayContaining(['history', 'accountNumber']));
    expect(joined.patterns?.some((p) => p.test('ssn'))).toBe(true);
    expect(joined.patterns?.some((p) => p.test('memoryInjection_chat'))).toBe(true);
  });

  it('refuses what `redact` itself refuses', () => {
    expect(() => conversationRedaction({} as RedactionPolicy)).toThrow(/names nothing/);
    expect(() => conversationRedaction({ keys: 'ssn' } as never)).toThrow(/conversationRedaction/);
  });
});

describe('the vocabulary agrees with the audit export on what is content', () => {
  it('every field the audit bounds as content is a name the vocabulary keeps out', () => {
    // Two owners say what is content: the audit export's bounded mode (per
    // event type) and this vocabulary (by name). A field one calls content and
    // the other does not would be a hole one of them misses.
    const policy = conversationRedaction();
    const kept = (name: string) =>
      (policy.keys ?? []).includes(name) || (policy.patterns ?? []).some((p) => p.test(name));
    const missing = boundedContentFieldNames().filter((name) => !kept(name));
    expect(missing).toEqual([]);
  });

  it('every DERIVED row names a real event, and the vocabulary keeps out a value it comes from', () => {
    // The other direction of the same question: content the library quotes
    // under a name of its own is kept out with its source (`served.ts` ·
    // `DERIVED`). A row whose event does not exist, or whose sources the
    // vocabulary never names, would never fire under `conversationRedaction()`.
    const policy = conversationRedaction();
    const kept = (name: string) =>
      (policy.keys ?? []).includes(name) || (policy.patterns ?? []).some((p) => p.test(name));
    const types = new Set<string>(ALL_EVENT_TYPES);
    const rows = derivedRows();
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((row) => !types.has(row.type)).map((row) => row.type)).toEqual([]);
    expect(rows.filter((row) => !row.from.some(kept)).map((row) => row.type)).toEqual([]);
  });
});
