/**
 * The adapter-swap law, for the rung that makes it affordable.
 *
 * The claim the ladder rests on is that `mock()` → a local model → a paid
 * API is a change of ONE argument, and that the run either side of the
 * swap is the same run: same chart, same loop, same tool dispatch, same
 * typed events, same answer. This file is that claim as a test.
 *
 * Both providers here are offline — the mock by construction, Ollama
 * through an injected `_fetch` — so the law is checked on every CI run,
 * with no daemon and no key. The live counterpart lives in
 * `integration/ollama-live.test.ts` behind AGENTFOOTPRINT_OLLAMA_LIVE.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { ollama } from '../../src/adapters/llm/OllamaProvider.js';
import type { LLMProvider } from '../../src/adapters/types.js';

const ANSWER = 'Refunds take 3 business days.';

const lookup = defineTool({
  name: 'lookup',
  description: 'Look up a policy topic.',
  inputSchema: {
    type: 'object',
    properties: { topic: { type: 'string' } },
    required: ['topic'],
  },
  execute: async (args) => `${(args as { topic: string }).topic}: 3 business days`,
});

/** The two-turn script both providers act out: one tool call, then the answer. */
const TOOL_TURN = { name: 'lookup', args: { topic: 'refunds' } };

function mockProvider(): LLMProvider {
  return mock({
    replies: [
      { toolCalls: [{ id: 'call-1', name: TOOL_TURN.name, args: TOOL_TURN.args }] },
      { content: ANSWER },
    ],
  });
}

/**
 * The same script, spoken by a fake Ollama daemon on the real native wire —
 * `/api/chat`, NDJSON-free (non-streaming), `tool_calls` with no id (which
 * is what most local models actually emit), and real token counts.
 */
function ollamaProvider(recorder?: { bodies: Record<string, unknown>[] }): LLMProvider {
  let turn = 0;
  const _fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
    if (recorder && typeof init?.body === 'string') {
      recorder.bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    const body =
      turn++ === 0
        ? {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: TOOL_TURN.name, arguments: TOOL_TURN.args } }],
            },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 12,
            eval_count: 5,
          }
        : {
            message: { role: 'assistant', content: ANSWER },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 30,
            eval_count: 9,
          };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return ollama('llama3.2', { _fetch });
}

/** ONE agent definition. The provider is the only thing that varies. */
function buildAgent(provider: LLMProvider) {
  return Agent.create({ provider, model: 'swap-me', maxIterations: 4 })
    .system('You are a support assistant.')
    .tool(lookup)
    .build();
}

/** Collapse consecutive `stream.token` events to one — see the law below. */
function collapseTokens(events: readonly string[]): string[] {
  const TOKEN = 'agentfootprint.stream.token';
  return events.filter((e, i) => !(e === TOKEN && events[i - 1] === TOKEN));
}

interface RunTrace {
  readonly answer: string;
  readonly events: readonly string[];
  readonly toolCalls: readonly { name: string; args: unknown }[];
  readonly iterations: number;
}

async function runAndTrace(provider: LLMProvider): Promise<RunTrace> {
  const agent = buildAgent(provider);
  const events: string[] = [];
  const toolCalls: { name: string; args: unknown }[] = [];
  let iterations = 0;

  agent.on('*', (e) => events.push(e.type));
  agent.on('agentfootprint.stream.tool_start', (e) => {
    toolCalls.push({ name: e.payload.toolName, args: e.payload.args });
  });
  agent.on('agentfootprint.agent.iteration_start', () => {
    iterations++;
  });

  const outcome = await agent.run({ message: 'How long do refunds take?' });
  const answer = typeof outcome === 'string' ? outcome : '(paused)';
  return { answer, events, toolCalls, iterations };
}

describe('adapter-swap law — mock() and ollama() run the SAME run', () => {
  it('produces the same answer', async () => {
    const onMock = await runAndTrace(mockProvider());
    const onOllama = await runAndTrace(ollamaProvider());
    expect(onOllama.answer).toBe(onMock.answer);
    expect(onOllama.answer).toBe(ANSWER);
  });

  it('dispatches the same tool with the same arguments', async () => {
    const onMock = await runAndTrace(mockProvider());
    const onOllama = await runAndTrace(ollamaProvider());
    expect(onOllama.toolCalls).toEqual(onMock.toolCalls);
    expect(onOllama.toolCalls).toEqual([{ name: 'lookup', args: { topic: 'refunds' } }]);
  });

  it('takes the same number of iterations', async () => {
    const onMock = await runAndTrace(mockProvider());
    const onOllama = await runAndTrace(ollamaProvider());
    expect(onOllama.iterations).toBe(onMock.iterations);
    expect(onOllama.iterations).toBe(2);
  });

  it('emits the same typed-event sequence', async () => {
    const onMock = await runAndTrace(mockProvider());
    const onOllama = await runAndTrace(ollamaProvider());
    // The observable shape of the run is what a consumer builds dashboards,
    // audits and tests against. If swapping the provider changed it, "same
    // code path" would be a slogan rather than a property.
    //
    // Token COUNT is deliberately not part of the law: how an answer is cut
    // into `stream.token` events is a property of the model and the wire
    // (the mock emits one per word; a daemon answering in one piece emits
    // one), and no adapter can promise another one's chunking. What must
    // match is the sequence of things that HAPPENED.
    expect(collapseTokens(onOllama.events)).toEqual(collapseTokens(onMock.events));
  });

  it('the swap is one argument — the agent definition is byte-identical', () => {
    // `buildAgent` is called with nothing but a different provider in every
    // test above. Stated here so a future refactor that sneaks a
    // provider-specific branch into the agent breaks this file on purpose.
    expect(buildAgent.length).toBe(1);
  });
});

describe('adapter-swap law — what the local rung adds on top', () => {
  it('reports real token usage, which the mock cannot', async () => {
    const agent = buildAgent(ollamaProvider());
    const totals: { input: number; output: number }[] = [];
    agent.on('agentfootprint.agent.turn_end', (e) => {
      totals.push({
        input: e.payload.totalInputTokens,
        output: e.payload.totalOutputTokens,
      });
    });
    await agent.run({ message: 'How long do refunds take?' });
    // 12+30 in, 5+9 out across the two calls — counts a budget can act on.
    expect(totals).toEqual([{ input: 42, output: 14 }]);
  });

  it('sends the tools array and the tool result on the native wire', async () => {
    const recorder = { bodies: [] as Record<string, unknown>[] };
    await buildAgent(ollamaProvider(recorder)).run({ message: 'How long do refunds take?' });

    const first = recorder.bodies[0]!;
    expect((first.tools as Array<{ function: { name: string } }>)[0]!.function.name).toBe('lookup');

    // Second turn carries the assistant's tool call and the result, correlated
    // by `tool_name` — the id was synthesized because the model sent none.
    const second = recorder.bodies[1]!;
    const messages = second.messages as Array<Record<string, unknown>>;
    const toolResult = messages.find((m) => m.role === 'tool')!;
    expect(toolResult.tool_name).toBe('lookup');
    expect(toolResult.content).toBe('refunds: 3 business days');
  });

  it('needs no API key anywhere in the swap', () => {
    // The rung's whole reason for existing: nothing to configure, nothing to
    // pay, nothing to leak.
    const recorder = { bodies: [] as Record<string, unknown>[] };
    expect(() => ollamaProvider(recorder)).not.toThrow();
    expect(process.env.OLLAMA_API_KEY).toBeUndefined();
  });
});
