/** Automatic native output follows the effective request; parsing remains authoritative. */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool, OutputSchemaError } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { NoOpCacheStrategy } from '../../src/cache/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';

const schema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
};
const parser = {
  parse(value: unknown): { ok: boolean } {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof (value as { ok?: unknown }).ok !== 'boolean'
    ) {
      throw new Error('ok must be boolean');
    }
    return { ok: (value as { ok: boolean }).ok };
  },
};
function fixture(
  options: { native?: boolean; stream?: boolean; replies?: Partial<LLMResponse>[] } = {},
) {
  const requests: LLMRequest[] = [];
  const respond = (request: LLMRequest): LLMResponse => {
    requests.push(request);
    return {
      content: '{"ok":true}',
      toolCalls: [],
      usage: { input: 1, output: 1 },
      ...options.replies?.[requests.length - 1],
    };
  };
  const provider: LLMProvider = {
    name: 'auto-fixture',
    ...(options.native !== false && { carriesNativeOutputSchema: true }),
    supportsNativeOutputSchema: (model) => model === 'supported',
    supportsAutoNativeOutputSchema: (model) => model === 'supported',
    complete: async (request) => respond(request),
    ...(options.stream && {
      async *stream(request: LLMRequest) {
        yield { content: '', done: true, response: respond(request) };
      },
    }),
  };
  return { provider, requests };
}
const state = (agent: Agent) => agent.getSnapshot()?.sharedState as Record<string, unknown>;

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`automatic native (${reactMode})`, () => {
    it('uses a declared native format by default while keeping ordinary tools', async () => {
      const f = fixture({
        replies: [
          { content: '', toolCalls: [{ id: 'read', name: 'lookup', args: {} }] },
          { content: '{"ok":true}' },
        ],
      });
      let reads = 0;
      const agent = Agent.create({ provider: f.provider, model: 'supported', reactMode })
        .tool(
          defineTool({
            name: 'lookup',
            description: 'Read status',
            inputSchema: { type: 'object', properties: {} },
            execute: () => {
              reads++;
              return { ok: true };
            },
          }),
        )
        .outputSchema(parser, { jsonSchema: schema })
        .build();
      await expect(agent.runTyped('status')).resolves.toEqual({ ok: true });
      expect(reads).toBe(1);
      expect(f.requests).toHaveLength(2);
      expect(f.requests.every((r) => r.outputFormat?.type === 'json_schema')).toBe(true);
      expect(f.requests[0].tools?.some((t) => t.name === 'lookup')).toBe(true);
      expect(state(agent).answerGuarantee).toBe('native');
    });
    it('falls back to checked output for an unsupported model', async () => {
      const f = fixture({ replies: [{ stopReason: 'refusal' }] });
      const agent = Agent.create({ provider: f.provider, model: 'unsupported', reactMode })
        .outputSchema(parser, { jsonSchema: schema })
        .build();
      await expect(agent.runTyped('status')).resolves.toEqual({ ok: true });
      expect(f.requests[0].outputFormat).toBeUndefined();
      expect(state(agent).answerGuarantee).toBe('checked');
      expect(agent.outputContractUnmet()).toBeUndefined();
    });
    it.each(['refusal', 'max_tokens', 'model_context_window_exceeded'])(
      'does not accept native %s even when JSON parses',
      async (stopReason) => {
        const f = fixture({ replies: [{ stopReason }] });
        const agent = Agent.create({ provider: f.provider, model: 'supported', reactMode })
          .outputSchema(parser, { jsonSchema: schema })
          .build();
        await expect(agent.runTyped('status')).rejects.toBeInstanceOf(OutputSchemaError);
        expect(agent.outputContractUnmet()?.stopReason).toBe(stopReason);
      },
    );
  });
}

for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
  for (const stream of [false, true]) {
    it(`resolves configured model on each run (${reactMode}, streaming=${stream})`, async () => {
      const f = fixture({ stream });
      const agent = Agent.create({ provider: f.provider, model: 'unsupported', reactMode })
        .configure(({ message }) => ({ model: message === 'native' ? 'supported' : 'unsupported' }))
        .outputSchema(parser, { strategy: 'auto', jsonSchema: schema })
        .build();
      await agent.runTyped('native');
      expect(f.requests[0].outputFormat).toBeDefined();
      expect(state(agent).answerGuarantee).toBe('native');
      await agent.runTyped('ordinary');
      expect(f.requests[1].outputFormat).toBeUndefined();
      expect(state(agent).answerGuarantee).toBe('checked');
      await agent.runTyped('native');
      expect(f.requests[2].outputFormat).toBeDefined();
      expect(state(agent).answerGuarantee).toBe('native');
    });
  }
}

describe('automatic native boundaries', () => {
  it.each(['missing capability', 'missing schema', 'inexpressible schema', 'explicit instruct'])(
    'keeps instruction plus local validation with %s',
    async (reason) => {
      const f = fixture({ native: reason !== 'missing capability' });
      const agent = Agent.create({ provider: f.provider, model: 'supported' })
        .outputSchema(parser, {
          ...(reason !== 'missing schema' && {
            jsonSchema: reason === 'inexpressible schema' ? { type: 'object' } : schema,
          }),
          ...(reason === 'explicit instruct' && { strategy: 'instruct' as const }),
        })
        .build();
      await expect(agent.runTyped('status')).resolves.toEqual({ ok: true });
      expect(f.requests[0].outputFormat).toBeUndefined();
      expect(state(agent).answerGuarantee).toBe('checked');
    },
  );
  it('derives the schema from the parser without inventing a shape', async () => {
    const f = fixture();
    const derivingParser = { ...parser, toJsonSchema: () => schema };
    const agent = Agent.create({ provider: f.provider, model: 'supported' })
      .outputSchema(derivingParser)
      .build();
    await agent.runTyped('status');
    expect(f.requests[0].outputFormat?.schema).toMatchObject(schema);
  });
  it('treats a parser that cannot derive JSON Schema as unavailable', async () => {
    const f = fixture();
    const broken = {
      ...parser,
      toJsonSchema() {
        throw new Error('schema producer broke');
      },
    };
    const agent = Agent.create({ provider: f.provider, model: 'supported' })
      .outputSchema(broken)
      .build();
    await agent.runTyped('status');
    expect(f.requests[0].outputFormat).toBeUndefined();
    expect(state(agent).answerGuarantee).toBe('checked');
  });
  it('does not swallow unexpected native lowering errors', () => {
    const f = fixture();
    const brokenSchema = {
      ...schema,
      get properties(): never {
        throw new Error('broken schema getter');
      },
    };
    expect(() =>
      Agent.create({ provider: f.provider, model: 'supported' })
        .outputSchema(parser, { jsonSchema: brokenSchema })
        .build(),
    ).toThrow('broken schema getter');
  });
  it('still judges an invalid native answer with the local parser', async () => {
    const f = fixture({ replies: [{ content: '{"ok":"yes"}' }] });
    const agent = Agent.create({ provider: f.provider, model: 'supported' })
      .outputSchema(parser, { jsonSchema: schema })
      .build();
    await expect(agent.runTyped('status')).rejects.toBeInstanceOf(OutputSchemaError);
    expect(agent.outputContractUnmet()?.stage).toBe('schema-validate');
  });
  it('a native refusal does not call application validation or spend a correction', async () => {
    const f = fixture({ replies: [{ stopReason: 'refusal' }] });
    let checked = 0;
    const agent = Agent.create({ provider: f.provider, model: 'supported' })
      .outputSchema(parser, { jsonSchema: schema, retries: 1 })
      .answerValidation({
        id: 'app',
        version: '1',
        mode: 'enforce',
        validate() {
          checked++;
          return [];
        },
      })
      .build();
    await expect(agent.runTyped('status')).rejects.toBeDefined();
    expect(f.requests).toHaveLength(1);
    expect(checked).toBe(0);
  });
  it('reselects after a cache strategy changes the effective model', async () => {
    const f = fixture();
    const cacheStrategy = new NoOpCacheStrategy();
    cacheStrategy.prepareRequest = async (request) => ({
      request: { ...request, model: 'unsupported' },
      markersApplied: [],
    });
    const agent = Agent.create({ provider: f.provider, model: 'supported', cacheStrategy })
      .outputSchema(parser, { jsonSchema: schema })
      .build();
    await agent.runTyped('status');
    expect(f.requests[0].outputFormat).toBeUndefined();
    expect(state(agent).answerGuarantee).toBe('checked');
  });
  it('uses the skill-selected model rather than the constructor model', async () => {
    const f = fixture();
    const skill = defineSkill({
      id: 'status',
      description: 'Status',
      body: 'Read status',
      model: 'unsupported',
    });
    const agent = Agent.create({ provider: f.provider, model: 'supported' })
      .skillGraph(skillGraph().entry(skill).build())
      .outputSchema(parser, { jsonSchema: schema })
      .build();
    await agent.runTyped('status');
    expect(f.requests[0].model).toBe('unsupported');
    expect(f.requests[0].outputFormat).toBeUndefined();
    expect(state(agent).answerGuarantee).toBe('checked');
  });
});

for (const nativeFirst of [true, false]) {
  it(`reselects native on a reliability fallback (native first=${nativeFirst})`, async () => {
    const first = fixture({ native: nativeFirst });
    const original = first.provider.complete;
    first.provider.complete = async (request) => {
      await original(request);
      throw new Error('try other provider');
    };
    const second = fixture({ native: !nativeFirst });
    const agent = Agent.create({ provider: first.provider, model: 'supported' })
      .reliability({
        providers: [
          { provider: first.provider, model: 'supported' },
          { provider: second.provider, model: 'supported' },
        ],
        postDecide: [
          { when: (s) => s.error !== undefined, then: 'retry-other', kind: 'next-provider' },
        ],
      })
      .outputSchema(parser, { jsonSchema: schema })
      .build();
    await expect(agent.runTyped('status')).resolves.toEqual({ ok: true });
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(1);
    expect(first.requests[0].outputFormat !== undefined).toBe(nativeFirst);
    expect(second.requests[0].outputFormat !== undefined).toBe(!nativeFirst);
    expect(state(agent).answerGuarantee).toBe(nativeFirst ? 'checked' : 'native');
  });
}

it('refuses an auto native provider whose manifest says no format crossed', async () => {
  const f = fixture({ replies: [{ wireManifest: {} }] });
  const agent = Agent.create({ provider: f.provider, model: 'supported' })
    .outputSchema(parser, { jsonSchema: schema })
    .build();
  await expect(agent.runTyped('status')).rejects.toThrow(/wire manifest.*carried none/);
});

for (const strategy of ['auto', 'native'] as const) {
  for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    it(`local reliability fallback is checked, never native (${strategy}, ${reactMode})`, async () => {
      const f = fixture({ replies: [{ content: '{"ok":"invalid"}', stopReason: 'max_tokens' }] });
      const agent = Agent.create({ provider: f.provider, model: 'supported', reactMode })
        .outputSchema(parser, { strategy, jsonSchema: schema })
        .reliability({
          postDecide: [
            { when: (s) => s.error !== undefined, then: 'fallback', kind: 'local-answer' },
          ],
          fallback: async () => ({
            content: '{"ok":true}',
            toolCalls: [],
            usage: { input: 0, output: 0 },
            stopReason: 'max_tokens',
            wireManifest: {},
          }),
        })
        .build();
      await expect(agent.runTyped('status')).resolves.toEqual({ ok: true });
      expect(f.requests).toHaveLength(1);
      expect(state(agent).answerGuarantee).toBe('checked');
      expect(state(agent).llmLatestNativeOutput).toBe(false);
      expect(state(agent).llmLatestStopReason).toBeUndefined();
      expect(agent.outputContractUnmet()).toBeUndefined();
    });
    it(`a prose native refusal cannot enter reliability correction (${strategy}, ${reactMode})`, async () => {
      const f = fixture({
        replies: [{ content: 'I cannot help.', stopReason: 'refusal' }, { content: '{"ok":true}' }],
      });
      const agent = Agent.create({ provider: f.provider, model: 'supported', reactMode })
        .outputSchema(parser, { strategy, jsonSchema: schema, retries: 1 })
        .reliability({ postDecide: [{ when: () => true, then: 'retry', kind: 'retry-anything' }] })
        .build();
      await expect(agent.runTyped('status')).rejects.toBeInstanceOf(OutputSchemaError);
      expect(f.requests).toHaveLength(1);
      expect(agent.outputContractUnmet()?.stopReason).toBe('refusal');
      expect(state(agent).outputAttempts).toMatchObject([
        { outcome: 'exhausted', stopReason: 'refusal' },
      ]);
    });
  }
}
