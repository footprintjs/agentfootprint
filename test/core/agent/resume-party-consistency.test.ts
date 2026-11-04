import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  Sequence,
  checkInApproved,
  defineTool,
  isCheckInPause,
  isInputPause,
} from '../../../src/index.js';
import { buildToolResolver } from '../../../src/core/agent/stages/toolResolver.js';
import type { ToolClaim } from '../../../src/core/agent/buildToolRegistry.js';
import type { ToolParty } from '../../../src/core/slots/buildToolsSlot.js';
import type { Tool } from '../../../src/tools/tools.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';
import {
  restoreArgumentParties,
  withArgumentParties,
} from '../../../src/core/agent/stages/argumentParties.js';
import { readToolParty } from '../../../src/tools/toolParty.js';

const NAME = 'read_rows';
const REFUSAL = 'The saved party cannot answer this call.';
type Via = 'pinned' | 'current-wire' | 'last-served';

const rowTool = (answer: string): Tool =>
  defineTool({
    name: NAME,
    description: 'Read local rows',
    inputSchema: { type: 'object' },
    execute: () => answer,
  });

function resolveFixture(options: {
  via: Via;
  saved: ToolParty;
  provider?: { id?: string; tools: readonly Tool[] };
  registry?: Tool;
  claims?: readonly ToolClaim[];
}) {
  const current = new Map<string, ToolParty>();
  const lastServed = new Map<string, ToolParty>();
  if (options.via === 'current-wire') current.set(NAME, options.saved);
  if (options.via === 'last-served') lastServed.set(NAME, options.saved);
  const resolve = buildToolResolver({
    registryByName: new Map(options.registry ? [[NAME, options.registry]] : []),
    ...(options.provider
      ? {
          externalToolProvider: {
            ...(options.provider.id === undefined ? {} : { id: options.provider.id }),
            list: () => [...options.provider!.tools],
          },
          providerToolCache: { current: options.provider.tools },
        }
      : {}),
    ...(options.claims ? { toolClaimants: new Map([[NAME, options.claims]]) } : {}),
    servedTools: { current, lastServed },
    notServed: () => REFUSAL,
  });
  return resolve(NAME, options.via === 'pinned' ? options.saved : undefined);
}

describe.each(['pinned', 'current-wire', 'last-served'] as const)(
  'saved party consistency through %s',
  (via) => {
    it('refuses a changed provider id instead of selecting its same-named tool', () => {
      const replacement = rowTool('replacement provider');
      const registry = rowTool('registry competitor');
      const result = resolveFixture({
        via,
        saved: { channel: 'provider', id: 'original' },
        provider: { id: 'replacement', tools: [replacement] },
        registry,
        claims: [{ channel: 'registry', tool: registry }],
      });
      expect(result.tool).toBeUndefined();
      expect(result.refusal).toBe(REFUSAL);
    });

    it('refuses a withdrawn provider instead of falling back to a registry competitor', () => {
      const registry = rowTool('registry competitor');
      const result = resolveFixture({
        via,
        saved: { channel: 'provider', id: 'original' },
        provider: { id: 'original', tools: [] },
        registry,
        claims: [{ channel: 'registry', tool: registry }],
      });
      expect(result.tool).toBeUndefined();
      expect(result.refusal).toBe(REFUSAL);
    });

    it('does not turn a named provider into an anonymous one', () => {
      const result = resolveFixture({
        via,
        saved: { channel: 'provider', id: 'original' },
        provider: { tools: [rowTool('anonymous replacement')] },
      });
      expect(result.tool).toBeUndefined();
      expect(result.refusal).toBe(REFUSAL);
    });

    it('refuses a different skill claim for the same tool name', () => {
      const replacement = rowTool('other skill');
      const result = resolveFixture({
        via,
        saved: { channel: 'skill', id: 'original-skill' },
        registry: replacement,
        claims: [{ channel: 'skill', id: 'other-skill', tool: replacement }],
      });
      expect(result.tool).toBeUndefined();
      expect(result.refusal).toBe(REFUSAL);
    });

    it.each([
      ['framework', 'registry'],
      ['registry', 'framework'],
      ['registry', 'skill'],
      ['skill', 'registry'],
    ] as const)('does not relabel current %s/%s declarations', (saved, actual) => {
      const tool = rowTool('current declaration');
      const result = resolveFixture({
        via,
        saved: { channel: saved, ...(saved === 'skill' ? { id: 'skill' } : {}) },
        registry: tool,
        claims: [{ channel: actual, ...(actual === 'skill' ? { id: 'skill' } : {}), tool }],
      });
      expect(result.tool).toBeUndefined();
      expect(result.refusal).toBe(REFUSAL);
    });

    it('refuses a matching label whose claimed Tool is not the current dispatch holder', () => {
      const claimed = rowTool('claimed implementation');
      const current = rowTool('unclaimed replacement');
      const result = resolveFixture({
        via,
        saved: { channel: 'skill', id: 'same' },
        registry: current,
        claims: [{ channel: 'skill', id: 'same', tool: claimed }],
      });
      expect(result.tool).toBeUndefined();
      expect(result.refusal).toBe(REFUSAL);
    });

    it('keeps a nonfirst skill claim when both skills share the same Tool reference', () => {
      const shared = rowTool('shared implementation');
      const saved: ToolParty = { channel: 'skill', id: 'second' };
      const result = resolveFixture({
        via,
        saved,
        registry: shared,
        claims: [
          { channel: 'skill', id: 'first', tool: shared },
          { channel: 'skill', id: 'second', tool: shared },
        ],
      });
      expect(result.tool).toBe(shared);
      expect(result.party).toEqual(saved);
    });

    it('allows a fresh Tool from the same declared provider', () => {
      const fresh = rowTool('fresh same-party implementation');
      const saved: ToolParty = { channel: 'provider', id: 'same' };
      const result = resolveFixture({
        via,
        saved,
        provider: { id: 'same', tools: [fresh] },
      });
      expect(result.tool).toBe(fresh);
      expect(result.party).toEqual(saved);
    });

    it('retains anonymous-provider behavior without claiming implementation authentication', () => {
      const fresh = rowTool('anonymous current implementation');
      const saved: ToolParty = { channel: 'provider' };
      const result = resolveFixture({ via, saved, provider: { tools: [fresh] } });
      expect(result.tool).toBe(fresh);
      expect(result.party).toEqual(saved);
    });

    it('keeps an exact framework claim', () => {
      const tool = rowTool('framework implementation');
      const saved: ToolParty = { channel: 'framework' };
      const result = resolveFixture({
        via,
        saved,
        registry: tool,
        claims: [{ channel: 'framework', tool }],
      });
      expect(result.tool).toBe(tool);
      expect(result.party).toEqual(saved);
    });

    it('keeps a metadata-free plain registry holder', () => {
      const tool = rowTool('plain registry');
      const result = resolveFixture({ via, saved: { channel: 'registry' }, registry: tool });
      expect(result.tool).toBe(tool);
    });

    it('does not invent a named skill claim from a metadata-free registry holder', () => {
      const result = resolveFixture({
        via,
        saved: { channel: 'skill', id: 'unrecorded' },
        registry: rowTool('unclaimed registry tool'),
      });
      expect(result.tool).toBeUndefined();
      expect(result.refusal).toBe(REFUSAL);
    });
  },
);

it('keeps a fully withdrawn last-served party distinct from an unknown name', () => {
  const result = resolveFixture({
    via: 'last-served',
    saved: { channel: 'provider', id: 'withdrawn' },
  });
  expect(result.tool).toBeUndefined();
  expect(result.refusal).toBe(REFUSAL);
});

function providerAgent(options: {
  reactMode: 'dynamic' | 'dynamic-grouped';
  providerId: string;
  execute: () => string;
  registryExecute?: () => string;
}) {
  const tool = (execute: () => string) =>
    defineTool({
      name: NAME,
      description: 'Read local rows',
      inputSchema: { type: 'object' },
      checkIn: 'always',
      execute,
    });
  let builder = Agent.create({
    provider: {
      name: 'scripted',
      complete: async (request: LLMRequest) =>
        request.messages.some((message) => message.role === 'tool')
          ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [{ id: 'held-call', name: NAME, args: {} }],
              usage: { input: 1, output: 1 },
            },
    },
    model: 'mock',
    reactMode: options.reactMode,
  });
  if (options.registryExecute) builder = builder.tool(tool(options.registryExecute));
  return builder
    .toolProvider({ id: options.providerId, list: () => [tool(options.execute)] })
    .build();
}

it.each(['dynamic', 'dynamic-grouped'] as const)(
  '%s fresh resume never executes a changed provider or the competing registry tool',
  async (reactMode) => {
    const oldCall = vi.fn(() => 'original');
    const replacementCall = vi.fn(() => 'replacement');
    const registryCall = vi.fn(() => 'registry competitor');
    const first = providerAgent({ reactMode, providerId: 'original', execute: oldCall });
    const pause = await first.run({ message: 'read' });
    if (!isCheckInPause(pause)) throw new Error('fixture did not reach its consent pause');
    const fresh = providerAgent({
      reactMode,
      providerId: 'replacement',
      execute: replacementCall,
      registryExecute: registryCall,
    });
    await fresh.resume(
      structuredClone(pause.checkpoint),
      checkInApproved({ request: pause.checkIn, by: 'person' }),
    );
    expect(oldCall).not.toHaveBeenCalled();
    expect(replacementCall).not.toHaveBeenCalled();
    expect(registryCall).not.toHaveBeenCalled();
    expect(JSON.stringify(fresh.checkpoint()?.history)).toContain(
      'offered under that name was not available to answer it.',
    );
  },
);

type ArgumentPartyCase =
  | 'same named party'
  | 'same anonymous party'
  | 'changed provider id'
  | 'sole registry replacement'
  | 'withdrawn provider with registry'
  | 'named provider becomes anonymous';

function argumentPartyAgent(options: {
  reactMode: 'dynamic' | 'dynamic-grouped';
  providerId?: string;
  providerPresent: boolean;
  providerExecute: (args: Record<string, unknown>) => string;
  registryExecute?: (args: Record<string, unknown>) => string;
  listed?: () => void;
  inputsLayer?: false;
  requiresWindow?: false;
}) {
  const tool = (execute: (args: Record<string, unknown>) => string) =>
    defineTool({
      name: NAME,
      description: 'Read synthetic local rows for a named service and window',
      inputSchema: {
        type: 'object',
        required: options.requiresWindow === false ? ['service'] : ['service', 'window'],
        properties: {
          service: { type: 'string' },
          window: { type: 'string', enum: ['1h', '24h'] },
        },
      },
      askOrAssume: { window: { ask: 'Which window?', choices: ['1h', '24h'] } },
      execute,
    });
  let builder = Agent.create({
    provider: {
      name: 'scripted-argument-party',
      complete: async (request: LLMRequest) =>
        request.messages.some((message) => message.role === 'tool')
          ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [
                { id: 'argument-one', name: NAME, args: { service: 'one' } },
                { id: 'argument-two', name: NAME, args: { service: 'two' } },
              ],
              usage: { input: 1, output: 1 },
            },
    },
    model: 'mock',
    reactMode: options.reactMode,
  });
  if (options.inputsLayer !== false) builder = builder.inputsLayer();
  if (options.registryExecute) builder = builder.tool(tool(options.registryExecute));
  return builder
    .toolProvider({
      ...(options.providerId !== undefined && { id: options.providerId }),
      list: () => {
        options.listed?.();
        return options.providerPresent ? [tool(options.providerExecute)] : [];
      },
    })
    .build();
}

describe.each(['dynamic', 'dynamic-grouped'] as const)(
  'argument interrupt party through %s',
  (reactMode) => {
    it.each([
      'same named party',
      'same anonymous party',
      'changed provider id',
      'sole registry replacement',
      'withdrawn provider with registry',
      'named provider becomes anonymous',
    ] as const)('%s keeps the offered owner of both calls', async (kind: ArgumentPartyCase) => {
      const anonymous = kind === 'same anonymous party';
      const originalCall = vi.fn(() => 'original');
      const original = argumentPartyAgent({
        reactMode,
        providerId: anonymous ? undefined : 'original',
        providerPresent: true,
        providerExecute: originalCall,
      });
      const pause = await original.run({ message: 'read both services' });
      if (!isInputPause(pause)) throw new Error('fixture did not reach the argument interrupt');
      expect(originalCall).not.toHaveBeenCalled();
      expect(pause.awaitingInput.fields).toHaveLength(1);
      const replacement = vi.fn((_args: Record<string, unknown>) => 'current rows');
      const registry = vi.fn((_args: Record<string, unknown>) => 'registry rows');
      const registryOnly =
        kind === 'sole registry replacement' || kind === 'withdrawn provider with registry';
      const fresh = argumentPartyAgent({
        reactMode,
        providerId:
          kind === 'changed provider id'
            ? 'replacement'
            : anonymous || kind === 'named provider becomes anonymous'
            ? undefined
            : 'original',
        providerPresent: !registryOnly,
        providerExecute: replacement,
        ...(registryOnly && { registryExecute: registry }),
      });
      await expect(
        fresh.resume(structuredClone(pause.checkpoint), {
          requestId: pause.awaitingInput.requestId,
          values: { [pause.awaitingInput.fields[0]!.id]: '24h' },
        }),
      ).resolves.toBe('done');
      const same = kind === 'same named party' || anonymous;
      if (same) {
        expect(replacement.mock.calls.map(([args]) => args)).toEqual([
          { service: 'one', window: '24h' },
          { service: 'two', window: '24h' },
        ]);
      } else {
        expect.soft(replacement).not.toHaveBeenCalled();
        expect.soft(registry).not.toHaveBeenCalled();
        expect
          .soft(JSON.stringify(fresh.checkpoint()?.history))
          .toContain('offered under that name was not available to answer it.');
      }
      expect(originalCall).not.toHaveBeenCalled();
      expect(registry).not.toHaveBeenCalled();
    });
  },
);

interface MutableArgumentState {
  toolParties: {
    version: number;
    owner: string;
    turn: number;
    iteration: number;
    calls: { id: string; name: string; party: { channel: string; id?: string } }[];
  };
}

function editArgumentState(value: unknown, edit: (state: MutableArgumentState) => void): number {
  if (typeof value !== 'object' || value === null) return 0;
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'argumentAsk' && typeof child === 'object' && child !== null) {
      edit(child as MutableArgumentState);
      count++;
    } else count += editArgumentState(child, edit);
  }
  return count;
}

describe('argument party checkpoint admission', () => {
  it.each(['owned', 'mounted'] as const)(
    '%s refuses a stripped carrier even if the new configuration skips asking',
    async (kind) => {
      const execute = vi.fn(() => 'rows');
      const options = {
        reactMode: 'dynamic' as const,
        providerId: 'original',
        providerPresent: true,
        providerExecute: execute,
      };
      const originalAgent = argumentPartyAgent(options);
      const original =
        kind === 'mounted' ? Sequence.create().step('agent', originalAgent).build() : originalAgent;
      const pause = await original.run({ message: 'read' });
      if (!isInputPause(pause)) throw new Error('fixture did not reach argument interrupt');
      const checkpoint = structuredClone(pause.checkpoint);
      expect(
        editArgumentState(checkpoint, (state) => {
          Reflect.deleteProperty(state, 'toolParties');
        }),
      ).toBeGreaterThan(0);
      // Also strip the complete ask state, leaving the native pause metadata intact.
      const strip = (value: unknown): void => {
        if (typeof value !== 'object' || value === null) return;
        for (const [key, child] of Object.entries(value)) {
          if (key === 'argumentAsk') Reflect.deleteProperty(value, key);
          else strip(child);
        }
      };
      strip(checkpoint);
      const listed = vi.fn();
      const freshAgent = argumentPartyAgent({
        ...options,
        listed,
        inputsLayer: false,
        requiresWindow: false,
      });
      const fresh =
        kind === 'mounted' ? Sequence.create().step('agent', freshAgent).build() : freshAgent;
      await expect(
        fresh.resume(checkpoint, {
          requestId: pause.awaitingInput.requestId,
          values: { [pause.awaitingInput.fields[0]!.id]: '24h' },
        }),
      ).rejects.toThrow('argumentAsk:');
      expect(listed).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it.each([
    [
      'missing binding',
      (state: MutableArgumentState) => Reflect.deleteProperty(state, 'toolParties'),
    ],
    ['future version', (state: MutableArgumentState) => (state.toolParties.version = 2)],
    ['foreign turn', (state: MutableArgumentState) => (state.toolParties.turn += 1)],
    ['foreign owner', (state: MutableArgumentState) => (state.toolParties.owner = 'other')],
    ['foreign iteration', (state: MutableArgumentState) => (state.toolParties.iteration += 1)],
    ['missing sibling', (state: MutableArgumentState) => state.toolParties.calls.pop()],
    [
      'extra sibling',
      (state: MutableArgumentState) => state.toolParties.calls.push(state.toolParties.calls[0]),
    ],
    ['reordered siblings', (state: MutableArgumentState) => state.toolParties.calls.reverse()],
    ['foreign call id', (state: MutableArgumentState) => (state.toolParties.calls[0].id = 'other')],
    [
      'foreign tool name',
      (state: MutableArgumentState) => (state.toolParties.calls[0].name = 'other'),
    ],
    [
      'unknown party',
      (state: MutableArgumentState) => (state.toolParties.calls[0].party.channel = 'unknown'),
    ],
    [
      'inconsistent same-name parties',
      (state: MutableArgumentState) => (state.toolParties.calls[0].party.id = 'other'),
    ],
  ] as const)('refuses %s before catalog discovery', async (_label, damage) => {
    const execute = vi.fn(() => 'rows');
    const options = {
      reactMode: 'dynamic' as const,
      providerId: 'original',
      providerPresent: true,
      providerExecute: execute,
    };
    const first = argumentPartyAgent(options);
    const pause = await first.run({ message: 'read' });
    if (!isInputPause(pause)) throw new Error('fixture did not reach argument interrupt');
    const checkpoint = structuredClone(pause.checkpoint);
    expect(editArgumentState(checkpoint, damage)).toBeGreaterThan(0);
    const listed = vi.fn();
    const fresh = argumentPartyAgent({ ...options, listed });
    await expect(
      fresh.resume(checkpoint, {
        requestId: pause.awaitingInput.requestId,
        values: { [pause.awaitingInput.fields[0]!.id]: '24h' },
      }),
    ).rejects.toThrow('argumentAsk:');
    expect(listed).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('finite argument party data', () => {
  function fixture(count = 2) {
    const calls = Array.from({ length: count }, (_, i) => ({ id: `call-${i}`, name: NAME }));
    const values: Record<string, unknown> = {
      llmLatestToolCalls: calls,
      runIdentity: { conversationId: 'retained' },
    };
    const scope = {
      $getValue: (key: string) => values[key],
      iteration: 1,
      turnNumber: 1,
      turnStartMs: 1,
    };
    const capture = () =>
      withArgumentParties(scope as never, { iteration: 1, fields: [], progress: [] }, () => ({
        channel: 'provider',
        id: 'original',
      }));
    return { scope, values, calls, capture };
  }

  it('admits the finite call limit and refuses the next before allocating a saved batch', () => {
    expect(fixture(1024).capture().toolParties.calls).toHaveLength(1024);
    expect(() => fixture(1025).capture()).toThrow('argumentAsk:');
  });

  it('refuses duplicate proposal ids', () => {
    const f = fixture();
    f.calls[1]!.id = f.calls[0]!.id;
    expect(f.capture).toThrow('argumentAsk:');
  });

  it('does not partly install a damaged sibling', () => {
    const f = fixture();
    const saved = structuredClone(f.capture());
    Reflect.deleteProperty(saved.toolParties.calls[1]!, 'party');
    f.values.argumentAsk = saved;
    const current = new Map<string, ToolParty>([['untouched', { channel: 'registry' }]]);
    const served = { current, lastServed: new Map<string, ToolParty>() };
    expect(() => restoreArgumentParties(f.scope as never, served)).toThrow('argumentAsk:');
    expect(served.current).toBe(current);
  });

  it('keeps an explicitly unowned name closed instead of choosing a current holder', () => {
    const f = fixture();
    f.values.argumentAsk = withArgumentParties(
      f.scope as never,
      { iteration: 1, fields: [], progress: [] },
      () => undefined,
    );
    const served = {
      current: new Map<string, ToolParty | null>(),
      lastServed: new Map<string, ToolParty>(),
    };
    restoreArgumentParties(f.scope as never, served);
    const resolve = buildToolResolver({
      servedTools: served,
      registryByName: new Map([[NAME, rowTool('replacement')]]),
      notServed: () => REFUSAL,
    });
    expect(resolve(NAME)).toEqual({ refusal: REFUSAL });
  });

  it('reads bounded own data without invoking accessors or adopting inherited labels', () => {
    const getter = vi.fn(() => 'provider');
    expect(readToolParty(Object.defineProperty({}, 'channel', { get: getter }))).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(
      readToolParty(Object.assign(Object.create({ id: 'inherited' }), { channel: 'provider' })),
    ).toBeUndefined();
    expect(readToolParty({ channel: 'provider', id: 'x'.repeat(1024) })).toBeDefined();
    expect(readToolParty({ channel: 'provider', id: 'x'.repeat(1025) })).toBeUndefined();
  });
});
