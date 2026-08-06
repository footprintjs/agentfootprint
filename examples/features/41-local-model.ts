/**
 * 41 — The middle rung: a local model, free, no API key.
 *
 * The adapter ladder is three steps, and the agent code is the same on all
 * three:
 *
 *   1. mock({ reply })         — shape the logic, $0, deterministic, offline
 *   2. ollama('<model>')       — a REAL model, still $0, still no key
 *   3. anthropic() / openai()  — production
 *
 * Step 2 is what makes "the test run and the production run are the same
 * code path" more than a slogan. A mock proves your control flow; it cannot
 * tell you whether a real model actually calls your tool, or what it does
 * with a badly-worded description. A local model can, and it costs nothing
 * to find out — which means you will actually do it.
 *
 * This file runs the SAME agent against all three rungs and prints what
 * changed. It runs offline: rung 2 talks to a stubbed daemon unless a real
 * one is listening, and rung 3 is only described unless a key is present.
 *
 * WHAT THE LOCAL RUNG ADDS OVER THE MOCK
 *   • real token counts, so `.compaction()` and cost budgets can be exercised
 *   • real tool-calling behaviour — a model that ignores your tool tells you
 *     something a scripted mock never will
 *   • real reasoning, on a reasoning model: `ollama('deepseek-r1', { think: true })`
 *     lifts it out of the answer into thinking blocks
 *
 * WHEN IT REFUSES
 *   No daemon → a typed error naming the address and `ollama serve`.
 *   Model not pulled → a typed error naming `ollama pull <model>`.
 *   Neither is a hang, and neither is a stack trace about sockets.
 *
 * Setup for the real thing (optional):
 *   Install https://ollama.com/download, then:  ollama pull llama3.2
 *
 * Run:  npx tsx examples/features/41-local-model.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { mock, ollama, OllamaUnavailableError } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/41-local-model',
  title: 'Local model — the free middle rung of the adapter ladder',
  group: 'features',
  description:
    "ollama('<model>') runs a real model on your laptop: no API key, no cost, no vendor SDK. Same agent code as mock() and as anthropic() — this example runs one agent on all three rungs. Refusals name the fix (`ollama serve`, `ollama pull <model>`).",
  defaultInput: 'How long do refunds take?',
  providerSlots: ['default'],
  tags: ['feature', 'providers', 'ollama', 'local', 'adapters', 'offline'],
};

const MODEL = process.env.AGENTFOOTPRINT_OLLAMA_MODEL ?? 'llama3.2';

// ─── One agent definition. The provider is the only thing that varies. ───

const policyLookup = defineTool({
  name: 'policy_lookup',
  description: 'Look up a company policy by topic. Use for refunds, shipping, returns.',
  inputSchema: {
    type: 'object',
    properties: { topic: { type: 'string', description: 'The policy topic' } },
    required: ['topic'],
  },
  execute: async (args) => `${(args as { topic: string }).topic}: 3 business days`,
});

function buildAgent(provider: LLMProvider, model: string) {
  return Agent.create({ provider, model, maxIterations: 4 })
    .system('You are a support assistant. Use policy_lookup, then answer in one sentence.')
    .tool(policyLookup)
    .build();
}

interface RungResult {
  readonly rung: string;
  readonly answer: string;
  readonly toolsCalled: readonly string[];
  readonly tokens: { readonly input: number; readonly output: number };
  readonly note?: string;
}

async function runOn(
  rung: string,
  provider: LLMProvider,
  model: string,
  note?: string,
): Promise<RungResult> {
  const agent = buildAgent(provider, model);
  const toolsCalled: string[] = [];
  let tokens = { input: 0, output: 0 };
  agent.on('agentfootprint.stream.tool_start', (e) => toolsCalled.push(e.payload.toolName));
  agent.on('agentfootprint.agent.turn_end', (e) => {
    tokens = { input: e.payload.totalInputTokens, output: e.payload.totalOutputTokens };
  });
  // Nothing here pauses (no human-in-the-loop tool), so a non-string outcome
  // would be a surprise worth showing rather than swallowing.
  const outcome = await agent.run({ message: meta.defaultInput! });
  const answer = typeof outcome === 'string' ? outcome : '(paused — unexpected here)';
  return { rung, answer, toolsCalled, tokens, ...(note && { note }) };
}

// ─── Rung 2 offline: a stubbed daemon speaking the real native wire ──────
//
// So this example runs anywhere. Point `_fetch` at nothing and you are
// talking to a real Ollama — the adapter code path is identical.

function stubbedDaemon(): typeof fetch {
  let turn = 0;
  return ((_url: RequestInfo | URL, _init?: RequestInit) => {
    const body =
      turn++ === 0
        ? {
            message: {
              role: 'assistant',
              content: '',
              // Note: no `id` — most local models emit none, and the adapter
              // synthesizes one so the tool round-trip still correlates.
              tool_calls: [{ function: { name: 'policy_lookup', arguments: { topic: 'refunds' } } }],
            },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 96,
            eval_count: 14,
          }
        : {
            message: { role: 'assistant', content: 'Refunds take 3 business days.' },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 128,
            eval_count: 9,
          };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
}

/** Is a real daemon listening? One cheap call, and we never wait long. */
async function realDaemonAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 400);
    try {
      const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  void input;
  const results: RungResult[] = [];

  // ── RUNG 1 — the mock. Deterministic, instant, free.
  const mockProvider =
    provider ??
    mock({
      replies: [
        { toolCalls: [{ id: '1', name: 'policy_lookup', args: { topic: 'refunds' } }] },
        { content: 'Refunds take 3 business days.' },
      ],
    });
  results.push(
    await runOn('1-mock', mockProvider, 'mock', 'scripted; token counts are not real'),
  );

  // ── RUNG 2 — a local model. Same agent, one argument changed.
  const live = !provider && (await realDaemonAvailable());
  const localProvider = live ? ollama(MODEL) : ollama(MODEL, { _fetch: stubbedDaemon() });
  try {
    results.push(
      await runOn(
        '2-local',
        localProvider,
        MODEL,
        live ? `real Ollama daemon, model ${MODEL}` : 'stubbed daemon (no Ollama running here)',
      ),
    );
  } catch (err) {
    // The refusal is part of the lesson: it names the fix.
    if (err instanceof OllamaUnavailableError) {
      results.push({
        rung: '2-local',
        answer: '(refused)',
        toolsCalled: [],
        tokens: { input: 0, output: 0 },
        note: `${err.reason}: ${err.message}`,
      });
    } else {
      throw err;
    }
  }

  // ── RUNG 3 — production. Described rather than called; this example is free.
  const cloudReady = !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY;

  return {
    ladder: results,
    rung3: cloudReady
      ? "a key is present — swap in anthropic({ apiKey }) and nothing else changes"
      : "no key set; in production this line becomes anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })",
    thePoint:
      'One agent definition, three providers. The local rung is the one that costs nothing ' +
      'AND runs a real model — which is why it is worth having between the mock and the bill.',
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
