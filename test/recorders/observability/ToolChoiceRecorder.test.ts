/**
 * toolChoiceRecorder (RFC-002 C4–C6) — all Convention-3 tiers.
 *
 * Unit tests drive the hooks with REAL engine event shapes (EmitEvent +
 * the typed payloads from events/payloads.ts — never fabricated field
 * names; see the #5 lesson). The functional test runs a real Agent on
 * the mock provider and proves the lazy-embed contract end-to-end.
 */
import { describe, expect, it } from 'vitest';
import type { EmitEvent, LLMProvider } from 'footprintjs';
import { Agent, defineTool } from '../../../src/index'
import { mock } from '../../../src/llm-providers.js';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import type { Embedder } from '../../../src/lib/influence-core';
import {
  buildChoiceContext,
  toolChoiceRecorder,
} from '../../../src/recorders/observability/ToolChoiceRecorder';

// ── real event shapes ────────────────────────────────────────────────

const TURN_START = 'agentfootprint.agent.turn_start';
const TURN_END = 'agentfootprint.agent.turn_end';
const LLM_START = 'agentfootprint.stream.llm_start';
const LLM_END = 'agentfootprint.stream.llm_end';
const TOOL_START = 'agentfootprint.stream.tool_start';

function ev(name: string, payload: unknown, runtimeStageId = 'call-llm#1'): EmitEvent {
  return {
    name,
    payload,
    stageName: 'call-llm',
    runtimeStageId,
    subflowPath: [],
    pipelineId: 'run-1',
    timestamp: 0,
  };
}

const OFFERED = [
  { name: 'get_fcns_database', description: 'FC Name Server DB — registered N_Ports, live.' },
  {
    name: 'influx_get_fcns_database',
    description: 'FC Name Server registrations — time-series history.',
  },
  { name: 'send_email', description: 'Sends a notification email after a report completes.' },
];

function llmStart(
  runtimeStageId: string,
  iteration: number,
  tools: typeof OFFERED | [] = OFFERED,
): EmitEvent {
  // Real LLMStartPayload fields (events/payloads.ts).
  return ev(
    LLM_START,
    {
      iteration,
      provider: 'mock',
      model: 'mock',
      systemPromptChars: 10,
      messagesCount: 1,
      toolsCount: tools.length,
      ...(tools.length > 0 ? { tools } : {}),
    },
    runtimeStageId,
  );
}

function llmEnd(runtimeStageId: string, iteration: number, content: string): EmitEvent {
  return ev(
    LLM_END,
    {
      iteration,
      content,
      toolCallCount: 0,
      usage: { input: 10, output: 5 },
      stopReason: 'stop',
      durationMs: 1,
    },
    runtimeStageId,
  );
}

function toolStart(toolName: string, toolCallId: string, parallelCount?: number): EmitEvent {
  return ev(
    TOOL_START,
    { toolName, toolCallId, args: {}, ...(parallelCount ? { parallelCount } : {}) },
    'tool-calls#2',
  );
}

function runStart(runId: string): { traversalContext: { runId: string } } {
  return { traversalContext: { runId } };
}

/** Embedder wrapper that counts every embedding call (lazy-embed proof). */
function countingEmbedder(inner: Embedder = mockEmbedder()): Embedder & { calls: () => number } {
  let calls = 0;
  return {
    dimensions: inner.dimensions,
    embed: async (args) => {
      calls += 1;
      return inner.embed(args);
    },
    embedBatch: async (args) => {
      calls += 1;
      return inner.embedBatch!(args);
    },
    calls: () => calls,
  };
}

/** Exact-geometry embedder for deterministic flag tests. */
function plantedEmbedder(vectors: ReadonlyArray<readonly [string, number[]]>): Embedder {
  const lookup = (text: string): number[] => {
    for (const [key, vec] of vectors) if (text.includes(key)) return vec;
    return [1, 1, 1];
  };
  return {
    dimensions: 3,
    embed: async ({ text }) => lookup(text),
    embedBatch: async ({ texts }) => texts.map(lookup),
  };
}

// ── unit: capture semantics ──────────────────────────────────────────

describe('toolChoiceRecorder — capture (unit, real event shapes)', () => {
  it('records one entry per LLM call that OFFERED tools, keyed by runtimeStageId', async () => {
    const rec = toolChoiceRecorder({ embedder: mockEmbedder() });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'why did port fc1/3 drop?' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onEmit(llmEnd('call-llm#1', 1, 'I will check the name server.'));
    rec.onEmit(toolStart('get_fcns_database', 'c1'));
    rec.onEmit(
      ev(TURN_END, {
        turnIndex: 0,
        finalContent: '',
        totalInputTokens: 1,
        totalOutputTokens: 1,
        iterationCount: 1,
        durationMs: 1,
      }),
    );

    const calls = await rec.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].runtimeStageId).toBe('call-llm#1');
    expect(calls[0].iteration).toBe(1);
    expect(calls[0].offered.map((t) => t.name)).toEqual(OFFERED.map((t) => t.name));
    expect(calls[0].chosen).toEqual(['get_fcns_database']);
  });

  it('ignores LLM calls with no tools (no menu — nothing to confuse)', async () => {
    const rec = toolChoiceRecorder({ embedder: mockEmbedder() });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'hi' }));
    rec.onEmit(llmStart('call-llm#1', 1, []));
    rec.onRunEnd({});
    expect(await rec.getCalls()).toHaveLength(0);
  });

  it('parallel tool calls: all toolCallIds kept, chosen deduped by name, in first-call order', async () => {
    const rec = toolChoiceRecorder({ embedder: mockEmbedder() });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'sweep the fabric' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onEmit(toolStart('influx_get_fcns_database', 'c1', 3));
    rec.onEmit(toolStart('get_fcns_database', 'c2', 3));
    rec.onEmit(toolStart('influx_get_fcns_database', 'c3', 3)); // repeat call, same tool
    rec.onRunEnd({});

    const [call] = await rec.getCalls();
    expect(call.toolCallIds).toEqual(['c1', 'c2', 'c3']);
    expect(call.chosen).toEqual(['influx_get_fcns_database', 'get_fcns_database']);
  });

  it('a loop: each llm_start opens its own entry; tool_starts bind to the latest', async () => {
    const rec = toolChoiceRecorder({ embedder: mockEmbedder() });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'drill down' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onEmit(toolStart('get_fcns_database', 'c1'));
    rec.onEmit(llmStart('call-llm#5', 2));
    rec.onEmit(toolStart('send_email', 'c2'));
    rec.onRunEnd({});

    const calls = await rec.getCalls();
    expect(calls.map((c) => [c.runtimeStageId, ...c.chosen])).toEqual([
      ['call-llm#1', 'get_fcns_database'],
      ['call-llm#5', 'send_email'],
    ]);
  });

  it('redacted payloads (string) are skipped without throwing', async () => {
    const rec = toolChoiceRecorder({ embedder: mockEmbedder() });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(LLM_START, '[REDACTED]'));
    rec.onRunEnd({});
    expect(await rec.getCalls()).toHaveLength(0);
  });
});

// ── C4: the choice context ───────────────────────────────────────────

describe('buildChoiceContext — the C4 construction spec', () => {
  it('iteration 1: user slot only', () => {
    expect(buildChoiceContext({ userPrompt: 'why did fc1/3 drop?' })).toBe(
      'user: why did fc1/3 drop?',
    );
  });

  it('later iterations: user head + assistant tail', () => {
    expect(
      buildChoiceContext({ userPrompt: 'why?', latestAssistantText: 'checking the FLOGI DB' }),
    ).toBe('user: why?\n\nassistant: checking the FLOGI DB');
  });

  it('caps slots: user keeps the HEAD, assistant keeps the TAIL', () => {
    const context = buildChoiceContext({
      userPrompt: `TASK ${'u'.repeat(5000)}`,
      latestAssistantText: `${'a'.repeat(5000)} NEXT-STEP`,
      maxSlotChars: 100,
    });
    expect(context).toContain('user: TASK');
    expect(context).toContain('NEXT-STEP');
    expect(context.length).toBeLessThan(230);
  });

  it('recorder wires the slots: call 2 sees call 1 reasoning; system prompt and tool results never reach the embedder', async () => {
    const seen: string[] = [];
    const spy: Embedder = {
      dimensions: 4,
      embed: async ({ text }) => {
        seen.push(text);
        return [1, 0, 0, 0];
      },
      embedBatch: async ({ texts }) => {
        seen.push(...texts);
        return texts.map(() => [1, 0, 0, 0]);
      },
    };
    const rec = toolChoiceRecorder({ embedder: spy });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'USER-MARKER question' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onEmit(llmEnd('call-llm#1', 1, 'REASONING-MARKER: need the name server'));
    rec.onEmit(toolStart('get_fcns_database', 'c1'));
    // tool RESULT arrives via tool_end — must never be embedded
    rec.onEmit(
      ev('agentfootprint.stream.tool_end', {
        toolCallId: 'c1',
        result: 'TOOL-RESULT-SECRET',
        durationMs: 1,
      }),
    );
    rec.onEmit(llmStart('call-llm#5', 2));
    rec.onEmit(toolStart('send_email', 'c2'));
    rec.onRunEnd({});

    const calls = await rec.getCalls();
    expect(calls[0].contextText).toBe('user: USER-MARKER question');
    expect(calls[1].contextText).toBe(
      'user: USER-MARKER question\n\nassistant: REASONING-MARKER: need the name server',
    );
    const embedded = seen.join('\n');
    expect(embedded).toContain('USER-MARKER');
    expect(embedded).toContain('REASONING-MARKER');
    expect(embedded).not.toContain('TOOL-RESULT-SECRET'); // excluded by the C4 spec
  });
});

// ── C5: laziness ─────────────────────────────────────────────────────

describe('toolChoiceRecorder — lazy embedding (C5)', () => {
  function recordOneCall(embedder: Embedder) {
    const rec = toolChoiceRecorder({ embedder });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'check the name server' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onEmit(toolStart('get_fcns_database', 'c1'));
    rec.onRunEnd({});
    return rec;
  }

  it('NO embedder call until first read; scores memoize across reads', async () => {
    const counter = countingEmbedder();
    const rec = recordOneCall(counter);
    expect(counter.calls()).toBe(0); // hot path clean

    const flagged = await rec.getFlagged();
    const afterFirstRead = counter.calls();
    expect(afterFirstRead).toBeGreaterThan(0); // lazily scored on read
    expect(Array.isArray(flagged)).toBe(true);

    await rec.getCalls();
    await rec.getSummary();
    expect(counter.calls()).toBe(afterFirstRead); // memoized — no re-embedding
  });

  it('an OPEN entry (mid-run) is not scored; it scores after it closes', async () => {
    const counter = countingEmbedder();
    const rec = toolChoiceRecorder({ embedder: counter });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'q' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onEmit(toolStart('get_fcns_database', 'c1'));

    const midRun = await rec.getCalls(); // entry still open — tool_starts may follow
    expect(midRun[0].margin).toBeUndefined();
    expect(counter.calls()).toBe(0);

    rec.onEmit(toolStart('send_email', 'c2')); // late parallel call still lands
    rec.onRunEnd({});
    const closed = await rec.getCalls();
    expect(closed[0].chosen).toEqual(['get_fcns_database', 'send_email']);
    expect(closed[0].margin).toBeDefined();
  });
});

// ── C6: flags + summary ──────────────────────────────────────────────

describe('toolChoiceRecorder — getFlagged + summary (C6)', () => {
  // Geometry: context ≈ twin candidates (narrow competition), email orthogonal.
  const NARROW = plantedEmbedder([
    ['user:', [1, 0.1, 0]],
    ['fcns', [1, 0.12, 0]], // both fcns tools share this key — nearly tied
    ['email', [0, 0, 1]],
  ]);

  // Geometry: model chose email but the context points at fcns tools.
  const DISAGREE = plantedEmbedder([
    ['user:', [1, 0, 0]],
    ['fcns', [1, 0.05, 0]],
    ['email', [0, 0, 1]],
  ]);

  function record(embedder: Embedder, chosenTool: string) {
    const rec = toolChoiceRecorder({ embedder });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'inspect the fabric name server' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onEmit(toolStart(chosenTool, 'c1'));
    rec.onRunEnd({});
    return rec;
  }

  it('narrow margin (twin competition) → flagged', async () => {
    const rec = record(NARROW, 'get_fcns_database');
    const flagged = await rec.getFlagged();
    expect(flagged).toHaveLength(1);
    expect(flagged[0].margin!.flags.narrow).toBe(true);
    expect(flagged[0].margin!.margin).toBeLessThan(0.05);
  });

  it('proxy disagreement (chosen ≠ top-scored) → ALWAYS flagged', async () => {
    const rec = record(DISAGREE, 'send_email');
    const flagged = await rec.getFlagged();
    expect(flagged).toHaveLength(1);
    expect(flagged[0].margin!.flags.proxyDisagreement).toBe(true);
    expect(flagged[0].margin!.topScored).not.toBe('send_email');
  });

  it('decisive choice (wide margin, agrees with proxy) → not flagged', async () => {
    const DECISIVE = plantedEmbedder([
      ['user:', [0, 0, 1]],
      ['fcns', [1, 0, 0]],
      ['email', [0, 0.2, 1]],
    ]);
    const rec = record(DECISIVE, 'send_email');
    expect(await rec.getFlagged()).toHaveLength(0);
  });

  it('summary counts: calls, choices, scored, flagged, narrow, disagreement, skipped', async () => {
    const rec = toolChoiceRecorder({ embedder: NARROW });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'inspect the fabric name server' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onEmit(toolStart('get_fcns_database', 'c1')); // narrow vs its twin
    rec.onEmit(llmStart('call-llm#5', 2)); // final answer — nothing chosen
    rec.onEmit(llmStart('call-llm#9', 3));
    rec.onEmit(toolStart('hallucinated_tool', 'c2')); // not offered
    rec.onRunEnd({});

    expect(await rec.getSummary()).toEqual({
      llmCallsWithTools: 3,
      choices: 2,
      scored: 1,
      flagged: 1,
      narrow: 1,
      proxyDisagreement: 0,
      skipped: 2,
    });
    const calls = await rec.getCalls();
    expect(calls[1].skipped).toBe('nothing-chosen');
    expect(calls[2].skipped).toBe('chosen-not-offered');
  });
});

// ── Convention 4: runId reset ────────────────────────────────────────

describe('toolChoiceRecorder — Convention 4 (runId reset)', () => {
  it('a NEW runId on onRunStart resets accumulation (runtimeStageId keys restart per run)', async () => {
    const rec = toolChoiceRecorder({ embedder: mockEmbedder() });
    rec.onRunStart(runStart('run-A'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'first run' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onEmit(toolStart('get_fcns_database', 'a1'));

    rec.onRunStart(runStart('run-B')); // same executor, second run
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'second run' }));
    rec.onEmit(llmStart('call-llm#1', 1)); // SAME key as run-A — must not collide
    rec.onEmit(toolStart('send_email', 'b1'));
    rec.onRunEnd({});

    const calls = await rec.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].chosen).toEqual(['send_email']);
    expect(calls[0].contextText).toContain('second run');
  });

  it('the SAME runId does not reset (idempotent against duplicate delivery)', async () => {
    const rec = toolChoiceRecorder({ embedder: mockEmbedder() });
    rec.onRunStart(runStart('run-A'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'q' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.onRunStart(runStart('run-A'));
    rec.onEmit(toolStart('get_fcns_database', 'c1'));
    rec.onRunEnd({});
    expect((await rec.getCalls())[0].chosen).toEqual(['get_fcns_database']);
  });

  it('clear() empties everything (the executor calls it before each run)', async () => {
    const rec = toolChoiceRecorder({ embedder: mockEmbedder() });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'q' }));
    rec.onEmit(llmStart('call-llm#1', 1));
    rec.clear();
    expect(await rec.getCalls()).toHaveLength(0);
  });
});

// ── functional/integration: a real Agent run ─────────────────────────

describe('toolChoiceRecorder — functional (real Agent, mock provider)', () => {
  it('captures offered/chosen/context from a live run; embeds only on read', async () => {
    const fcnsLive = defineTool({
      name: 'get_fcns_database',
      description: 'FC Name Server DB — registered N_Ports, live. Use for current state.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ ports: 3 }),
    });
    const fcnsHistory = defineTool({
      name: 'influx_get_fcns_database',
      description: 'FC Name Server registrations — time-series. Use for history.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ ports: 2 }),
    });

    let i = 0;
    const provider: LLMProvider = mock({
      respond: () => {
        i++;
        if (i === 1)
          return {
            content: 'Checking the live name server first.',
            toolCalls: [{ id: 'c1', name: 'get_fcns_database', args: {} }],
            stopReason: 'tool_use',
          };
        return { content: 'The device is registered.', toolCalls: [], stopReason: 'stop' };
      },
    });

    const counter = countingEmbedder();
    const choices = toolChoiceRecorder({ embedder: counter });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('You are a SAN triage agent.')
      .tool(fcnsLive)
      .tool(fcnsHistory)
      .recorder(choices)
      .build();

    await agent.run({ message: 'is wwpn 21:00 still registered?' });
    expect(counter.calls()).toBe(0); // the run itself never embedded

    const calls = await choices.getCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2); // tool call + final call (tools still offered)
    const [first] = calls;
    expect(first.offered.map((t) => t.name)).toEqual([
      'get_fcns_database',
      'influx_get_fcns_database',
    ]);
    expect(first.chosen).toEqual(['get_fcns_database']);
    expect(first.contextText).toBe('user: is wwpn 21:00 still registered?');
    expect(first.runtimeStageId).toContain('#');
    expect(first.margin).toBeDefined();
    expect(counter.calls()).toBeGreaterThan(0);

    const summary = await choices.getSummary();
    expect(summary.llmCallsWithTools).toBe(calls.length);
    expect(summary.choices).toBe(1);
    expect(summary.scored).toBe(1);
    expect(summary.skipped).toBe(calls.length - 1); // the final answer call(s)
  });
});

// ── performance ──────────────────────────────────────────────────────

describe('toolChoiceRecorder — performance', () => {
  it('hot path is record-only: 500 synthetic calls ingest fast with zero embeds', async () => {
    const counter = countingEmbedder();
    const rec = toolChoiceRecorder({ embedder: counter });
    rec.onRunStart(runStart('r1'));
    rec.onEmit(ev(TURN_START, { turnIndex: 0, userPrompt: 'q' }));
    const start = performance.now();
    for (let n = 1; n <= 500; n++) {
      rec.onEmit(llmStart(`call-llm#${n}`, n));
      rec.onEmit(toolStart('get_fcns_database', `c${n}`));
    }
    const elapsed = performance.now() - start;
    expect(counter.calls()).toBe(0);
    expect(elapsed).toBeLessThan(250);
    rec.onRunEnd({});
    expect((await rec.getCalls()).length).toBe(500);
  });
});
