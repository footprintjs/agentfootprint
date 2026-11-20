import { expect, it } from 'vitest';
import { Agent } from '../../src/index.js';
import { NoOpCacheStrategy } from '../../src/cache/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';

const configuredSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
};
const unrelatedFormat = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { unrelated: { type: 'boolean' } },
    required: ['unrelated'],
  },
} as const;
const parser = {
  parse(value: unknown): { ok: boolean } {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('ok' in value) ||
      typeof value.ok !== 'boolean'
    ) {
      throw new Error('ok must be boolean');
    }
    return { ok: value.ok };
  },
};

type Treatment = { name: string; change(request: LLMRequest): LLMRequest };
const treatments: readonly Treatment[] = [
  { name: 'returns it unchanged', change: (request) => request },
  {
    name: 'replaces the format',
    change: (request) =>
      request.outputFormat === undefined ? request : { ...request, outputFormat: unrelatedFormat },
  },
  {
    name: 'edits the required fields in place',
    change(request) {
      const required = request.outputFormat?.schema.required as string[] | undefined;
      if (required !== undefined) required[0] = 'unrelated';
      return request;
    },
  },
  {
    name: 'removes the format',
    change(request) {
      const { outputFormat: _removed, ...rest } = request;
      return rest;
    },
  },
  {
    name: 'adds a format where none was offered',
    change: (request) =>
      request.outputFormat === undefined ? { ...request, outputFormat: unrelatedFormat } : request,
  },
];

type Path = {
  kind: 'first dispatch' | 'retry' | 'stream fallthrough' | 'fallback';
  nativeFirst: boolean;
};
const paths: readonly Path[] = [
  { kind: 'first dispatch', nativeFirst: true },
  { kind: 'first dispatch', nativeFirst: false },
  { kind: 'retry', nativeFirst: true },
  { kind: 'retry', nativeFirst: false },
  { kind: 'stream fallthrough', nativeFirst: true },
  { kind: 'stream fallthrough', nativeFirst: false },
  { kind: 'fallback', nativeFirst: true },
  { kind: 'fallback', nativeFirst: false },
];
const cases = paths.flatMap((path) =>
  treatments.map((treatment) => ({
    path,
    treatment,
    label: `${path.kind} (${path.nativeFirst ? 'native' : 'checked'} first), strategy ${
      treatment.name
    }`,
  })),
);

type Dispatch = {
  provider: string;
  method: 'stream' | 'complete';
  format: LLMRequest['outputFormat'];
};

function providerFixture(path: Path, dispatches: Dispatch[], primary: boolean): LLMProvider {
  const native = primary ? path.nativeFirst : !path.nativeFirst;
  const name = primary ? 'primary' : 'fallback';
  return {
    name,
    carriesNativeOutputSchema: native,
    supportsNativeOutputSchema: () => native,
    supportsAutoNativeOutputSchema: () => native,
    async complete(request): Promise<LLMResponse> {
      dispatches.push({ provider: name, method: 'complete', format: request.outputFormat });
      if (
        primary &&
        dispatches.length === 1 &&
        (path.kind === 'retry' || path.kind === 'fallback')
      ) {
        // An adapter can still replace a top-level request field. The same-provider
        // retry must reselect the library's output format before dispatch.
        if (path.kind === 'retry') Object.assign(request, { outputFormat: unrelatedFormat });
        throw Object.assign(new Error('Service unavailable'), { status: 503 });
      }
      const required = request.outputFormat?.schema.required;
      const content =
        Array.isArray(required) && required[0] === 'unrelated'
          ? '{"unrelated":true}'
          : '{"ok":true}';
      return { content, toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'stop' };
    },
    ...(path.kind === 'stream fallthrough' && {
      async *stream(request: LLMRequest) {
        dispatches.push({ provider: name, method: 'stream', format: request.outputFormat });
        Object.assign(request, { outputFormat: unrelatedFormat });
        yield { tokenIndex: 0, content: '', done: true };
      },
    }),
  };
}

function expectedDispatches(path: Path) {
  const format = (native: boolean) =>
    native ? { type: 'json_schema', schema: expect.objectContaining(configuredSchema) } : undefined;
  const primary = { provider: 'primary', method: 'complete', format: format(path.nativeFirst) };
  switch (path.kind) {
    case 'first dispatch':
      return [primary];
    case 'retry':
      return [primary, primary];
    case 'stream fallthrough':
      return [{ ...primary, method: 'stream' }, primary];
    case 'fallback':
      return [primary, { ...primary, provider: 'fallback', format: format(!path.nativeFirst) }];
  }
}

it.each(cases)(
  'automatic output keeps its configured schema on $label',
  async ({ path, treatment }) => {
    const dispatches: Dispatch[] = [];
    const provider = providerFixture(path, dispatches, true);
    const cacheStrategy = new NoOpCacheStrategy();
    cacheStrategy.prepareRequest = async (request) => ({
      request: treatment.change(request),
      markersApplied: [],
    });
    const builder = Agent.create({ provider, model: 'synthetic', cacheStrategy }).outputSchema(
      parser,
      { strategy: 'auto', jsonSchema: configuredSchema },
    );
    if (path.kind === 'retry' || path.kind === 'fallback') {
      builder.reliability({
        ...(path.kind === 'fallback' && {
          providers: [
            { provider, model: 'synthetic' },
            { provider: providerFixture(path, dispatches, false), model: 'synthetic' },
          ],
        }),
        postDecide: [
          {
            when: (state) => state.errorKind === '5xx-transient' && state.attempt < 2,
            then: path.kind === 'retry' ? 'retry' : 'retry-other',
            kind: 'fixture-transient-failure',
          },
        ],
      });
    }
    const agent = builder.build();
    try {
      const answer = agent.runTyped('status');
      if (path.nativeFirst && treatment.name === 'edits the required fields in place') {
        await expect.soft(answer).rejects.toThrow(/Cannot assign to read only property/);
        expect(dispatches).toEqual([]);
        return;
      }
      await expect.soft(answer).resolves.toEqual({ ok: true });
      expect(dispatches).toEqual(expectedDispatches(path));
      for (const { format } of dispatches) {
        if (format === undefined) continue;
        expect(Object.isFrozen(format)).toBe(true);
        expect(Object.isFrozen(format.schema)).toBe(true);
        expect(Object.isFrozen(format.schema.required)).toBe(true);
        expect(Object.isFrozen(format.schema.properties)).toBe(true);
      }
    } finally {
      await agent.shutdown();
    }
  },
);
