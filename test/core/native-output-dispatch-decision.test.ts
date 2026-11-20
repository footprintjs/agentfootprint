import { expect, it, vi } from 'vitest';
import { Agent } from '../../src/index.js';
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
      !('ok' in value) ||
      typeof value.ok !== 'boolean'
    ) {
      throw new Error('ok must be boolean');
    }
    return { ok: value.ok };
  },
};
const unformattedAnswer: LLMResponse = {
  content: '{"ok":true}',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
  wireManifest: {},
};

type Scenario = {
  name: string;
  native: boolean;
  stream: boolean;
  edit: 'unchanged' | 'remove format' | 'add format' | 'change model';
};
const scenarios: readonly Scenario[] = [
  { name: 'native adapter control', native: true, stream: false, edit: 'unchanged' },
  { name: 'completion removes the format', native: true, stream: false, edit: 'remove format' },
  { name: 'stream removes the format', native: true, stream: true, edit: 'remove format' },
  { name: 'checked adapter control', native: false, stream: false, edit: 'unchanged' },
  { name: 'completion adds a format', native: false, stream: false, edit: 'add format' },
  { name: 'stream adds a format', native: false, stream: true, edit: 'add format' },
  { name: 'completion changes the model', native: false, stream: false, edit: 'change model' },
];
const cases = scenarios.flatMap((scenario) =>
  [false, true].map((withSignal) => ({
    scenario,
    withSignal,
    name: `${scenario.name} ${withSignal ? 'with' : 'without'} a run signal`,
  })),
);

function editRequest(request: LLMRequest, edit: Scenario['edit']): void {
  // JavaScript adapters can edit the top-level fields of their request.
  const editable = request as { model: string; outputFormat?: LLMRequest['outputFormat'] };
  if (edit === 'remove format') delete editable.outputFormat;
  if (edit === 'add format') editable.outputFormat = { type: 'json_schema', schema };
  if (edit === 'change model') editable.model = 'adapter-model';
}

it.each(cases)('enforces the dispatch decision when $name', async ({ scenario, withSignal }) => {
  const dispatched: {
    method: 'complete' | 'stream';
    model: string;
    format: LLMRequest['outputFormat'];
    hasSignal: boolean;
  }[] = [];
  const observe = (method: 'complete' | 'stream', request: LLMRequest) => {
    dispatched.push({
      method,
      model: request.model,
      format: request.outputFormat,
      hasSignal: request.signal !== undefined,
    });
  };
  const provider: LLMProvider = {
    name: 'dispatch-fixture',
    carriesNativeOutputSchema: scenario.native,
    supportsNativeOutputSchema: () => scenario.native,
    supportsAutoNativeOutputSchema: () => scenario.native,
    async complete(request) {
      observe('complete', request);
      if (!scenario.stream) editRequest(request, scenario.edit);
      return unformattedAnswer;
    },
    ...(scenario.stream && {
      async *stream(request: LLMRequest) {
        observe('stream', request);
        editRequest(request, scenario.edit);
        yield { tokenIndex: 0, content: '', done: true };
      },
    }),
  };
  const pricePerToken = vi.fn(() => 0.01);
  const cost = vi.fn();
  const agent = Agent.create({
    provider,
    model: 'm',
    pricingTable: { name: 'dispatch-fixture', pricePerToken },
  })
    .outputSchema(parser, { strategy: 'auto', jsonSchema: schema })
    .build();
  agent.on('agentfootprint.cost.tick', cost);

  try {
    const signal = withSignal ? new AbortController().signal : undefined;
    const answer = agent.runTyped('status', signal === undefined ? undefined : { env: { signal } });
    if (scenario.native) {
      await expect.soft(answer).rejects.toThrow(/wire manifest.*carried none/);
    } else {
      await expect.soft(answer).resolves.toEqual({ ok: true });
    }
    const expected = {
      model: 'm',
      format: scenario.native
        ? { type: 'json_schema', schema: expect.objectContaining(schema) }
        : undefined,
      hasSignal: withSignal,
    };
    expect(dispatched).toEqual(
      scenario.stream
        ? [
            { ...expected, method: 'stream' },
            { ...expected, method: 'complete' },
          ]
        : [{ ...expected, method: 'complete' }],
    );
    if (scenario.edit === 'change model') {
      expect(pricePerToken.mock.calls).toEqual([
        ['m', 'input'],
        ['m', 'output'],
      ]);
      expect(cost).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          payload: expect.objectContaining({ provider: 'dispatch-fixture', model: 'm' }),
        }),
      );
    }
  } finally {
    await agent.shutdown();
  }
});
