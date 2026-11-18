import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  type Tool,
  type LLMRequest,
  type LLMResponse,
} from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import {
  VM,
  QUESTION,
  TOOL,
  proposal,
  quoted,
  batch,
  correctionFixture,
  jsonCopy,
  argumentsOf,
} from './sourceCorrectionHarness.js';

function tool(run: (args: Readonly<Record<string, unknown>>) => void, assume?: string): Tool {
  return defineTool({
    name: TOOL,
    description: assume ? 'Current assumed fixture' : 'Current asked fixture',
    inputSchema: { type: 'object', required: ['vm'], properties: { vm: { type: 'string' } } },
    askOrAssume: { vm: assume === undefined ? { ask: 'Which synthetic VM?' } : { assume } },
    execute(args) {
      run(jsonCopy(args));
      return [{ ok: true }];
    },
  });
}
function provider(replies: readonly (string | Partial<LLMResponse>)[]) {
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: mock({
      respond(request) {
        requests.push(jsonCopy(request));
        return replies[requests.length - 1] ?? 'Done.';
      },
    }),
  };
}

describe.each(['dynamic', 'dynamic-grouped'] as const)(
  'native source-correction party ownership in %s',
  (mode) => {
    it('checks the actual provider-only tool rather than a static registry fallback', async () => {
      const ran: Readonly<Record<string, unknown>>[] = [];
      const actual = tool((args) => ran.push(args));
      const p = provider([
        batch(proposal('held', { vm: VM })),
        batch(quoted('corrected')),
        'Done.',
      ]);
      const agent = Agent.create({ provider: p.provider, model: 'mock', reactMode: mode })
        .toolProvider({ id: 'native-provider', list: () => [actual] })
        .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
        .build();
      try {
        expect(await agent.run(QUESTION)).toBe('Done.');
        expect(ran).toEqual([{ vm: VM }]);
        expect(p.requests).toHaveLength(3);
        expect(argumentsOf(agent, 'held')).toEqual([
          expect.objectContaining({ correction: 'source-declaration-required' }),
        ]);
        expect(argumentsOf(agent, 'corrected')).toEqual([
          expect.objectContaining({ source: 'said' }),
        ]);
      } finally {
        await agent.shutdown();
      }
    });

    it('uses the native registry winner’s rules when a same-name provider claims different defaults', async () => {
      const registry: unknown[] = [],
        external: unknown[] = [];
      const p = provider([
        batch(proposal('held', { vm: VM })),
        batch(quoted('corrected')),
        'Done.',
      ]);
      const agent = Agent.create({ provider: p.provider, model: 'mock', reactMode: mode })
        .tool(tool((args) => registry.push(args)))
        .toolProvider({
          id: 'losing-provider',
          list: () => [tool((args) => external.push(args), 'wrong-default')],
        })
        .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
        .build();
      try {
        expect(await agent.run(QUESTION)).toBe('Done.');
        expect(registry).toEqual([{ vm: VM }]);
        expect(external).toEqual([]);
        expect(argumentsOf(agent, 'held')[0]).toHaveProperty(
          'correction',
          'source-declaration-required',
        );
      } finally {
        await agent.shutdown();
      }
    });

    it('re-lists actual rules for the new proposal and never dispatches a held old implementation', async () => {
      const old: unknown[] = [],
        current: unknown[] = [];
      const asked = tool((args) => old.push(args));
      const assumed = tool((args) => current.push(args), 'new-native-default');
      const p = provider([
        batch(proposal('held-old', { vm: VM })),
        batch(proposal('new-proposal', {})),
        'Done.',
      ]);
      const agent = Agent.create({ provider: p.provider, model: 'mock', reactMode: mode })
        .toolProvider({
          id: 'current-provider',
          list: (ctx) => [ctx.iteration === 1 ? asked : assumed],
        })
        .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
        .build();
      try {
        expect(await agent.run(QUESTION)).toBe('Done.');
        expect(old).toEqual([]);
        expect(current).toEqual([{ vm: 'new-native-default' }]);
        expect(argumentsOf(agent, 'new-proposal')[0]).toMatchObject({ source: 'default' });
      } finally {
        await agent.shutdown();
      }
    });

    it('a withdrawn provider cannot execute its earlier held proposal or grant a result', async () => {
      const ran: unknown[] = [],
        actual = tool((args) => ran.push(args));
      const p = provider([
        batch(proposal('held', { vm: VM })),
        batch(quoted('withdrawn')),
        'Unavailable.',
      ]);
      const agent = Agent.create({ provider: p.provider, model: 'mock', reactMode: mode })
        .toolProvider({
          id: 'withdrawn-provider',
          list: (ctx) => (ctx.iteration === 1 ? [actual] : []),
        })
        .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
        .build();
      try {
        expect(await agent.run(QUESTION)).toBe('Unavailable.');
        expect(ran).toEqual([]);
        expect(p.requests[1]?.tools?.some((entry) => entry.name === TOOL) ?? false).toBe(false);
        expect(argumentsOf(agent, 'held')[0]).toHaveProperty(
          'correction',
          'source-declaration-required',
        );
      } finally {
        await agent.shutdown();
      }
    });
  },
);

it('concurrent admitted agents with identical proposed call IDs have independent native request allowances', async () => {
  const first = correctionFixture([
    batch(proposal('same', { vm: VM })),
    batch(quoted('verified')),
    'First done.',
  ]);
  const second = correctionFixture([
    batch(proposal('same', { vm: VM })),
    batch(quoted('verified')),
    'Second done.',
  ]);
  try {
    expect(await Promise.all([first.agent.run(QUESTION), second.agent.run(QUESTION)])).toEqual([
      'First done.',
      'Second done.',
    ]);
    expect(first.ran).toEqual([{ vm: VM }]);
    expect(second.ran).toEqual([{ vm: VM }]);
    expect(argumentsOf(first.agent, 'same')[0]).toHaveProperty(
      'correction',
      'source-declaration-required',
    );
    expect(argumentsOf(second.agent, 'same')[0]).toHaveProperty(
      'correction',
      'source-declaration-required',
    );
    expect(first.events[0]?.meta.runId).not.toBe(second.events[0]?.meta.runId);
  } finally {
    await first.agent.shutdown();
    await second.agent.shutdown();
  }
});
