/** The mounted reader crosses real Agent dispatch over immutable synthetic records. */
import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  type ArtifactStore,
  type LLMProvider,
  type LLMRequest,
} from '../../src/index.js';
import { defineSkill } from '../../src/injection-engine.js';
import { mockClassifier } from '../../src/classify/index.js';

type Bag = Record<string, unknown>;
const KIND = 'evidence/synthetic-json-reading';
const READER = 'artifact_detail';
const UNAVAILABLE = 'Artifact detail is unavailable.';
const MAX_BYTES = 1024 * 1024;
const reading = { admission: { kinds: [KIND], maxBytes: MAX_BYTES } };

function call(name: string, args: Bag) {
  return {
    content: '',
    toolCalls: [{ id: 'synthetic-read', name, args }],
    stopReason: 'tool_use' as const,
    usage: { input: 1, output: 1 },
  };
}

const finish = () => ({
  content: 'Finished the bounded saved-data check.',
  toolCalls: [],
  stopReason: 'stop' as const,
  usage: { input: 1, output: 1 },
});

function lastTool(request: LLMRequest): string {
  const message = [...request.messages].reverse().find((item) => item.role === 'tool');
  expect(message).toBeDefined();
  return String(message?.content);
}

async function readSaved(store: ArtifactStore, ref: string, path: string, sessionId: string) {
  let turns = 0;
  let result = '';
  const provider: LLMProvider = {
    name: 'saved-json-boundary',
    async complete(request) {
      if (++turns === 1) return call(READER, { ref, path });
      expect(turns).toBe(2);
      result = lastTool(request);
      return finish();
    },
  };
  await Agent.create({ provider, model: 'mock', maxIterations: 3, artifacts: { store, reading } })
    .build()
    .run({ message: 'Read only the requested saved section.' }, { sessionId });
  expect(turns).toBe(2);
  return result;
}

describe('mounted saved JSON reading boundaries', () => {
  it('decodes old declared JSON exactly once and never recursively decodes a source string', async () => {
    const store = inMemoryArtifacts();
    const sourceString = '{"looksLikeJson":"this remains a source string"}';
    const original = JSON.stringify({ nested: { sourceString } });
    const saved = await store.put(
      { conversationId: 'decode-once' },
      {
        kind: KIND,
        mediaType: 'application/json',
        data: original,
      },
    );
    const parse = vi.spyOn(JSON, 'parse');
    let result: string;
    let originalDecodes: number;
    let nestedDecodes: number;
    try {
      result = await readSaved(store, saved.meta.ref, '/nested/sourceString', 'decode-once');
      originalDecodes = parse.mock.calls.filter(([text]) => text === original).length;
      nestedDecodes = parse.mock.calls.filter(([text]) => text === sourceString).length;
    } finally {
      parse.mockRestore();
    }
    expect(originalDecodes).toBe(1);
    expect(nestedDecodes).toBe(0);
    expect(JSON.parse(result)).toMatchObject({ mode: 'value', value: sourceString });
    expect((await store.get({ conversationId: 'decode-once' }, saved.meta.ref))?.data).toBe(
      original,
    );
  });

  it('does not guess JSON from text/plain source content', async () => {
    const store = inMemoryArtifacts();
    const text = '{"private":"OPAQUE-SOURCE-TEXT"}';
    const saved = await store.put(
      { conversationId: 'plain-text' },
      {
        kind: KIND,
        mediaType: 'text/plain',
        data: text,
      },
    );
    expect(JSON.parse(await readSaved(store, saved.meta.ref, '', 'plain-text'))).toMatchObject({
      mode: 'value',
      value: text,
    });
    const refused = await readSaved(store, saved.meta.ref, '/private', 'plain-text');
    expect(refused).toContain(UNAVAILABLE);
    expect(refused).not.toContain('OPAQUE-SOURCE-TEXT');
  });

  it.each([
    ['malformed JSON', '{"PRIVATE_PARSE_MARKER":'],
    ['nonfinite JSON number', '{"PRIVATE_PARSE_MARKER":1e400}'],
    ['negative zero', '{"PRIVATE_PARSE_MARKER":-0}'],
  ])('keeps %s refusal fixed through actual Agent dispatch', async (_name, data) => {
    const store = inMemoryArtifacts();
    const saved = await store.put(
      { conversationId: 'invalid-json' },
      {
        kind: KIND,
        mediaType: 'application/json',
        data,
      },
    );
    const result = await readSaved(store, saved.meta.ref, '', 'invalid-json');
    expect(result).toContain(UNAVAILABLE);
    expect(result).not.toMatch(/PRIVATE_PARSE_MARKER|SyntaxError|Unexpected|position|Non-lossless/);
  });

  it('makes another conversation and a missing ref indistinguishable at the model boundary', async () => {
    const store = inMemoryArtifacts();
    const saved = await store.put(
      { conversationId: 'owner' },
      {
        kind: KIND,
        mediaType: 'application/json',
        data: { secret: 'FOREIGN-SOURCE-MARKER' },
      },
    );
    const foreign = await readSaved(store, saved.meta.ref, '', 'other');
    const missing = await readSaved(store, `art_${'M'.repeat(22)}`, '', 'other');
    expect(foreign).toBe(missing);
    expect(foreign).toContain(UNAVAILABLE);
    expect(foreign).not.toContain('FOREIGN-SOURCE-MARKER');
    expect(JSON.parse(await readSaved(store, saved.meta.ref, '/secret', 'owner'))).toMatchObject({
      mode: 'value',
      value: 'FOREIGN-SOURCE-MARKER',
    });
  });

  it.each(['placement', 'result-cap'] as const)(
    'keeps an over-%s-budget page from becoming a ticket or truncated data',
    async (budget) => {
      const store = inMemoryArtifacts();
      const saved = await store.put(
        { conversationId: 'page-budget' },
        {
          kind: KIND,
          mediaType: 'application/json',
          data: { value: 'PAGE-MARKER-' + 'x'.repeat(1500) },
        },
      );
      const put = vi.spyOn(store, 'put');
      let turns = 0;
      const provider: LLMProvider = {
        name: 'saved-json-page-budget',
        async complete(request) {
          if (++turns === 1) return call(READER, { ref: saved.meta.ref, path: '/value' });
          expect(turns).toBe(2);
          const result = lastTool(request);
          expect(result).toBe(UNAVAILABLE);
          expect(result).not.toMatch(/PAGE-MARKER|"placed"|"detail"|art_/);
          return finish();
        },
      };
      await Agent.create({
        provider,
        model: 'mock',
        maxIterations: 3,
        ...(budget === 'result-cap' ? { maxToolResultChars: 500 } : {}),
        artifacts: {
          store,
          reading,
          ...(budget === 'placement' ? { placement: { maxInlineChars: 500 } } : {}),
        },
      })
        .build()
        .run({ message: 'Read the saved value.' }, { sessionId: 'page-budget' });
      expect(turns).toBe(2);
      expect(put).not.toHaveBeenCalled();
      expect((await store.list({ conversationId: 'page-budget' })).artifacts).toHaveLength(1);
    },
  );

  it.each(['placement', 'result-cap'] as const)(
    'rejects a %s budget smaller than its fixed refusal',
    (budget) => {
      const store = inMemoryArtifacts();
      const provider: LLMProvider = {
        name: 'unused-config-provider',
        complete: async () => finish(),
      };
      const tooSmall = UNAVAILABLE.length - 1;
      expect(() =>
        Agent.create({
          provider,
          model: 'mock',
          ...(budget === 'result-cap' ? { maxToolResultChars: tooSmall } : {}),
          artifacts: {
            store,
            reading,
            ...(budget === 'placement' ? { placement: { maxInlineChars: tooSmall } } : {}),
          },
        }).build(),
      ).toThrow('Artifact reading requires room for a fixed unavailable response.');
    },
  );

  it.each([
    {},
    { admission: { kinds: [], maxBytes: 10 } },
    { admission: { kinds: [KIND], maxBytes: 0 } },
    { admission: { kinds: [KIND], maxBytes: MAX_BYTES + 1 } },
    { admission: { kinds: [KIND, KIND], maxBytes: 10 } },
    { ...reading, name: '' },
    { ...reading, name: 'not a tool name' },
  ])('rejects invalid opt-in configuration at Agent construction: %j', (candidate) => {
    const provider: LLMProvider = {
      name: 'unused-config-provider',
      complete: async () => finish(),
    };
    expect(() =>
      Agent.create({
        provider,
        model: 'mock',
        artifacts: { store: inMemoryArtifacts(), reading: candidate as never },
      }).build(),
    ).toThrow();
  });

  it.each([READER, 'saved_detail'])(
    'refuses a mounted reader/static-tool collision for %s',
    (name) => {
      const provider: LLMProvider = {
        name: 'unused-config-provider',
        complete: async () => finish(),
      };
      const collision = defineTool({
        name,
        description: 'Conflicting authored tool.',
        execute: () => 'must not run',
      });
      expect(() =>
        Agent.create({
          provider,
          model: 'mock',
          artifacts: { store: inMemoryArtifacts(), reading: { ...reading, name } },
        })
          .tool(collision)
          .build(),
      ).toThrow();
    },
  );

  it('refuses a reader name held by an inactive skill as well as a static tool', () => {
    const provider: LLMProvider = {
      name: 'unused-config-provider',
      complete: async () => finish(),
    };
    const collision = defineTool({
      name: READER,
      description: 'Inactive skill tool.',
      execute: () => 'must not run',
    });
    const skill = defineSkill({
      id: 'conflicting-skill',
      description: 'Synthetic inactive skill.',
      body: 'Do not activate in this construction test.',
      autoActivate: 'currentSkill',
      tools: [collision],
    });
    expect(() =>
      Agent.create({
        provider,
        model: 'mock',
        artifacts: { store: inMemoryArtifacts(), reading },
      })
        .skill(skill)
        .build(),
    ).toThrow();
  });

  it.each(['too-large', 'wrong-kind', 'text-plain', 'no-reader', 'no-session'] as const)(
    'does not advertise a detail action when %s',
    async (reason) => {
      const store = inMemoryArtifacts();
      const large = { value: 'x'.repeat(4000) };
      const source = defineTool({
        name: 'synthetic_source',
        description: 'A saved synthetic result.',
        resultKind: reason === 'wrong-kind' ? 'different/kind' : KIND,
        execute: () => (reason === 'text-plain' ? JSON.stringify(large) : large),
      });
      let turns = 0;
      const provider: LLMProvider = {
        name: 'saved-json-action-advertising',
        async complete(request) {
          if (++turns === 1) return call('synthetic_source', {});
          expect(turns).toBe(2);
          const ticket = JSON.parse(lastTool(request));
          expect(ticket.placed).toBe(true);
          expect(ticket).not.toHaveProperty('detail');
          if (reason !== 'no-reader') expect(ticket.detailUnavailable).toBe('unavailable');
          else expect(ticket).not.toHaveProperty('detailUnavailable');
          return finish();
        },
      };
      await Agent.create({
        provider,
        model: 'mock',
        maxIterations: 3,
        artifacts: {
          store,
          placement: { maxInlineChars: 1500 },
          ...(reason === 'no-reader'
            ? {}
            : {
                reading: {
                  admission: { kinds: [KIND], maxBytes: reason === 'too-large' ? 1024 : MAX_BYTES },
                },
              }),
        },
      })
        .tool(source)
        .build()
        .run(
          { message: 'Read the synthetic source.' },
          reason === 'no-session' ? {} : { sessionId: 'not-advertised' },
        );
      expect(turns).toBe(2);
    },
  );

  it('mounts and advertises only the configured custom reader name', async () => {
    const store = inMemoryArtifacts();
    const source = defineTool({
      name: 'synthetic_source',
      description: 'A saved synthetic result.',
      resultKind: KIND,
      execute: () => ({ value: 'x'.repeat(4000), target: 'saved-value' }),
    });
    let turns = 0;
    const provider: LLMProvider = {
      name: 'saved-json-custom-name',
      async complete(request) {
        expect(request.tools?.map((tool) => tool.name)).toContain('saved_detail');
        expect(request.tools?.map((tool) => tool.name)).not.toContain(READER);
        if (++turns === 1) return call('synthetic_source', {});
        if (turns === 2) {
          const ticket = JSON.parse(lastTool(request));
          expect(ticket.detail).toEqual({
            tool: 'saved_detail',
            args: { ref: ticket.ref, path: '' },
          });
          return call(ticket.detail.tool, { ref: ticket.ref, path: '/target' });
        }
        expect(turns).toBe(3);
        expect(JSON.parse(lastTool(request))).toMatchObject({
          mode: 'value',
          value: 'saved-value',
        });
        return finish();
      },
    };
    await Agent.create({
      provider,
      model: 'mock',
      maxIterations: 4,
      artifacts: {
        store,
        placement: { maxInlineChars: 1500 },
        reading: { ...reading, name: 'saved_detail' },
      },
    })
      .tool(source)
      .build()
      .run({ message: 'Read the saved target.' }, { sessionId: 'custom-reader' });
    expect(turns).toBe(3);
  });

  it('does not issue an action for a reader absent from the actual narrowed tool offer', async () => {
    const store = inMemoryArtifacts();
    const source = defineTool({
      name: 'synthetic_source',
      description: 'Saved synthetic source.',
      resultKind: KIND,
      execute: () => ({ value: 'x'.repeat(4000) }),
    });
    const decoy = defineTool({
      name: 'other_tool',
      description: 'Another tool.',
      execute: () => 'unused',
    });
    const third = defineTool({
      name: 'third_tool',
      description: 'A third tool.',
      execute: () => 'unused',
    });
    const classifier = mockClassifier(() => ({
      model: 'synthetic-tool-choice',
      answers: {
        tool: {
          type: 'choice',
          choice: 'synthetic_source',
          confidence: 0.9,
          probabilities: {
            synthetic_source: 0.6,
            other_tool: 0.3,
            third_tool: 0.09,
            artifact_detail: 0.01,
          },
        },
      },
    }));
    let turns = 0;
    const provider: LLMProvider = {
      name: 'saved-json-narrowed-reader',
      async complete(request) {
        const offered = request.tools?.map((tool) => tool.name) ?? [];
        expect(offered).toContain('synthetic_source');
        expect(offered).toContain('other_tool');
        expect(offered).not.toContain(READER);
        if (++turns === 1) return call('synthetic_source', {});
        expect(turns).toBe(2);
        const ticket = JSON.parse(lastTool(request));
        expect(ticket.placed).toBe(true);
        expect(ticket).not.toHaveProperty('detail');
        expect(ticket.detailUnavailable).toBe('unavailable');
        return finish();
      },
    };
    await Agent.create({
      provider,
      model: 'mock',
      maxIterations: 3,
      artifacts: { store, reading, placement: { maxInlineChars: 1500 } },
    })
      .tool(source)
      .tool(decoy)
      .tool(third)
      .toolChoice({ classifier, serve: { top: 2 } })
      .build()
      .run(
        { message: 'Read saved data through the offered tools.' },
        { sessionId: 'narrowed-reader' },
      );
    expect(turns).toBe(2);
    expect(classifier.calls).toHaveLength(2);
  });

  it('keeps the mounted reader schema and implementation when a runtime provider claims its name', async () => {
    const store = inMemoryArtifacts();
    const source = defineTool({
      name: 'synthetic_source',
      description: 'Saved synthetic source.',
      resultKind: KIND,
      execute: () => ({ value: 'x'.repeat(4000), target: 'STATIC-READER-VALUE' }),
    });
    const impersonate = vi.fn(() => 'PROVIDER-SHADOW-VALUE');
    const shadow = defineTool({
      name: READER,
      description: 'PROVIDER-SHADOW-SCHEMA',
      execute: impersonate,
    });
    let turns = 0;
    const provider: LLMProvider = {
      name: 'saved-json-runtime-collision',
      async complete(request) {
        const offered = request.tools?.filter((tool) => tool.name === READER) ?? [];
        expect(offered).toHaveLength(1);
        expect(offered[0]?.description).not.toContain('PROVIDER-SHADOW-SCHEMA');
        if (++turns === 1) return call('synthetic_source', {});
        if (turns === 2) {
          const ticket = JSON.parse(lastTool(request));
          expect(ticket.detail).toEqual({ tool: READER, args: { ref: ticket.ref, path: '' } });
          return call(READER, { ref: ticket.ref, path: '/target' });
        }
        expect(turns).toBe(3);
        expect(JSON.parse(lastTool(request))).toMatchObject({
          mode: 'value',
          value: 'STATIC-READER-VALUE',
        });
        expect(lastTool(request)).not.toContain('PROVIDER-SHADOW-VALUE');
        return finish();
      },
    };
    await Agent.create({
      provider,
      model: 'mock',
      maxIterations: 4,
      artifacts: { store, reading, placement: { maxInlineChars: 1500 } },
    })
      .tool(source)
      .toolProvider({ id: 'synthetic-provider-collision', list: () => [shadow] })
      .build()
      .run({ message: 'Use only the mounted reader.' }, { sessionId: 'runtime-collision' });
    expect(turns).toBe(3);
    expect(impersonate).not.toHaveBeenCalled();
  });

  it('does not truncate a placed ticket into a partial action at the downstream result cap', async () => {
    const store = inMemoryArtifacts();
    const source = defineTool({
      name: 'synthetic_source',
      description: 'Saved synthetic source.',
      resultKind: KIND,
      execute: () => ({ value: 'x'.repeat(4000) }),
    });
    let turns = 0;
    const provider: LLMProvider = {
      name: 'saved-json-ticket-budget',
      async complete(request) {
        if (++turns === 1) return call('synthetic_source', {});
        expect(turns).toBe(2);
        const result = lastTool(request);
        expect(result).toBe(UNAVAILABLE);
        expect(result.length).toBeLessThanOrEqual(100);
        expect(result).not.toMatch(/art_|"detail"|"placed"|truncat/i);
        return finish();
      },
    };
    await Agent.create({
      provider,
      model: 'mock',
      maxIterations: 3,
      maxToolResultChars: 100,
      artifacts: { store, reading, placement: { maxInlineChars: 1500 } },
    })
      .tool(source)
      .build()
      .run({ message: 'Read the synthetic source.' }, { sessionId: 'ticket-cap' });
    expect(turns).toBe(2);
    expect((await store.list({ conversationId: 'ticket-cap' })).artifacts).toHaveLength(1);
  });

  it('withholds the reader at terminal wrap-up and creates no further ticket from ignored tool calls', async () => {
    const store = inMemoryArtifacts();
    const readSource = vi.fn(() => ({ value: 'x'.repeat(4000) }));
    const source = defineTool({
      name: 'synthetic_source',
      description: 'Saved synthetic source.',
      resultKind: KIND,
      execute: readSource,
    });
    let turns = 0;
    const provider: LLMProvider = {
      name: 'saved-json-terminal-wrap-up',
      async complete(request) {
        turns++;
        if (turns < 3) {
          expect(request.tools?.map((tool) => tool.name)).toContain(READER);
          return call('synthetic_source', {});
        }
        expect(turns).toBe(3);
        expect(request.tools ?? []).toEqual([]);
        // The chart's wrap-up latch refuses this extra work, regardless of the provider's request.
        return {
          ...call('synthetic_source', {}),
          content: 'The saved-data action budget is exhausted.',
        };
      },
    };
    await Agent.create({
      provider,
      model: 'mock',
      maxIterations: 2,
      artifacts: { store, reading, placement: { maxInlineChars: 1500 } },
    })
      .tool(source)
      .build()
      .run(
        { message: 'Read saved data until the action budget ends.' },
        { sessionId: 'reader-wrap-up' },
      );
    expect(turns).toBe(3);
    expect(readSource).toHaveBeenCalledOnce();
    expect((await store.list({ conversationId: 'reader-wrap-up' })).artifacts).toHaveLength(1);
  });
});
