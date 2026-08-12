/**
 * EPISODIC × SUMMARIZE, end to end (9.14.0) — the 9.5.0 probe, INVERTED.
 *
 * The 9.5.0 finding was a counting provider driven through eight turns of a
 * `{ kind: 'summarize', recent, llm }` memory that made **zero** `complete()`
 * calls: the stage existed, the pipeline never composed it, and the required
 * `llm` was never called. The caveat was written into
 * `listMemoryStrategies()`, the docs table, MENTAL_MODEL.md and AGENTS.md
 * rather than into the behaviour.
 *
 * This file is that probe with the assertion turned around, plus the things a
 * strategy that really spends money has to prove: that it spends it ONCE per
 * span (write-back), that the originals it compressed are still there, that a
 * broken summarizer degrades to `window` instead of failing the turn, and that
 * every way of misconfiguring the summarizer is refused where it is written.
 *
 * @see src/memory/stages/summarize.ts
 * @see test/memory/stages/summarize.test.ts   the stage's own 7-pattern file
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/core/Agent.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES } from '../../src/memory/index.js';
import { InMemoryStore } from '../../src/memory/store/index.js';
import { SUMMARY_ID_PREFIX, summaryCoverage } from '../../src/memory/stages/summarize.js';
import type { LLMMessage, LLMProvider, LLMRequest } from '../../src/adapters/types.js';

const IDENTITY = { conversationId: 'summarize-e2e' };

/** Long enough that compressing it is a real saving — see the latch. */
function userTurn(n: number): string {
  return (
    `Turn ${n}: I want to go over the billing history for the account again, because the ` +
    `invoice for last month still does not match what the dashboard showed me at the time.`
  );
}

/** Distinct per turn — an assertion about exclusion needs distinguishable text. */
function assistantReply(n: number): string {
  return (
    `Reply ${n}: I have pulled up the invoice and the dashboard snapshot for that period and ` +
    `can walk through the difference line by line whenever you are ready.`
  );
}

/** The summarizer, counting every call the way the 9.5.0 probe did. */
function countingSummarizer(reply = 'Billing history reviewed; invoice mismatch still open.') {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'counting-summarizer',
    complete: async (req) => {
      requests.push(req);
      return { content: reply, toolCalls: [], usage: { input: 200, output: 30 } };
    },
  };
  return { provider, requests };
}

/** The MAIN model, recording the system prompt each turn so recall is visible. */
function recordingAgentProvider() {
  const systemPrompts: string[] = [];
  let turn = 0;
  const provider: LLMProvider = {
    name: 'recording-agent',
    complete: async (req) => {
      systemPrompts.push(req.systemPrompt ?? '');
      turn += 1;
      return { content: assistantReply(turn), toolCalls: [], usage: { input: 50, output: 20 } };
    },
  };
  return { provider, systemPrompts };
}

function summarizeMemory(
  store: InMemoryStore,
  llm: LLMProvider,
  overrides: { recent?: number; size?: number } = {},
) {
  return defineMemory({
    id: 'long-chat',
    type: MEMORY_TYPES.EPISODIC,
    strategy: {
      kind: MEMORY_STRATEGIES.SUMMARIZE,
      recent: overrides.recent ?? 4,
      size: overrides.size ?? 8,
      llm,
      model: 'mock-haiku',
    },
    store,
  });
}

async function runTurns(agent: { run: (input: unknown) => Promise<unknown> }, count: number) {
  for (let turn = 1; turn <= count; turn++) {
    await agent.run({ message: userTurn(turn), identity: IDENTITY });
  }
}

// ── Integration — the inverted probe ────────────────────────

describe('EPISODIC × SUMMARIZE — the summarizer runs (9.14.0)', () => {
  it('eight turns through a counting summarizer make MORE than zero complete() calls', async () => {
    const store = new InMemoryStore();
    const { provider: summarizer, requests } = countingSummarizer();
    const { provider: main } = recordingAgentProvider();
    const agent = Agent.create({ provider: main, model: 'main-model', maxIterations: 1 })
      .memory(summarizeMemory(store, summarizer))
      .build();

    await runTurns(agent, 8);

    // The 9.5.0 assertion was `toBe(0)`. That was the bug, written down.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0].model).toBe('mock-haiku');
  });

  it('the summary is WRITTEN BACK to the store under a deterministic id', async () => {
    const store = new InMemoryStore();
    const { provider: summarizer } = countingSummarizer();
    const { provider: main } = recordingAgentProvider();
    const agent = Agent.create({ provider: main, model: 'main-model', maxIterations: 1 })
      .memory(summarizeMemory(store, summarizer))
      .build();

    await runTurns(agent, 8);

    const { entries } = await store.list(IDENTITY, { limit: 100 });
    const summaries = entries.filter((e) => e.id.startsWith(SUMMARY_ID_PREFIX));
    expect(summaries.length).toBeGreaterThan(0);
    const coverage = summaryCoverage(summaries[0]);
    expect(coverage?.model).toBe('mock-haiku');
    expect(coverage?.coveredIds.length).toBeGreaterThan(1);
    // The id names the range, so a re-fold of the same range overwrites
    // rather than accumulating a second copy of the same claim.
    expect(summaries[0].id).toBe(`msg-summary-${coverage?.fromTurn}-${coverage?.toTurn}`);
  });

  it('the covered originals are excluded from recall — and still in the store', async () => {
    const store = new InMemoryStore();
    const { provider: summarizer } = countingSummarizer();
    const { provider: main, systemPrompts } = recordingAgentProvider();
    const agent = Agent.create({ provider: main, model: 'main-model', maxIterations: 1 })
      .memory(summarizeMemory(store, summarizer))
      .build();

    await runTurns(agent, 8);

    const lastPrompt = systemPrompts[systemPrompts.length - 1];
    // The claim reached the prompt…
    expect(lastPrompt).toContain('Billing history reviewed');
    expect(lastPrompt).toContain('[summary of earlier turns');
    // …and the turns it stands for did not.
    const { entries } = await store.list(IDENTITY, { limit: 100 });
    const summary = entries.find((e) => e.id.startsWith(SUMMARY_ID_PREFIX));
    const covered = new Set(summaryCoverage(summary!)?.coveredIds ?? []);
    for (const id of covered) {
      const original = entries.find((e) => e.id === id);
      // Never deleted: a summary is a claim about the past, not a deletion.
      expect(original).toBeDefined();
      const text = String((original!.value as LLMMessage).content ?? '');
      if (text.length > 0) expect(lastPrompt).not.toContain(text);
    }
  });

  it('the recent turns survive VERBATIM alongside the summary', async () => {
    const store = new InMemoryStore();
    const { provider: summarizer } = countingSummarizer();
    const { provider: main, systemPrompts } = recordingAgentProvider();
    const agent = Agent.create({ provider: main, model: 'main-model', maxIterations: 1 })
      .memory(summarizeMemory(store, summarizer))
      .build();

    await runTurns(agent, 8);

    const lastPrompt = systemPrompts[systemPrompts.length - 1];
    // Turn 7 is inside the verbatim tail on the eighth turn's recall.
    expect(lastPrompt).toContain(userTurn(7));
  });

  it('a span is bought ONCE, ever — no two folds cover the same entry', async () => {
    const store = new InMemoryStore();
    const { provider: summarizer, requests } = countingSummarizer();
    const { provider: main } = recordingAgentProvider();
    const agent = Agent.create({ provider: main, model: 'main-model', maxIterations: 1 })
      .memory(summarizeMemory(store, summarizer))
      .build();

    await runTurns(agent, 8);

    const { entries } = await store.list(IDENTITY, { limit: 100 });
    const summaries = entries.filter((e) => e.id.startsWith(SUMMARY_ID_PREFIX));
    // One stored entry per call: nothing was folded and thrown away, and
    // nothing was folded twice under two different ids.
    expect(summaries).toHaveLength(requests.length);

    const seen = new Set<string>();
    for (const summary of summaries) {
      for (const id of summaryCoverage(summary)?.coveredIds ?? []) {
        expect(seen.has(id), `${id} was folded twice`).toBe(false);
        seen.add(id);
      }
    }
    // And no summary ever folds another summary — a claim about a claim would
    // double-count the same turns under two ids.
    for (const summary of summaries) {
      for (const id of summaryCoverage(summary)?.coveredIds ?? []) {
        expect(id.startsWith(SUMMARY_ID_PREFIX)).toBe(false);
      }
    }
  });

  it('a FRESH agent per turn — the per-request process shape — keeps the same books', async () => {
    const store = new InMemoryStore();
    const { provider: summarizer, requests } = countingSummarizer();
    const { provider: main } = recordingAgentProvider();

    // New Agent instance every turn, same store, same conversationId: nothing
    // is counted in a variable, so everything this asserts comes from storage.
    for (let turn = 1; turn <= 8; turn++) {
      const agent = Agent.create({ provider: main, model: 'main-model', maxIterations: 1 })
        .memory(summarizeMemory(store, summarizer))
        .build();
      await agent.run({ message: userTurn(turn), identity: IDENTITY });
    }

    const { entries } = await store.list(IDENTITY, { limit: 100 });
    const summaries = entries.filter((e) => e.id.startsWith(SUMMARY_ID_PREFIX));
    expect(summaries).toHaveLength(requests.length);
    expect(summaries.length).toBeGreaterThan(0);
    // Turn numbering survived the fresh instances (`resolveTurnNumber`), so
    // the ranges are ordered and never restart at 1.
    const ranges = summaries
      .map((s) => summaryCoverage(s)!)
      .sort((a, b) => a.fromTurn - b.fromTurn);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].fromTurn).toBeGreaterThan(ranges[i - 1].toTurn);
    }
  });
});

// ── Honesty — the ways it declines ──────────────────────────

describe('EPISODIC × SUMMARIZE — a broken summarizer degrades to window, loudly', () => {
  it('the turn still answers, recall is verbatim, and exactly one warning is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new InMemoryStore();
    const broken: LLMProvider = {
      name: 'broken-summarizer',
      complete: async () => {
        throw new Error('summarizer is down');
      },
    };
    const { provider: main, systemPrompts } = recordingAgentProvider();
    const agent = Agent.create({ provider: main, model: 'main-model', maxIterations: 1 })
      .memory(summarizeMemory(store, broken))
      .build();

    await runTurns(agent, 6);

    // Every turn answered — a compressor being down is not a memory outage.
    expect(systemPrompts).toHaveLength(6);
    // …and the memory kept working as `window`: the raw turns are recalled.
    expect(systemPrompts[systemPrompts.length - 1]).toContain(userTurn(5));
    // Loud, and once: a summarizer that is down is down for the run.
    const summarizerWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes('summarizer threw'),
    );
    expect(summarizerWarnings).toHaveLength(1);
    expect(String(summarizerWarnings[0][0])).toContain('summarizer is down');
    // Nothing was written back — there is nothing to write back.
    const { entries } = await store.list(IDENTITY, { limit: 100 });
    expect(entries.filter((e) => e.id.startsWith(SUMMARY_ID_PREFIX))).toHaveLength(0);
    warn.mockRestore();
  });

  it('emits memory.strategy_applied with a reason a reader can act on', async () => {
    const store = new InMemoryStore();
    const { provider: summarizer } = countingSummarizer();
    const { provider: main } = recordingAgentProvider();
    const events: { reason: string; strategyId: string; addedIds: readonly string[] }[] = [];
    const agent = Agent.create({ provider: main, model: 'main-model', maxIterations: 1 })
      .memory(summarizeMemory(store, summarizer))
      .build();
    agent.on('agentfootprint.memory.strategy_applied', (e) => {
      events.push(e.payload as unknown as (typeof events)[number]);
    });

    await runTurns(agent, 8);

    expect(events.length).toBeGreaterThan(0);
    const fold = events.find((e) => e.addedIds.length > 0);
    expect(fold?.strategyId).toBe('long-chat');
    expect(fold?.reason).toMatch(/folded \d+ entries/);
    expect(fold?.reason).toContain('written back');
  });
});

// ── Security — the refusals, at the door they belong to ─────

describe('EPISODIC × SUMMARIZE — refusals', () => {
  const store = (): InMemoryStore => new InMemoryStore();

  it('a summarizer with no model is refused at defineMemory, naming both bad defaults', () => {
    let message = '';
    try {
      defineMemory({
        id: 'no-model',
        type: MEMORY_TYPES.EPISODIC,
        strategy: {
          kind: MEMORY_STRATEGIES.SUMMARIZE,
          recent: 4,
          llm: mock({ reply: 'summary' }),
        } as never,
        store: store(),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('defineMemory[no-model]');
    expect(message).toContain('quietly billed your MAIN model');
    expect(message).toContain('never heard of');
    expect(message).toMatch(/model: 'claude-haiku-4-5'/);
  });

  it('no summarizer at all is still answered by the `llm` refusal, not the `model` one', () => {
    expect(() =>
      defineMemory({
        id: 'no-llm',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.SUMMARIZE, recent: 4 } as never,
        store: store(),
      }),
    ).toThrow(/names an `llm`/);
  });

  it('a verbatim tail as large as the window is refused — nothing could ever fold', () => {
    expect(() =>
      defineMemory({
        id: 'no-room',
        type: MEMORY_TYPES.EPISODIC,
        strategy: {
          kind: MEMORY_STRATEGIES.SUMMARIZE,
          recent: 20,
          size: 20,
          llm: mock({ reply: 'summary' }),
          model: 'mock-haiku',
        },
        store: store(),
      }),
    ).toThrow(/never have anything to fold/);
  });

  it('readOnly is refused — the write-back IS the cost model', () => {
    expect(() =>
      defineMemory({
        id: 'read-only',
        type: MEMORY_TYPES.EPISODIC,
        strategy: {
          kind: MEMORY_STRATEGIES.SUMMARIZE,
          recent: 4,
          llm: mock({ reply: 'summary' }),
          model: 'mock-haiku',
        },
        store: store(),
        readOnly: true,
      }),
    ).toThrow(/cannot be `readOnly`/);
  });

  it("the agent's OWN instance at its OWN model is refused at .memory() — the 8.14.0 rule", () => {
    const shared = mock({ reply: 'ok' });
    const memory = defineMemory({
      id: 'self-summarizing',
      type: MEMORY_TYPES.EPISODIC,
      strategy: {
        kind: MEMORY_STRATEGIES.SUMMARIZE,
        recent: 4,
        llm: shared,
        model: 'main-model',
      },
      store: store(),
    });

    expect(() => Agent.create({ provider: shared, model: 'main-model' }).memory(memory)).toThrow(
      /own provider INSTANCE and the agent's own model/,
    );
  });

  it('a SECOND instance of the same vendor at the same model is allowed — deliberately narrow', () => {
    const memory = defineMemory({
      id: 'own-instance',
      type: MEMORY_TYPES.EPISODIC,
      strategy: {
        kind: MEMORY_STRATEGIES.SUMMARIZE,
        recent: 4,
        llm: mock({ reply: 'summary' }), // a different object
        model: 'main-model', // the same model id
      },
      store: store(),
    });

    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'main-model' }).memory(memory),
    ).not.toThrow();
  });

  it('the window strategy is untouched by the memory check — no false positive', () => {
    const shared = mock({ reply: 'ok' });
    const memory = defineMemory({
      id: 'window-memory',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store: store(),
    });
    expect(() => Agent.create({ provider: shared, model: 'm' }).memory(memory)).not.toThrow();
  });
});
