import { describe, expect, it, vi } from 'vitest';
import { Agent, checkInApproved, defineTool, isCheckInPause } from '../../../src/index.js';
import { buildToolResolver } from '../../../src/core/agent/stages/toolResolver.js';
import type { ToolClaim } from '../../../src/core/agent/buildToolRegistry.js';
import type { ToolParty } from '../../../src/core/slots/buildToolsSlot.js';
import type { Tool } from '../../../src/tools/tools.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';

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
