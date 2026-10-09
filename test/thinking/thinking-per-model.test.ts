/**
 * `.thinking({ budget })` sends the shape each MODEL takes.
 *
 * Claude 4.7 and later reject `thinking: { type: 'enabled', budget_tokens }`
 * with HTTP 400; they take `{ type: 'adaptive' }`. The 4.6 models take both
 * (budget deprecated), 4.5 and earlier take only the budget, and the Claude 3
 * models before 3.7 cannot think. So the Anthropic adapters DECLARE the mode
 * per model (`thinkingMode`, one table in anthropicThinkingWire.ts) and send
 * that shape; the agent refuses a model that cannot think at build.
 *
 * No live API calls: every adapter runs against a fake SDK client or a fake
 * `fetch` that records the request body.
 *
 * Test types (Convention 3): unit (the table — every family, platform ids,
 * dotted aliases, unknown ids) / scenario (the wire shape per family, both
 * paths, all three adapters) / boundary (refusals before sending — nothing
 * reaches the wire) / integration (Agent build refusal, dev warning, the
 * adaptive round trip, `.configure()`) / resilience (withFallback per side,
 * the decorators forward, a refusal neither falls back nor trips a breaker) /
 * the adapters' `thinkingMode` option (one function, declared AND sent) /
 * regression (the mock untouched) / property (seeded ids) / performance.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';

import { Agent, defineTool, type LLMProvider, type LLMRequest } from '../../src/index.js';
import { anthropic, AnthropicProvider } from '../../src/adapters/llm/AnthropicProvider.js';
import { browserAnthropic } from '../../src/adapters/llm/BrowserAnthropicProvider.js';
import { invokeModelGateway } from '../../src/adapters/llm/InvokeModelGatewayProvider.js';
import {
  ANTHROPIC_THINKING_MODES,
  anthropicThinkingMode,
} from '../../src/adapters/llm/anthropicThinkingWire.js';
import { mock } from '../../src/doors/providers.js';
import { withFallback } from '../../src/resilience/withFallback.js';
import { withRetry } from '../../src/resilience/withRetry.js';
import { withCircuitBreaker } from '../../src/resilience/withCircuitBreaker.js';
import { UnsupportedThinkingError, type ThinkingMode } from '../../src/thinking/index.js';
import { checkThinkingSupport } from '../../src/core/agent/thinkingSupport.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { seeded } from '../helpers/seededText.js';
import { expectScalesLinearly } from '../helpers/perf.js';

// ── Fakes ──────────────────────────────────────────────────────────────

type Body = Record<string, unknown> & { thinking?: unknown; max_tokens?: number };

const TEXT_REPLY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'm',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** A stand-in for `@anthropic-ai/sdk`: records every params object it is handed. */
function sdk(replies: readonly unknown[] = [TEXT_REPLY], fail = false) {
  const sent: Body[] = [];
  let n = 0;
  const next = (params: unknown) => {
    sent.push(params as Body);
    if (fail) throw Object.assign(new Error('overloaded'), { status: 529 });
    const reply = replies[Math.min(n, replies.length - 1)];
    n += 1;
    return reply;
  };
  const client = {
    messages: {
      create: async (params: unknown) => next(params),
      stream: (params: unknown) => {
        const reply = next(params);
        return {
          async *[Symbol.asyncIterator]() {},
          finalMessage: async () => reply,
        };
      },
    },
  };
  return { sent, client: client as never };
}

/** A `fetch` that records JSON bodies and answers like the Messages API. */
function recordingFetch() {
  const sent: Body[] = [];
  const impl = async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Body);
    return new Response(JSON.stringify(TEXT_REPLY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { sent, impl };
}

const ask = (model: string, over: Partial<LLMRequest> = {}): LLMRequest => ({
  model,
  messages: [{ role: 'user', content: 'think about it' }],
  thinking: { budget: 2048 },
  ...over,
});

const ADAPTIVE = { type: 'adaptive', display: 'summarized' };
const budgetOf = (n: number) => ({ type: 'enabled', budget_tokens: n });

afterEach(() => {
  disableDevMode();
  vi.restoreAllMocks();
});

// ── Unit — the table ────────────────────────────────────────────────────

describe('unit: the one table — every family the docs list', () => {
  // Claude API ids, dated snapshots and aliases, from the models overview and
  // the deprecation table (platform.claude.com, fetched 2026-10-08).
  const CASES: ReadonlyArray<readonly [string, ThinkingMode]> = [
    // Adaptive only — budget_tokens is a 400 (Claude 4.7 and later).
    ['claude-fable-5-1', 'adaptive'],
    ['claude-mythos-5-1', 'adaptive'],
    ['claude-fable-5', 'adaptive'],
    ['claude-mythos-5', 'adaptive'],
    ['claude-opus-5-5', 'adaptive'],
    ['claude-opus-5', 'adaptive'],
    ['claude-opus-4-8', 'adaptive'],
    ['claude-opus-4-7', 'adaptive'],
    ['claude-sonnet-5-5', 'adaptive'],
    ['claude-sonnet-5', 'adaptive'],
    ['claude-haiku-5-5', 'adaptive'],
    // Both — adaptive: its display defaults to "omitted", which a budget body
    // cannot change, so a budget would return empty thinking.
    ['claude-mythos-preview', 'adaptive'],
    // Both — the budget is sent (deprecated there, accepted).
    ['claude-opus-4-6', 'budget'],
    ['claude-sonnet-4-6', 'budget'],
    // Budget only — adaptive is a 400.
    ['claude-opus-4-5-20251101', 'budget'],
    ['claude-opus-4-5', 'budget'],
    ['claude-sonnet-4-5-20250929', 'budget'],
    ['claude-sonnet-4-5', 'budget'],
    ['claude-haiku-4-5-20251001', 'budget'],
    ['claude-haiku-4-5', 'budget'],
    ['claude-opus-4-1-20250805', 'budget'],
    ['claude-opus-4-20250514', 'budget'],
    ['claude-opus-4-0', 'budget'],
    ['claude-sonnet-4-20250514', 'budget'],
    ['claude-sonnet-4-0', 'budget'],
    ['claude-3-7-sonnet-20250219', 'budget'],
    ['claude-3-7-sonnet-latest', 'budget'],
    // No thinking.
    ['claude-3-5-sonnet-20241022', 'none'],
    ['claude-3-5-haiku-20241022', 'none'],
    ['claude-3-opus-20240229', 'none'],
    ['claude-3-sonnet-20240229', 'none'],
    ['claude-3-haiku-20240307', 'none'],
  ];
  for (const [id, mode] of CASES) {
    it(`${id} → ${mode}`, () => expect(anthropicThinkingMode(id)).toBe(mode));
  }

  it('platform ids resolve like the Claude API id (Bedrock, Vertex, ARNs, Claude Code)', () => {
    const platform: ReadonlyArray<readonly [string, ThinkingMode]> = [
      ['anthropic.claude-opus-5-5', 'adaptive'],
      ['global.anthropic.claude-opus-4-6-v1', 'budget'],
      ['us.anthropic.claude-opus-4-6-v1', 'budget'],
      ['anthropic.claude-sonnet-4-6', 'budget'],
      ['jp.anthropic.claude-sonnet-4-6', 'budget'],
      ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'budget'],
      ['eu.anthropic.claude-haiku-4-5-20251001-v1:0', 'budget'],
      [
        'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0',
        'budget',
      ],
      ['claude-opus-4-5@20251101', 'budget'],
      ['claude-opus-4@20250514', 'budget'],
      ['claude-sonnet-4@20250514', 'budget'],
      ['claude-3-5-haiku@20241022', 'none'],
      ['publishers/anthropic/models/claude-opus-4-1@20250805', 'budget'],
      ['claude-opus-5-5[1m]', 'adaptive'],
      ['CLAUDE-HAIKU-4-5', 'budget'],
      // Dotted aliases, as routers spell them.
      ['claude-sonnet-4.5', 'budget'],
      ['anthropic/claude-3.7-sonnet', 'budget'],
      ['claude-3.5-haiku', 'none'],
      ['claude-opus-4.6', 'budget'],
    ];
    for (const [id, mode] of platform) expect(anthropicThinkingMode(id), id).toBe(mode);
  });

  it('an UNKNOWN id is adaptive — the current family — and no shorter family claims a newer one', () => {
    for (const id of [
      'claude-opus-6',
      'claude-sonnet-6-1',
      'claude-haiku-6',
      'claude-opus-4-9', // not Opus 4: a minor version is not a snapshot suffix
      'claude-sonnet-4-7',
      'claude-3-9-sonnet',
      'my-team-deployment',
      'gpt-5',
      '',
    ]) {
      expect(anthropicThinkingMode(id), id).toBe('adaptive');
    }
  });

  it('every family resolves to itself — no family id is claimed by another', () => {
    for (const [family, mode] of Object.entries(ANTHROPIC_THINKING_MODES)) {
      expect(anthropicThinkingMode(family), family).toBe(mode);
      for (const other of Object.keys(ANTHROPIC_THINKING_MODES)) {
        if (other === family || !family.startsWith(other)) continue;
        // A longer family that starts with a shorter one must not read as it:
        // the rest is a version number, never a snapshot suffix.
        expect(/^-\d{1,2}(?![0-9])/.test(family.slice(other.length)), `${other} ⊂ ${family}`).toBe(
          true,
        );
      }
    }
  });
});

// ── Scenario — the wire shape per family ────────────────────────────────

describe('scenario: anthropic() sends the shape the model takes', () => {
  const ONE_PER_FAMILY: ReadonlyArray<readonly [string, ThinkingMode]> = Object.entries(
    ANTHROPIC_THINKING_MODES,
  ).filter(([, mode]) => mode !== 'none') as never;

  for (const [model, mode] of ONE_PER_FAMILY) {
    it(`${model}: ${mode === 'budget' ? 'budget_tokens' : 'adaptive, no budget'}`, async () => {
      const { sent, client } = sdk();
      await anthropic({ _client: client }).complete(ask(model));
      expect(sent[0]!.model).toBe(model);
      expect(sent[0]!.thinking).toEqual(mode === 'budget' ? budgetOf(2048) : ADAPTIVE);
      // The budget never rides an adaptive body, under any key.
      if (mode === 'adaptive') expect(JSON.stringify(sent[0])).not.toContain('budget_tokens');
    });
  }

  it('the streaming path sends the same shape', async () => {
    for (const [model, want] of [
      ['claude-opus-5-5', ADAPTIVE],
      ['claude-haiku-4-5', budgetOf(2048)],
    ] as const) {
      const { sent, client } = sdk();
      for await (const _chunk of anthropic({ _client: client }).stream!(ask(model))) {
        // drain
      }
      expect(sent[0]!.thinking, model).toEqual(want);
    }
  });

  it("the 'anthropic' shorthand resolves to the default model before the shape is chosen", async () => {
    const { sent, client } = sdk();
    const provider = anthropic({ _client: client, defaultModel: 'claude-sonnet-5-5' });
    await provider.complete(ask('anthropic'));
    expect(sent[0]!.model).toBe('claude-sonnet-5-5');
    expect(sent[0]!.thinking).toEqual(ADAPTIVE);
    expect(provider.thinkingMode?.('anthropic')).toBe('adaptive');
    // The package default (Sonnet 4.5) still takes a budget.
    expect(anthropic({ _client: client }).thinkingMode?.('anthropic')).toBe('budget');
  });

  it('max_tokens stays above the budget in both modes; a roomier request keeps its own', async () => {
    for (const model of ['claude-opus-4-7', 'claude-sonnet-4-6']) {
      const { sent, client } = sdk();
      const provider = anthropic({ _client: client });
      await provider.complete(ask(model, { thinking: { budget: 8000 } })); // default 4096 ≤ 8000
      await provider.complete(ask(model, { thinking: { budget: 8000 }, maxTokens: 20000 }));
      expect(
        sent.map((b) => b.max_tokens),
        model,
      ).toEqual([9024, 20000]);
    }
  });

  it('an adaptive model asked without .thinking() gets no thinking field — unchanged', async () => {
    const { sent, client } = sdk();
    await anthropic({ _client: client }).complete({
      ...ask('claude-opus-5-5'),
      thinking: undefined,
    });
    expect('thinking' in sent[0]!).toBe(false);
    expect(sent[0]!.max_tokens).toBe(4096);
  });

  it('the class form declares and sends the same', async () => {
    const { sent, client } = sdk();
    const provider = new AnthropicProvider({ _client: client });
    expect(provider.thinkingMode('claude-opus-4-8')).toBe('adaptive');
    await provider.complete(ask('claude-opus-4-8'));
    expect(sent[0]!.thinking).toEqual(ADAPTIVE);
  });
});

describe('scenario: browserAnthropic() and invokeModelGateway() share the rule', () => {
  it('browserAnthropic(): adaptive on Opus 4.7, budget on Haiku 4.5 — complete and stream', async () => {
    const { sent, impl } = recordingFetch();
    const provider = browserAnthropic({ apiKey: 'k', _fetch: impl as never });
    await provider.complete(ask('claude-opus-4-7'));
    await provider.complete(ask('claude-haiku-4-5-20251001'));
    expect(sent.map((b) => b.thinking)).toEqual([ADAPTIVE, budgetOf(2048)]);
    expect(provider.thinkingMode?.('browser-anthropic')).toBe('budget'); // its default, Sonnet 4.5
  });

  it('invokeModelGateway(): reads Bedrock ids — the model is in the path, the shape in the body', async () => {
    const { sent, impl } = recordingFetch();
    const urls: string[] = [];
    const gateway = (model: string) =>
      invokeModelGateway({
        baseUrl: 'https://gw.example',
        apiKeyHeader: 'x-api-key',
        apiKey: 'k',
        model,
        fetch: async (url, init) => {
          urls.push(String(url));
          return impl(url, init);
        },
      });
    await gateway('anthropic.claude-opus-5-5').complete(ask('invoke-model-gateway'));
    await gateway('us.anthropic.claude-sonnet-4-5-20250929-v1:0').complete(
      ask('invoke-model-gateway'),
    );
    expect(sent.map((b) => b.thinking)).toEqual([ADAPTIVE, budgetOf(2048)]);
    expect(sent.every((b) => !('model' in b))).toBe(true);
    expect(urls[0]).toContain('/model/anthropic.claude-opus-5-5/invoke');
    expect(gateway('anthropic.claude-opus-5-5').thinkingMode?.('invoke-model-gateway')).toBe(
      'adaptive',
    );
  });
});

// ── Boundary — refused before anything is sent ──────────────────────────

describe('boundary: a request the model cannot take is refused before sending', () => {
  const refusal = async (send: () => Promise<unknown>): Promise<UnsupportedThinkingError> => {
    const err = await send().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnsupportedThinkingError);
    return err as UnsupportedThinkingError;
  };

  it('a model that cannot think — typed, named, not retryable, nothing sent', async () => {
    const { sent, client } = sdk();
    const err = await refusal(() =>
      anthropic({ _client: client }).complete(ask('claude-3-5-haiku-20241022')),
    );
    expect(err).toMatchObject({
      name: 'UnsupportedThinkingError',
      provider: 'anthropic',
      model: 'claude-3-5-haiku-20241022',
      reason: 'no-thinking',
      retryable: false,
    });
    expect(err.message).toMatch(/^\[anthropic\] thinking on 'claude-3-5-haiku-20241022': /);
    expect(sent).toHaveLength(0);
  });

  it('withRetry does not retry the refusal', async () => {
    const { sent, client } = sdk();
    let retries = 0;
    const provider = withRetry(anthropic({ _client: client }), {
      initialDelayMs: 1,
      onRetry: () => (retries += 1),
    });
    await refusal(() => provider.complete(ask('claude-3-haiku-20240307')));
    expect(retries).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('a temperature other than 1 cannot ride with thinking — on either mode', async () => {
    for (const model of ['claude-opus-5-5', 'claude-haiku-4-5']) {
      const { sent, client } = sdk();
      const provider = anthropic({ _client: client });
      const err = await refusal(() => provider.complete(ask(model, { temperature: 0.2 })));
      expect(err.reason).toBe('temperature');
      expect(sent).toHaveLength(0);
      await provider.complete(ask(model, { temperature: 1 }));
      expect(sent[0]!.temperature).toBe(1);
    }
  });

  it('a budget model takes a whole budget of at least 1024; an adaptive model does not care', async () => {
    const { sent, client } = sdk();
    const provider = anthropic({ _client: client });
    for (const budget of [500, 1023, 1500.5]) {
      const err = await refusal(() =>
        provider.complete(ask('claude-sonnet-4-6', { thinking: { budget } })),
      );
      expect(err.reason, String(budget)).toBe('budget');
    }
    expect(sent).toHaveLength(0);
    await provider.complete(ask('claude-sonnet-4-6', { thinking: { budget: 1024 } }));
    await provider.complete(ask('claude-opus-5-5', { thinking: { budget: 500 } }));
    expect(sent.map((b) => b.thinking)).toEqual([budgetOf(1024), ADAPTIVE]);
    expect(sent[1]!.max_tokens).toBe(4096); // already above 500: kept
  });

  it('a forced tool choice cannot ride with BUDGET thinking; adaptive takes it', async () => {
    const forced: Partial<LLMRequest> = {
      tools: [{ name: 'answer', description: 'd', inputSchema: { type: 'object' } }],
      toolChoice: { type: 'tool', name: 'answer' },
    };
    const { sent, client } = sdk();
    const provider = anthropic({ _client: client });
    const err = await refusal(() => provider.complete(ask('claude-haiku-4-5', forced)));
    expect(err.reason).toBe('forced-tool-choice');
    expect(sent).toHaveLength(0);
    await provider.complete(ask('claude-opus-4-8', forced));
    expect(sent[0]).toMatchObject({ thinking: ADAPTIVE, tool_choice: { type: 'tool' } });
    // A choice with no tools never reaches the wire, so it is no conflict.
    await provider.complete(ask('claude-haiku-4-5', { toolChoice: forced.toolChoice! }));
    expect(sent[1]!.thinking).toEqual(budgetOf(2048));
  });

  it('the browser and gateway adapters refuse with their own names', async () => {
    const browser = recordingFetch();
    const err1 = await refusal(() =>
      browserAnthropic({ apiKey: 'k', _fetch: browser.impl as never }).complete(
        ask('claude-3-opus-20240229'),
      ),
    );
    expect(err1.provider).toBe('browser-anthropic');
    const gw = recordingFetch();
    let keyReads = 0;
    const err2 = await refusal(() =>
      invokeModelGateway({
        baseUrl: 'https://gw.example',
        apiKeyHeader: 'x-api-key',
        apiKey: () => {
          keyReads += 1;
          return 'k';
        },
        model: 'claude-3-5-haiku@20241022',
        fetch: gw.impl,
      }).complete(ask('invoke-model-gateway')),
    );
    expect(err2.provider).toBe('invoke-model-gateway');
    expect([browser.sent.length, gw.sent.length, keyReads]).toEqual([0, 0, 0]);
  });
});

// ── Integration — the agent ─────────────────────────────────────────────

const lookup = defineTool<{ key: string }, string>({
  name: 'lookup',
  description: 'Look a key up.',
  inputSchema: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
    additionalProperties: false,
  },
  execute: async ({ key }) => `${key}: green`,
});

describe('integration: Agent.build() refuses a model that cannot think', () => {
  const build = (provider: LLMProvider, model: string) =>
    Agent.create({ provider, model }).system('s').thinking({ budget: 2000 }).build();

  it('by name, with the typed error — before any run', () => {
    const { sent, client } = sdk();
    let err: unknown;
    try {
      build(anthropic({ _client: client }), 'claude-3-haiku-20240307');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnsupportedThinkingError);
    expect(err).toMatchObject({
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307',
      reason: 'no-thinking',
    });
    expect((err as Error).message).toContain('for the agent');
    expect(sent).toHaveLength(0);
  });

  it('through a renaming wrapper — the declaration is forwarded, not looked up by name', () => {
    const { client } = sdk();
    expect(() =>
      build(
        withRetry(withCircuitBreaker(anthropic({ _client: client }))),
        'claude-3-opus-20240229',
      ),
    ).toThrow(UnsupportedThinkingError);
  });

  it("for a skill's brain — the model the thinking request reaches through the graph", () => {
    const { client } = sdk();
    const triage = defineSkill({ id: 'triage', description: 'use triage', body: 't' });
    const billing = defineSkill({
      id: 'billing',
      description: 'use billing',
      body: 'b',
      model: 'claude-3-5-sonnet-20241022',
    });
    const graph = skillGraph().entry(triage).route(triage, billing).build();
    expect(() =>
      Agent.create({ provider: anthropic({ _client: client }), model: 'claude-opus-5-5' })
        .system('s')
        .skillGraph(graph)
        .thinking({ budget: 2000 })
        .build(),
    ).toThrow(/for skill 'billing'/);
  });

  it('for the escalation brain (the check, unit-level)', () => {
    const { client } = sdk();
    const provider = anthropic({ _client: client });
    expect(() =>
      checkThinkingSupport({
        budget: 2000,
        provider,
        model: 'claude-opus-5-5',
        brains: {
          bySkill: new Map(),
          escalation: { provider, model: 'claude-3-sonnet-20240229', afterRefusals: 2 },
        },
      }),
    ).toThrow(/for the escalation brain/);
  });

  it('builds on a thinking model, and on a non-thinking one without .thinking()', () => {
    const { client } = sdk();
    expect(() => build(anthropic({ _client: client }), 'claude-haiku-4-5')).not.toThrow();
    expect(() => build(anthropic({ _client: client }), 'claude-opus-5-5')).not.toThrow();
    expect(() =>
      Agent.create({ provider: anthropic({ _client: client }), model: 'claude-3-haiku-20240307' })
        .system('s')
        .build(),
    ).not.toThrow();
  });

  it('a malformed declaration is refused at build, naming the provider', () => {
    const base: LLMProvider = {
      name: 'custom-wire',
      complete: async () => ({ content: '', toolCalls: [], usage: { input: 0, output: 0 } }),
    };
    expect(() => build({ ...base, thinkingMode: () => 'sometimes' as never }, 'm')).toThrow(
      /'custom-wire' provider's thinkingMode\('m'\) answered "sometimes"/,
    );
    expect(() => build({ ...base, thinkingMode: 'adaptive' as never }, 'm')).toThrow(TypeError);
  });
});

describe('integration: dev mode says when an adaptive model will not send the budget', () => {
  it('once per model per process, and never for a budget model', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = sdk();
    const build = (model: string) =>
      Agent.create({ provider: anthropic({ _client: client }), model })
        .system('s')
        .thinking({ budget: 3000 })
        .build();
    build('claude-sonnet-5'); // adaptive
    build('claude-sonnet-5'); // same model — already said
    build('claude-sonnet-4-5'); // budget — nothing to say
    const said = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('takes no budget'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("'claude-sonnet-5' on 'anthropic'");
    expect(said[0]).toContain('.thinking({ budget: 3000 })');
  });

  it('silent outside dev mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = sdk();
    Agent.create({ provider: anthropic({ _client: client }), model: 'claude-fable-5-1' })
      .system('s')
      .thinking({ budget: 3000 })
      .build();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('takes no budget'))).toBe(false);
  });
});

describe('integration: the round trip, adaptive and budget', () => {
  const SIG = 'sig-adaptive-omitted-1';

  async function twoCalls(model: string, firstThinking: unknown): Promise<Body[]> {
    const { sent, client } = sdk([
      {
        ...TEXT_REPLY,
        content: [
          firstThinking,
          { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { key: 'k' } },
        ],
        stop_reason: 'tool_use',
      },
      { ...TEXT_REPLY, content: [{ type: 'text', text: 'k is green.' }] },
    ]);
    const agent = Agent.create({
      provider: anthropic({ _client: client }),
      model,
      maxIterations: 3,
    })
      .system('Look things up.')
      .tool(lookup)
      .thinking({ budget: 4096 })
      .build();
    await agent.run({ message: 'is k green?' });
    return sent;
  }

  const assistantTurn = (body: Body) =>
    (body.messages as { role: string; content: unknown }[]).find(
      (m) => m.role === 'assistant' && Array.isArray(m.content),
    )!.content as Record<string, unknown>[];

  it('adaptive: an EMPTY signed block (display omitted / a progress note) is echoed first, unchanged', async () => {
    const sent = await twoCalls('claude-opus-5-5', {
      type: 'thinking',
      thinking: '',
      signature: SIG,
    });
    expect(sent).toHaveLength(2);
    expect(sent.map((b) => b.thinking)).toEqual([ADAPTIVE, ADAPTIVE]);
    expect(assistantTurn(sent[1]!)[0]).toEqual({ type: 'thinking', thinking: '', signature: SIG });
  });

  it('budget: a redacted block is echoed as the API takes it, { type, data }', async () => {
    const sent = await twoCalls('claude-sonnet-4-6', { type: 'redacted_thinking', data: 'enc-1' });
    expect(sent.map((b) => b.thinking)).toEqual([budgetOf(4096), budgetOf(4096)]);
    expect(assistantTurn(sent[1]!)[0]).toEqual({ type: 'redacted_thinking', data: 'enc-1' });
  });

  it('a model picked at run time by .configure() is refused by the adapter, before sending', async () => {
    const { sent, client } = sdk();
    const agent = Agent.create({
      provider: anthropic({ _client: client }),
      model: 'claude-opus-5-5',
    })
      .system('s')
      .configure(() => ({ model: 'claude-3-haiku-20240307' }))
      .thinking({ budget: 2000 })
      .build();
    await expect(agent.run({ message: 'hi' })).rejects.toBeInstanceOf(UnsupportedThinkingError);
    expect(sent).toHaveLength(0);
  });
});

// ── Resilience — each side sends its own shape ──────────────────────────

describe('resilience: withFallback hands each side the intent; each sends its own shape', () => {
  it('primary on Opus 5.5 (adaptive) fails; fallback on Haiku 4.5 sends budget_tokens', async () => {
    const primary = sdk([TEXT_REPLY], true);
    const fallback = sdk();
    const pair = withFallback(
      anthropic({ _client: primary.client, defaultModel: 'claude-opus-5-5' }),
      anthropic({ _client: fallback.client, defaultModel: 'claude-haiku-4-5' }),
    );
    await pair.complete(ask('anthropic'));
    expect(primary.sent[0]!.thinking).toEqual(ADAPTIVE);
    expect(fallback.sent[0]!.thinking).toEqual(budgetOf(2048));
  });

  it('the stream path too', async () => {
    const primary = sdk([TEXT_REPLY], true);
    const fallback = sdk();
    const pair = withFallback(
      anthropic({ _client: primary.client, defaultModel: 'claude-haiku-4-5' }),
      anthropic({ _client: fallback.client, defaultModel: 'claude-fable-5-1' }),
    );
    for await (const _chunk of pair.stream!(ask('anthropic'))) {
      // drain
    }
    expect([primary.sent[0]!.thinking, fallback.sent[0]!.thinking]).toEqual([
      budgetOf(2048),
      ADAPTIVE,
    ]);
  });

  it('the pair declares the LEAST either side promises; an undeclared side makes no claim', () => {
    const { client } = sdk();
    const on = (model: string) => anthropic({ _client: client, defaultModel: model });
    expect(
      withFallback(on('claude-haiku-4-5'), on('claude-opus-5-5')).thinkingMode?.('anthropic'),
    ).toBe('adaptive');
    expect(
      withFallback(on('claude-haiku-4-5'), on('claude-sonnet-4-6')).thinkingMode?.('anthropic'),
    ).toBe('budget');
    expect(
      withFallback(on('claude-opus-5-5'), on('claude-3-haiku-20240307')).thinkingMode?.(
        'anthropic',
      ),
    ).toBe('none');
    expect(withFallback(mock(), on('claude-opus-5-5')).thinkingMode?.('anthropic')).toBe(
      'adaptive',
    );
    expect(withFallback(mock(), mock()).thinkingMode).toBeUndefined();
  });

  it('so a fallback that cannot think is refused at build, not on the call it serves', () => {
    const { client } = sdk();
    const pair = withFallback(
      anthropic({ _client: client, defaultModel: 'claude-opus-5-5' }),
      anthropic({ _client: client, defaultModel: 'claude-3-5-haiku-20241022' }),
    );
    expect(() =>
      Agent.create({ provider: pair, model: 'anthropic' })
        .system('s')
        .thinking({ budget: 2000 })
        .build(),
    ).toThrow(UnsupportedThinkingError);
  });

  it('withRetry and withCircuitBreaker forward the same declaration', () => {
    const { client } = sdk();
    const inner = anthropic({ _client: client });
    expect(withRetry(inner).thinkingMode).toBe(inner.thinkingMode);
    expect(withCircuitBreaker(inner).thinkingMode).toBe(inner.thinkingMode);
  });

  it('a refused request surfaces: withFallback does not move it to the other side', async () => {
    const primary = sdk();
    const fallback = sdk();
    const pair = withFallback(
      anthropic({ _client: primary.client, defaultModel: 'claude-haiku-4-5' }),
      anthropic({ _client: fallback.client, defaultModel: 'claude-opus-5-5' }),
    );
    // A budget below 1024 is refused by the budget side before sending.
    const err = await pair.complete(ask('anthropic', { thinking: { budget: 500 } })).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnsupportedThinkingError);
    expect([primary.sent.length, fallback.sent.length]).toEqual([0, 0]);
  });

  it('…and withCircuitBreaker does not count it, so healthy calls still go through', async () => {
    const { sent, client } = sdk();
    const breaker = withCircuitBreaker(anthropic({ _client: client }), { failureThreshold: 1 });
    for (let i = 0; i < 3; i++) {
      await expect(breaker.complete(ask('claude-3-haiku-20240307'))).rejects.toBeInstanceOf(
        UnsupportedThinkingError,
      );
    }
    await breaker.complete(ask('claude-haiku-4-5'));
    expect(sent).toHaveLength(1);
  });
});

// ── The adapter's thinkingMode option — one function, declared AND sent ──

describe("the adapters' thinkingMode option: the declaration and the wire are one function", () => {
  it('an opaque id behind a budget-only model: declared budget, sent budget', async () => {
    const { sent, impl } = recordingFetch();
    const gateway = invokeModelGateway({
      baseUrl: 'https://gw.example',
      apiKeyHeader: 'x-api-key',
      apiKey: 'k',
      model: 'haiku-fast', // an alias the table cannot read
      thinkingMode: (id) => (id === 'haiku-fast' ? 'budget' : undefined),
      fetch: impl,
    });
    expect(gateway.thinkingMode?.('invoke-model-gateway')).toBe('budget');
    await gateway.complete(ask('invoke-model-gateway'));
    expect(sent[0]!.thinking).toEqual(budgetOf(2048));
  });

  it('without the option the same alias is read as adaptive — the documented default', async () => {
    const { sent, impl } = recordingFetch();
    const gateway = invokeModelGateway({
      baseUrl: 'https://gw.example',
      apiKeyHeader: 'x-api-key',
      apiKey: 'k',
      model: 'haiku-fast',
      fetch: impl,
    });
    expect(gateway.thinkingMode?.('invoke-model-gateway')).toBe('adaptive');
    await gateway.complete(ask('invoke-model-gateway'));
    expect(sent[0]!.thinking).toEqual(ADAPTIVE);
  });

  it('Opus 4.6 declared adaptive: sent adaptive, and a forced tool choice then rides', async () => {
    const forced: Partial<LLMRequest> = {
      tools: [{ name: 'answer', description: 'd', inputSchema: { type: 'object' } }],
      toolChoice: { type: 'tool', name: 'answer' },
    };
    const f = sdk();
    const provider = anthropic({
      _client: f.client,
      thinkingMode: (id) => (id.startsWith('claude-opus-4-6') ? 'adaptive' : undefined),
    });
    expect(provider.thinkingMode?.('claude-opus-4-6')).toBe('adaptive');
    expect(provider.thinkingMode?.('claude-sonnet-4-6')).toBe('budget'); // undefined → the table
    await provider.complete(ask('claude-opus-4-6', forced));
    expect(f.sent[0]).toMatchObject({ thinking: ADAPTIVE, tool_choice: { type: 'tool' } });
    // The browser adapter takes the same option.
    const { sent, impl } = recordingFetch();
    const browser = browserAnthropic({
      apiKey: 'k',
      thinkingMode: () => 'adaptive',
      _fetch: impl as never,
    });
    await browser.complete(ask('claude-sonnet-4-6'));
    expect(sent[0]!.thinking).toEqual(ADAPTIVE);
  });

  it("the agent's build check reads the same answer — 'none' from the option is refused at build", () => {
    const { sent, client } = sdk();
    const provider = anthropic({ _client: client, thinkingMode: () => 'none' });
    expect(() =>
      Agent.create({ provider, model: 'claude-opus-5-5' })
        .system('s')
        .thinking({ budget: 2000 })
        .build(),
    ).toThrow(UnsupportedThinkingError);
    expect(sent).toHaveLength(0);
  });

  it('an answer that is not a mode is refused — at build by the agent, at the request by the adapter', async () => {
    const { sent, client } = sdk();
    const provider = anthropic({ _client: client, thinkingMode: () => 'sometimes' as never });
    expect(() =>
      Agent.create({ provider, model: 'claude-opus-5-5' })
        .system('s')
        .thinking({ budget: 2000 })
        .build(),
    ).toThrow(TypeError);
    await expect(provider.complete(ask('claude-opus-5-5'))).rejects.toThrow(
      /thinkingMode\('claude-opus-5-5'\) answered "sometimes"/,
    );
    expect(sent).toHaveLength(0);
  });
});

// ── Regression — the mock is untouched ──────────────────────────────────

describe('regression: the mock provider is untouched', () => {
  it('declares no thinking mode, and still receives the intent exactly as before', async () => {
    const provider = mock({ replies: ['ok'] });
    expect(provider.thinkingMode).toBeUndefined();
    // Whichever door the agent uses — complete() or stream().
    const asked: LLMRequest[] = [];
    const complete = provider.complete.bind(provider);
    const stream = provider.stream.bind(provider);
    vi.spyOn(provider, 'complete').mockImplementation((req, hooks) => {
      asked.push(req);
      return complete(req, hooks);
    });
    vi.spyOn(provider, 'stream').mockImplementation((req, hooks) => {
      asked.push(req);
      return stream(req, hooks);
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .thinking({ budget: 100 }) // below Anthropic's minimum — the mock has no such rule
      .build();
    await agent.run({ message: 'hi' });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.thinking).toEqual({ budget: 100 });
  });
});

// ── Property — seeded ids keep their family ─────────────────────────────

describe('property: decorated ids keep their family; a version number never borrows one', () => {
  const PREFIXES = [
    '',
    'anthropic.',
    'us.anthropic.',
    'global.anthropic.',
    'arn:aws:bedrock:eu-west-1:1:inference-profile/eu.anthropic.',
  ];
  const SUFFIXES = ['', '-20260101', '@20260101', '-v1:0', '-v2', ':0', '[1m]', '-20251001-v1:0'];

  it('every family × 200 seeded decorations', () => {
    const next = seeded(20261008);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
    for (const [family, mode] of Object.entries(ANTHROPIC_THINKING_MODES)) {
      for (let i = 0; i < 200; i++) {
        const id = `${pick(PREFIXES)}${family}${pick(SUFFIXES)}`;
        expect(anthropicThinkingMode(id), id).toBe(mode);
      }
    }
  });

  it('family + "-<n>" is that other family when it exists, else unknown (adaptive)', () => {
    for (const family of Object.keys(ANTHROPIC_THINKING_MODES)) {
      for (let n = 1; n < 100; n++) {
        const id = `${family}-${n}`;
        expect(anthropicThinkingMode(id), id).toBe(ANTHROPIC_THINKING_MODES[id] ?? 'adaptive');
      }
    }
  });
});

// ── Performance ─────────────────────────────────────────────────────────

describe('performance: the lookup is linear in the ids asked', () => {
  it('ten times the ids, ten times the work', { timeout: 30_000, retry: 2 }, async () => {
    const ids = Object.keys(ANTHROPIC_THINKING_MODES).map((f) => `us.anthropic.${f}-20260101-v1:0`);
    const lookups = (n: number) => () => {
      for (let i = 0; i < n; i++) anthropicThinkingMode(ids[i % ids.length]!);
    };
    await expectScalesLinearly({
      small: lookups(20_000),
      large: lookups(200_000),
      scale: 10,
      why: 'one table walk per request — no growth with use',
    });
  });
});
