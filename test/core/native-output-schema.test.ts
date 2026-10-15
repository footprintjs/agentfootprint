/**
 * `.outputSchema(parser, { strategy: 'native' })` — the provider's own
 * structured output, end to end through the agent.
 *
 * Test types: Regression (the Haiku 4.5 pilot's failure shape — prose plus a
 * fenced JSON block — rejected under `'instruct'`) · Contract (the request
 * carries the wire copy; the parser still judges; `answerGuarantee: 'native'`;
 * tools stay usable) · Refusal (build: no schema, an inexpressible schema;
 * run start: a provider or model without the capability — by name, nothing
 * sent) · Findings (`_findings` on the wire only when armed; answer standings
 * still filed under `additionalProperties: false`) · Stops (a `'refusal'` or
 * `'max_tokens'` stop fails the attempt by name even when the text parses —
 * on the row, on the unmet record, and at `runTyped()`; a retry recovers).
 *
 * No network: a scripted mock behind a recording wrapper, or `anthropic()`
 * over a fake SDK client.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, defineTool, OutputSchemaError, receiptAt } from '../../src/index.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider.js';
import { UnsupportedNativeOutputError } from '../../src/providers.js';
import { NativeOutputSchemaError } from '../../src/core/agent/nativeOutputFormat.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';
import type { OutputAttempt } from '../../src/core/agent/outputEnforcement.js';

const SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'err'] },
    note: { type: 'string', maxLength: 40 },
  },
  required: ['status'],
};

interface Verdict {
  readonly status: 'ok' | 'err';
}

/** A hand-written parser: the judge, independent of the wire schema. */
const Verdict = {
  parse(value: unknown): Verdict {
    const v = value as { status?: unknown };
    if (typeof value !== 'object' || value === null || (v.status !== 'ok' && v.status !== 'err')) {
      throw new Error('status must be "ok" or "err"');
    }
    return { status: v.status };
  },
};

/** The scripted mock, with every request it was handed kept for inspection. */
function recordingMock(replies: readonly Partial<LLMResponse>[]): {
  provider: LLMProvider;
  requests: LLMRequest[];
} {
  const inner = mock({ replies: [...replies] });
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'mock',
    carriesNativeOutputSchema: inner.carriesNativeOutputSchema,
    complete: (req) => {
      requests.push(req);
      return inner.complete(req);
    },
  };
  return { provider, requests };
}

const state = (agent: Agent) => agent.getSnapshot()?.sharedState as Record<string, unknown>;
const attempts = (agent: Agent) => (state(agent).outputAttempts ?? []) as OutputAttempt[];

describe("the pilot's failure shape under 'instruct'", () => {
  it('prose plus a fenced JSON block is rejected — asking in prose is not enforcement', async () => {
    const pilotAnswer = 'Here is the result:\n\n```json\n{"status":"ok"}\n```\n\nLet me know!';
    const agent = Agent.create({ provider: mock({ reply: pilotAnswer }), model: 'mock' })
      .outputSchema(Verdict)
      .build();
    const err = await agent.runTyped({ message: 'status?' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OutputSchemaError);
    expect((err as OutputSchemaError).stage).toBe('json-parse');
    expect(attempts(agent).map((a) => a.outcome)).toEqual(['exhausted']);
  });
});

describe("strategy: 'native'", () => {
  it('sends the wire copy, judges with the parser, and names the guarantee', async () => {
    const { provider, requests } = recordingMock([{ content: '{"status":"ok"}' }]);
    const agent = Agent.create({ provider, model: 'mock' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    await expect(agent.runTyped({ message: 'status?' })).resolves.toEqual({ status: 'ok' });
    expect(requests[0].outputFormat).toEqual({
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'err'] },
          note: { type: 'string', description: '{maxLength: 40}' },
        },
        required: ['status'],
        additionalProperties: false,
      },
    });
    expect(state(agent).answerGuarantee).toBe('native');
    expect(attempts(agent).map((a) => a.outcome)).toEqual(['passed']);
  });

  it('keeps the tools: the model may call one first, then answers in JSON', async () => {
    const lookup = defineTool({
      name: 'lookup',
      description: 'looks up the status',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'all systems ok',
    });
    const { provider, requests } = recordingMock([
      { toolCalls: [{ id: 'c1', name: 'lookup', args: {} }] },
      { content: '{"status":"ok"}' },
    ]);
    const agent = Agent.create({ provider, model: 'mock' })
      .tool(lookup)
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    await expect(agent.runTyped({ message: 'status?' })).resolves.toEqual({ status: 'ok' });
    expect(requests).toHaveLength(2);
    for (const req of requests) {
      expect(req.tools?.map((t) => t.name)).toContain('lookup');
      expect(req.outputFormat?.type).toBe('json_schema');
      expect(req.toolChoice).toBeUndefined();
    }
  });

  it('streams through the real Anthropic adapter: output_config.format on the wire, the pieces accumulated before the parser judges', async () => {
    const sent: Record<string, unknown>[] = [];
    const pieces = ['{"sta', 'tus":"', 'err"}'];
    const message = {
      id: 'm1',
      model: 'claude-haiku-4-5-20251001',
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: pieces.join('') }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 4 },
    };
    const client = {
      messages: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          sent.push(params);
          return message;
        }),
        stream: vi.fn((params: Record<string, unknown>) => {
          sent.push(params);
          return {
            async *[Symbol.asyncIterator]() {
              for (const text of pieces) {
                yield {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text },
                };
              }
            },
            finalMessage: async () => message,
          };
        }),
      },
    };
    const tokens: string[] = [];
    const agent = Agent.create({
      provider: anthropic({ _client: client as never }),
      model: 'claude-haiku-4-5-20251001',
    })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    agent.on('agentfootprint.stream.token', (e) => tokens.push(e.payload.content));
    await expect(agent.runTyped({ message: 'status?' })).resolves.toEqual({ status: 'err' });
    expect(tokens.join('')).toBe('{"status":"err"}');
    const config = sent[0].output_config as { format: { type: string; schema: unknown } };
    expect(config.format.type).toBe('json_schema');
    expect((config.format.schema as { additionalProperties: unknown }).additionalProperties).toBe(
      false,
    );
  });
});

describe('refused by name', () => {
  it('at build: no JSON Schema to send', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: '{}' }), model: 'mock' })
        .outputSchema(Verdict, { strategy: 'native' })
        .build(),
    ).toThrow(/strategy 'native' sends the schema/);
  });

  it('at build: a schema the API cannot express (recursion)', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: '{}' }), model: 'mock' })
        .outputSchema(Verdict, {
          strategy: 'native',
          jsonSchema: { type: 'object', properties: { next: { $ref: '#' } } },
        })
        .build(),
    ).toThrow(NativeOutputSchemaError);
  });

  it('at run start: a provider that does not declare the capability', async () => {
    const complete = vi.fn();
    const agent = Agent.create({ provider: { name: 'plain', complete }, model: 'x' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    await expect(agent.run({ message: 'q' })).rejects.toThrow(/'plain' does not declare one/);
    expect(complete).not.toHaveBeenCalled();
  });

  it('at run start: a model the page does not list', async () => {
    const create = vi.fn();
    const agent = Agent.create({
      provider: anthropic({ _client: { messages: { create } } as never }),
      model: 'claude-opus-4-1',
    })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    const err = await agent.run({ message: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedNativeOutputError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('the reserved _findings key', () => {
  const lookup = defineTool({
    name: 'lookup',
    description: 'looks up the status',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'all systems ok',
  });

  it('unarmed: the format carries no _findings', async () => {
    const { provider, requests } = recordingMock([{ content: '{"status":"ok"}' }]);
    await Agent.create({ provider, model: 'mock' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build()
      .run({ message: 'q' });
    const props = (requests[0].outputFormat?.schema as { properties: object }).properties;
    expect(Object.keys(props)).toEqual(['status', 'note']);
  });

  it('armed: the format allows _findings, and an answer standing is still filed', async () => {
    const answer = JSON.stringify({
      status: 'ok',
      _findings: { previous: [{ toolCallId: 'c1', standing: 'noise' }] },
    });
    const { provider, requests } = recordingMock([
      { toolCalls: [{ id: 'c1', name: 'lookup', args: { _findings: { basis: 'direct' } } }] },
      { content: answer },
    ]);
    const agent = Agent.create({ provider, model: 'mock' })
      .tool(lookup)
      .findings()
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    await expect(agent.runTyped({ message: 'q' })).resolves.toEqual({ status: 'ok' });
    const props = (requests[0].outputFormat?.schema as { properties: Record<string, unknown> })
      .properties;
    expect(Object.keys(props)).toEqual(['status', 'note', '_findings']);
    const rows = agent.findings() ?? [];
    expect(
      rows.some((r) => {
        const row = r as { declaredOn?: unknown; standing?: unknown };
        return row.declaredOn === 'answer' && row.standing === 'noise';
      }),
    ).toBe(true);
  });
});

describe("a 'refusal' or 'max_tokens' stop", () => {
  it('fails the attempt by name even when the text parses, and runTyped refuses it', async () => {
    const { provider } = recordingMock([{ content: '{"status":"ok"}', stopReason: 'refusal' }]);
    const agent = Agent.create({ provider, model: 'mock' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    const err = await agent.runTyped({ message: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OutputSchemaError);
    expect((err as Error).message).toMatch(/stop_reason 'refusal'/);
    expect(attempts(agent)).toMatchObject([{ outcome: 'exhausted', stopReason: 'refusal' }]);
    expect(agent.outputContractUnmet()?.stopReason).toBe('refusal');
  });

  it('a cut-off answer names max_tokens; a retry recovers and the row says why it retried', async () => {
    const { provider } = recordingMock([
      { content: '{"status":"o', stopReason: 'max_tokens' },
      { content: '{"status":"ok"}' },
    ]);
    const agent = Agent.create({ provider, model: 'mock' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA, retries: 1 })
      .build();
    await expect(agent.runTyped({ message: 'q' })).resolves.toEqual({ status: 'ok' });
    expect(attempts(agent)).toMatchObject([
      { outcome: 'retried', stopReason: 'max_tokens' },
      { outcome: 'passed' },
    ]);
    expect(attempts(agent)[0].error).toMatch(/max_tokens/);
  });

  it("under 'instruct' a stop changes nothing: the parser alone judges", async () => {
    const agent = Agent.create({
      provider: mock({ replies: [{ content: '{"status":"ok"}', stopReason: 'refusal' }] }),
      model: 'mock',
    })
      .outputSchema(Verdict)
      .build();
    await expect(agent.runTyped({ message: 'q' })).resolves.toEqual({ status: 'ok' });
    expect('llmLatestStopReason' in state(agent)).toBe(false);
  });
});

describe('review round 1', () => {
  type Node = { stageReads?: Record<string, unknown>; next?: Node; children?: Node[] };
  /** Every key any stage tracked a read of — an absent key read still lands here. */
  const readKeysOf = (agent: Agent): Set<string> => {
    const keys = new Set<string>();
    const walk = (node: Node | undefined): void => {
      if (!node) return;
      for (const key of Object.keys(node.stageReads ?? {})) keys.add(key);
      for (const child of node.children ?? []) walk(child);
      walk(node.next);
    };
    walk(agent.getSnapshot()?.executionTree as Node);
    return keys;
  };

  it('no agent without the native strategy reads the stop key (byte law); a native one does', async () => {
    const instruct = Agent.create({ provider: mock({ reply: '{"status":"ok"}' }), model: 'mock' })
      .outputSchema(Verdict)
      .build();
    const validated = Agent.create({ provider: mock({ reply: '{"status":"ok"}' }), model: 'mock' })
      .outputSchema(Verdict)
      .answerValidation({
        id: 'v',
        version: '1',
        mode: 'enforce',
        validate: () => ({ checks: [{ id: 'v', disposition: 'checked-pass' }] }),
      })
      .build();
    const native = Agent.create({ provider: mock({ reply: '{"status":"ok"}' }), model: 'mock' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    for (const agent of [instruct, validated, native]) await agent.run({ message: 'q' });
    expect(readKeysOf(instruct).has('llmLatestStopReason')).toBe(false);
    expect(readKeysOf(validated).has('llmLatestStopReason')).toBe(false);
    expect(readKeysOf(native).has('llmLatestStopReason')).toBe(true);
  });

  it('the receipt names the format the port carried — type and a run-salted schema hash', async () => {
    const native = Agent.create({ provider: mock({ reply: '{"status":"ok"}' }), model: 'mock' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    const instruct = Agent.create({ provider: mock({ reply: '{"status":"ok"}' }), model: 'mock' })
      .outputSchema(Verdict)
      .build();
    await native.run({ message: 'q' });
    await instruct.run({ message: 'q' });
    const params = receiptAt(native.getSnapshot()!, 1)?.params;
    expect(params?.outputFormat?.type).toBe('json_schema');
    expect(params?.outputFormat?.schemaHash).toMatch(/^[0-9a-f]+$/);
    expect(receiptAt(instruct.getSnapshot()!, 1)?.params.outputFormat).toBeUndefined();
  });

  it('a refusal is not re-asked: it stands exhausted, the provider called once', async () => {
    const { provider, requests } = recordingMock([
      { content: 'I cannot help with that.', stopReason: 'refusal' },
      { content: '{"status":"ok"}' },
    ]);
    const agent = Agent.create({ provider, model: 'mock' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA, retries: 2 })
      .build();
    await expect(agent.runTyped({ message: 'q' })).rejects.toBeInstanceOf(OutputSchemaError);
    expect(requests).toHaveLength(1);
    expect(attempts(agent)).toMatchObject([{ outcome: 'exhausted', stopReason: 'refusal' }]);
  });

  it('answer validation does not accept a refusal-stopped answer that parses', async () => {
    let checked = 0;
    const { provider } = recordingMock([{ content: '{"status":"ok"}', stopReason: 'refusal' }]);
    const agent = Agent.create({ provider, model: 'mock' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .answerValidation({
        id: 'v',
        version: '1',
        mode: 'enforce',
        validate() {
          checked++;
          return { checks: [{ id: 'v', disposition: 'checked-pass' }] };
        },
      })
      .build();
    await expect(agent.runTyped({ message: 'q' })).rejects.toBeDefined();
    expect(checked).toBe(0);
    expect(agent.answerValidation()).toMatchObject({
      status: 'unverified',
      schemaAccepted: false,
      reason: 'provider-stop:refusal',
    });
  });

  it('observe-mode validation reports a provider stop but does not withhold the answer', async () => {
    let checked = 0;
    const { provider } = recordingMock([{ content: '{"status":"ok"}', stopReason: 'refusal' }]);
    const agent = Agent.create({ provider, model: 'mock' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .answerValidation({
        id: 'v',
        version: '1',
        mode: 'observe',
        validate() {
          checked++;
          return { checks: [{ id: 'v', disposition: 'checked-pass' }] };
        },
      })
      .build();
    await expect(agent.run({ message: 'q' })).resolves.toBe('{"status":"ok"}');
    expect(checked).toBe(0);
    expect(agent.answerValidation()).toMatchObject({
      schemaAccepted: false,
      reason: 'provider-stop:refusal',
    });
    expect(agent.outputContractUnmet()?.stopReason).toBe('refusal');
  });

  it('a context-window stop is a truncation too, and the grouped chart carries the stop to Route', async () => {
    const { provider } = recordingMock([
      { content: '{"status":"ok"}', stopReason: 'model_context_window_exceeded' },
    ]);
    const agent = Agent.create({ provider, model: 'mock', reactMode: 'dynamic-grouped' })
      .outputSchema(Verdict, { strategy: 'native', jsonSchema: SCHEMA })
      .build();
    await expect(agent.runTyped({ message: 'q' })).rejects.toBeInstanceOf(OutputSchemaError);
    expect(attempts(agent)).toMatchObject([
      { outcome: 'exhausted', stopReason: 'model_context_window_exceeded' },
    ]);
  });
});
