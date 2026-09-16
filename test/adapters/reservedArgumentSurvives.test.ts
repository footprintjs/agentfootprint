/**
 * The reserved `_findings` argument survives every provider's inputSchema
 * mapping — the proof that lands BEFORE the name ships (findings ledger,
 * step 2: `docs/design/2026-09-findings-ledger-spec.md`).
 *
 * WHY THIS TEST EXISTS FIRST. `_findings` is public forever once a model has
 * seen it. The library adds it to every SERVED tool schema
 * (`buildToolsSlot` → `withFindingsArgument`), and an adapter that dropped,
 * renamed or rewrote the property would make the ask unanswerable on that
 * wire with no error anywhere — the model simply never sees it. So the bytes
 * each adapter puts on its wire are read here, the way
 * `test/adapters/unit/forced-tool-choice.test.ts` reads `toolChoice`.
 *
 * WHAT IS PROVED, per wire:
 *   1. the mapped request carries `properties._findings` byte-for-byte
 *      (`JSON.stringify` equality — order and all — plus structural equality);
 *   2. `required` is exactly the author's (`_findings` is optional by law);
 *   3. `additionalProperties` and the author's own properties are untouched;
 *   4. the served schema itself was never mutated (the fixture is deep-frozen:
 *      an in-place edit by an adapter throws instead of passing).
 *
 * Every mapping function is module-private (`AnthropicProvider · toAnthropicTool`,
 * `OpenAIProvider · toOpenAITool`, `GeminiProvider · toGeminiFunctionDeclaration`,
 * `BedrockProvider · toBedrockTool`, `OllamaProvider · toOllamaTool`,
 * `FoundryLocalProvider · toFoundryTool`, and the two browser twins), so each
 * is reached through its public factory with an injected `_client` (SDK wires)
 * or `_fetch` (fetch wires) that records the request. `foundry()` has no
 * mapping of its own — it composes `openai()` — and is still driven end to end
 * because that composition IS its promise. The spec's list of seven names
 * therefore reads as nine wires: "Foundry" is hosted + local, "Browser" is
 * Anthropic + OpenAI (`BrowserAzureOpenAIProvider` composes the latter).
 *
 * The schema literal below is inlined ON PURPOSE. Its owner is
 * `src/core/agent/findings/reserved.ts · FINDINGS_ARGUMENT_SCHEMA`, which lands
 * after this proof; this file never imports it, because the wire promise must
 * hold for the shape a model is shown, whatever the constant's wording becomes
 * (the mapping is content-agnostic — the description text here is illustrative).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { bedrock } from '../../src/adapters/llm/BedrockProvider.js';
import { browserAnthropic } from '../../src/adapters/llm/BrowserAnthropicProvider.js';
import { browserOpenai } from '../../src/adapters/llm/BrowserOpenAIProvider.js';
import { foundryLocal } from '../../src/adapters/llm/FoundryLocalProvider.js';
import { foundry } from '../../src/adapters/llm/FoundryProvider.js';
import { gemini } from '../../src/adapters/llm/GeminiProvider.js';
import { ollama } from '../../src/adapters/llm/OllamaProvider.js';
import { openai } from '../../src/adapters/llm/OpenAIProvider.js';
import type { LLMRequest, LLMToolSchema } from '../../src/adapters/types.js';

// ─── The reserved property, as the model will be shown it ──────────
// Owner: `src/core/agent/findings/reserved.ts · FINDINGS_ARGUMENT_SCHEMA`
// (inlined here on purpose — see the file comment). `_findings` itself is
// NEVER in the parent's `required`; only `basis` is required inside it.

const RESERVED_ARGUMENT = '_findings';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

const FINDINGS_PROPERTY = deepFreeze({
  type: 'object',
  description:
    'Findings ledger: the basis of this call, and the standing of each previous tool result.',
  properties: {
    basis: {
      type: 'string',
      enum: ['direct', 'exploratory'],
      description: 'direct: this call answers the task; exploratory: it looks around first.',
    },
    expect: { type: 'string', enum: ['low', 'medium', 'high'] },
    previous: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          toolCallId: { type: 'string' },
          standing: { type: 'string', enum: ['fact', 'open', 'noise', 'ruled-out'] },
          sought: { type: 'boolean' },
          assertions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                subject: {
                  type: 'object',
                  properties: { kind: { type: 'string' }, id: { type: 'string' } },
                  required: ['kind', 'id'],
                },
                predicate: { type: 'string' },
                value: {},
              },
              required: ['subject', 'predicate', 'value'],
            },
          },
          settles: { type: 'string' },
          line: { type: 'string' },
        },
        required: ['toolCallId', 'standing'],
      },
    },
  },
  required: ['basis'],
});

/**
 * An author's tool AFTER decoration: `_findings` beside the author's own
 * properties, `required` and `additionalProperties` exactly as the author
 * wrote them. Deep-frozen so that an adapter editing it in place throws.
 */
const SERVED_TOOL: LLMToolSchema = deepFreeze({
  name: 'search_docs',
  description: 'Search the documentation.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for.' },
      limit: { type: 'integer', minimum: 1 },
      [RESERVED_ARGUMENT]: FINDINGS_PROPERTY,
    },
    required: ['query'],
    additionalProperties: false,
  },
});
const SERVED_BYTES = JSON.stringify(SERVED_TOOL);

const REQUEST: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'm',
  tools: [SERVED_TOOL],
};

// ─── Reading the recorded request ──────────────────────────────────

/** Walks `path` into a recorded request; a missing step fails with the path named. */
function at(root: unknown, ...path: readonly (string | number)[]): unknown {
  let cur = root;
  for (const step of path) {
    if (cur === null || typeof cur !== 'object') {
      throw new Error(`recorded request has no ${path.join('.')} (stopped before ${String(step)})`);
    }
    cur = (cur as Record<string | number, unknown>)[step];
  }
  return cur;
}

/** The four promises, read from the mapped parameters object of ONE wire. */
function expectSurvived(mapped: unknown, wire: string): void {
  const survivor = at(mapped, 'properties', RESERVED_ARGUMENT);
  // 1. byte-for-byte — the same bytes in the same order …
  expect(JSON.stringify(survivor), `${wire}: _findings bytes`).toBe(
    JSON.stringify(FINDINGS_PROPERTY),
  );
  // … and structurally equal, so a failure names the first differing path.
  expect(survivor, `${wire}: _findings shape`).toStrictEqual(FINDINGS_PROPERTY);
  // 2. optional by law — never added to the author's `required`.
  expect(at(mapped, 'required'), `${wire}: required`).toStrictEqual(['query']);
  // 3. the author's own contract untouched — additionalProperties and siblings.
  expect(at(mapped, 'additionalProperties'), `${wire}: additionalProperties`).toBe(false);
  expect(JSON.stringify(mapped), `${wire}: whole inputSchema`).toBe(
    JSON.stringify(SERVED_TOOL.inputSchema),
  );
}

// ─── Doubles: one reply per dialect, a recorder per seam ───────────

const ANTHROPIC_REPLY = {
  id: 'msg_1',
  model: 'claude',
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

const OPENAI_REPLY = {
  id: 'c1',
  object: 'chat.completion',
  model: 'm',
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
};

const GEMINI_REPLY = {
  candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
};

const BEDROCK_REPLY = {
  output: { message: { role: 'assistant', content: [{ text: 'ok' }] } },
  stopReason: 'end_turn',
  usage: { inputTokens: 1, outputTokens: 1 },
};

const OLLAMA_REPLY = {
  model: 'llama3.2',
  created_at: '2026-09-16T00:00:00Z',
  message: { role: 'assistant', content: 'ok' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 1,
  eval_count: 1,
};

function anthropicClient(params: unknown[]) {
  return {
    messages: {
      create: async (p: unknown) => {
        params.push(p);
        return ANTHROPIC_REPLY;
      },
    },
  };
}

function openaiClient(params: unknown[]) {
  return {
    chat: {
      completions: {
        create: async (p: unknown) => {
          params.push(p);
          return OPENAI_REPLY;
        },
      },
    },
  };
}

function geminiClient(params: unknown[]) {
  return {
    models: {
      generateContent: async (p: unknown) => {
        params.push(p);
        return GEMINI_REPLY;
      },
      generateContentStream: async () => {
        throw new Error('not used here');
      },
    },
  };
}

function bedrockDouble(inputs: unknown[]) {
  class Converse {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
      inputs.push(input);
    }
  }
  return {
    client: { send: async () => BEDROCK_REPLY },
    Commands: { Converse, ConverseStream: Converse },
  };
}

/** A fetch that records every JSON request body and answers `reply`. */
function recordingFetch(reply: unknown, bodies: unknown[]): typeof fetch {
  return ((_url: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
    return Promise.resolve(
      new Response(JSON.stringify(reply), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
}

// ─── The nine wires ────────────────────────────────────────────────

describe('_findings survives the Anthropic mapping (input_schema)', () => {
  it('AnthropicProvider · toAnthropicTool → tools[].input_schema', async () => {
    const params: unknown[] = [];
    await anthropic({ _client: anthropicClient(params) as never }).complete(REQUEST);
    expectSurvived(at(params[0], 'tools', 0, 'input_schema'), 'anthropic');
  });
});

describe('_findings survives the OpenAI mapping (function.parameters)', () => {
  it('OpenAIProvider · toOpenAITool → tools[].function.parameters', async () => {
    const params: unknown[] = [];
    await openai({ _client: openaiClient(params) as never }).complete(REQUEST);
    expectSurvived(at(params[0], 'tools', 0, 'function', 'parameters'), 'openai');
  });
});

describe('_findings survives the Gemini mapping (parametersJsonSchema)', () => {
  it('GeminiProvider · toGeminiFunctionDeclaration → config.tools[].functionDeclarations[].parametersJsonSchema', async () => {
    const params: unknown[] = [];
    await gemini({ _client: geminiClient(params) as never }).complete(REQUEST);
    expectSurvived(
      at(params[0], 'config', 'tools', 0, 'functionDeclarations', 0, 'parametersJsonSchema'),
      'gemini',
    );
  });
});

describe('_findings survives the Bedrock mapping (toolSpec.inputSchema.json)', () => {
  it('BedrockProvider · toBedrockTool → toolConfig.tools[].toolSpec.inputSchema.json', async () => {
    const inputs: unknown[] = [];
    const fake = bedrockDouble(inputs);
    await bedrock({ _client: fake.client as never, _commands: fake.Commands as never }).complete(
      REQUEST,
    );
    expectSurvived(
      at(inputs[0], 'toolConfig', 'tools', 0, 'toolSpec', 'inputSchema', 'json'),
      'bedrock',
    );
  });
});

describe('_findings survives the Ollama mapping (function.parameters on /api/chat)', () => {
  it('OllamaProvider · toOllamaTool → body.tools[].function.parameters', async () => {
    const bodies: unknown[] = [];
    await ollama('llama3.2', { _fetch: recordingFetch(OLLAMA_REPLY, bodies) }).complete(REQUEST);
    expectSurvived(at(bodies[0], 'tools', 0, 'function', 'parameters'), 'ollama');
  });
});

describe('_findings survives the Foundry mappings (hosted composes openai(); local has its own wire)', () => {
  it('FoundryProvider → openai() → tools[].function.parameters', async () => {
    const params: unknown[] = [];
    await foundry({
      _client: openaiClient(params) as never,
      projectEndpoint: 'https://acct.services.ai.azure.com/api/projects/proj-1',
      deployment: 'dep-a',
    }).complete(REQUEST);
    expectSurvived(at(params[0], 'tools', 0, 'function', 'parameters'), 'foundry');
  });

  it('FoundryLocalProvider · toFoundryTool → body.tools[].function.parameters', async () => {
    const bodies: unknown[] = [];
    // A direct model id (with the `:` tag) skips the /foundry/list catalog.
    await foundryLocal('qwen2.5-0.5b-instruct-generic-cpu:1', {
      _fetch: recordingFetch(OPENAI_REPLY, bodies),
    }).complete(REQUEST);
    expectSurvived(at(bodies[0], 'tools', 0, 'function', 'parameters'), 'foundry-local');
  });
});

describe('_findings survives the Browser mappings (fetch twins of Anthropic and OpenAI)', () => {
  it('BrowserAnthropicProvider · toAnthropicTool → body.tools[].input_schema', async () => {
    const bodies: unknown[] = [];
    await browserAnthropic({
      apiKey: 'sk-test',
      _fetch: recordingFetch(ANTHROPIC_REPLY, bodies),
    }).complete(REQUEST);
    expectSurvived(at(bodies[0], 'tools', 0, 'input_schema'), 'browser-anthropic');
  });

  it('BrowserOpenAIProvider · toOpenAITool → body.tools[].function.parameters', async () => {
    const bodies: unknown[] = [];
    await browserOpenai({
      apiKey: 'sk-test',
      _fetch: recordingFetch(OPENAI_REPLY, bodies),
    }).complete(REQUEST);
    expectSurvived(at(bodies[0], 'tools', 0, 'function', 'parameters'), 'browser-openai');
  });
});

// ─── The reader bites ──────────────────────────────────────────────
// A green run above means nothing unless the reader refuses a broken wire.
// Each case is a mapping an adapter COULD write by mistake; each must fail.

describe('expectSurvived refuses a mapping that breaks the promise', () => {
  const served = JSON.parse(JSON.stringify(SERVED_TOOL.inputSchema)) as {
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };

  it('accepts the served schema itself (the reader is sound)', () => {
    expect(() => expectSurvived(served, 'control')).not.toThrow();
  });

  it('refuses a wire that dropped the property', () => {
    const { [RESERVED_ARGUMENT]: _dropped, ...rest } = served.properties;
    void _dropped;
    expect(() => expectSurvived({ ...served, properties: rest }, 'dropped')).toThrow();
  });

  it('refuses a wire that added it to required', () => {
    const required = [...served.required, RESERVED_ARGUMENT];
    expect(() => expectSurvived({ ...served, required }, 'required')).toThrow();
  });

  it('refuses a wire that rewrote the nested shape (one enum member renamed)', () => {
    const rewritten = JSON.parse(
      JSON.stringify(served).replace('"ruled-out"', '"ruled_out"'),
    ) as typeof served;
    expect(() => expectSurvived(rewritten, 'rewritten')).toThrow();
  });

  it('refuses a wire that touched additionalProperties', () => {
    expect(() => expectSurvived({ ...served, additionalProperties: true }, 'ap')).toThrow();
  });
});

// ─── The promise stays whole ───────────────────────────────────────

describe('the served schema and the list of wires', () => {
  it('no adapter edited the served schema in place (same bytes after every wire ran)', () => {
    expect(JSON.stringify(SERVED_TOOL)).toBe(SERVED_BYTES);
    expect(Object.isFrozen(SERVED_TOOL.inputSchema)).toBe(true);
  });

  it('every inputSchema mapping site under src/adapters/llm is driven above', () => {
    // Drift guard: a new adapter with its own `{ ...schema.inputSchema }`
    // spread must add a wire test here before it ships, or this list moves.
    const dir = fileURLToPath(new URL('../../src/adapters/llm/', import.meta.url));
    const sites = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\.\.\.\s*schema\.inputSchema\b/.test(readFileSync(join(dir, f), 'utf8')))
      .sort();
    expect(sites).toStrictEqual([
      'AnthropicProvider.ts',
      'BedrockProvider.ts',
      'BrowserAnthropicProvider.ts',
      'BrowserOpenAIProvider.ts',
      'FoundryLocalProvider.ts',
      'GeminiProvider.ts',
      'OllamaProvider.ts',
      'OpenAIProvider.ts',
    ]);
  });
});
