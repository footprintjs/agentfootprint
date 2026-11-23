import { expect, it, vi } from 'vitest';
import { ledgerToolGate } from '../../context-ledger/gates.js';
import type { ContextLedger } from '../../context-ledger/types.js';
import { gatedTools } from '../../tool-providers/gatedTools.js';
import { staticTools } from '../../tool-providers/staticTools.js';
import type { ToolProvider } from '../../tools/toolProvider.js';
import { defineTool } from '../../tools/tools.js';
import type { ProviderToolCache } from './buildToolsSlot.js';
import { discoverTools } from './discoverTools.js';

const monitor = defineTool({
  name: 'monitor',
  description: 'Read a measurement',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'read',
});
function demote() {
  const row = vi.fn(() => ({ offered: 9, earnRate: 0 }));
  const gate = ledgerToolGate({ row } as unknown as ContextLedger, { refreshEvery: 2 });
  return { gate, row };
}
function discover(provider: ToolProvider, cache: ProviderToolCache) {
  const scope = {
    $getArgs: () => ({}),
    $getEnv: () => ({}),
    $getValue: () => undefined,
    $emit: vi.fn(),
  };
  return discoverTools(scope as Parameters<typeof discoverTools>[0], {
    provider,
    cache,
    claimants: new Map(),
  });
}

it('keeps the original ledger decision and tool, then clears it when parole offers the tool', async () => {
  const { gate, row } = demote();
  const provider = gatedTools(staticTools([monitor]), gate);
  const cache: ProviderToolCache = { current: [] };
  await discover(provider, cache);
  expect(cache.current).toEqual([]);
  expect(cache.ledgerOmissions).toEqual({
    rows: [{ name: 'monitor', tool: monitor }],
    complete: true,
  });
  expect(row).toHaveBeenCalledTimes(1);
  await discover(provider, cache);
  expect(cache.current).toEqual([monitor]);
  expect(cache.ledgerOmissions).toBeUndefined();
  expect(row).toHaveBeenCalledTimes(2);
});

it('keeps an async inner attention decision through another ledger gate', async () => {
  const { gate } = demote();
  const outer = demote();
  const inner = gatedTools({ list: async () => [monitor] }, gate);
  const cache: ProviderToolCache = { current: [] };
  await discover(gatedTools(inner, outer.gate), cache);
  expect(cache.ledgerOmissions).toEqual({
    rows: [{ name: 'monitor', tool: monitor }],
    complete: true,
  });
  expect(outer.row).toHaveBeenCalledTimes(0);
});

it('treats opaque outer and inner gates as visibility boundaries', async () => {
  const cache: ProviderToolCache = { current: [] };
  const outer = vi.fn(() => true);
  const hidden = gatedTools(staticTools([monitor]), demote().gate);
  await discover(gatedTools(hidden, outer), cache);
  expect(outer).toHaveBeenCalledTimes(0);
  expect(cache.ledgerOmissions).toBeUndefined();
  const withheld = gatedTools(staticTools([monitor]), () => false);
  await discover(gatedTools(withheld, demote().gate), cache);
  expect(cache.ledgerOmissions).toBeUndefined();
});

it('uses the provider method actually invoked and drops prior evidence on a rejected listing', async () => {
  const provider = gatedTools(staticTools([monitor]), demote().gate);
  const cache: ProviderToolCache = { current: [] };
  await discover(provider, cache);
  const replacement = vi.fn(async () => [monitor]);
  provider.list = replacement;
  await discover(provider, cache);
  expect(replacement).toHaveBeenCalledTimes(1);
  expect(cache.current).toEqual([monitor]);
  expect(cache.ledgerOmissions).toBeUndefined();
  await discover(gatedTools(staticTools([monitor]), demote().gate), cache);
  const error = Error('listing unavailable');
  await expect(
    discover(
      {
        list: async () => {
          throw error;
        },
      },
      cache,
    ),
  ).rejects.toBe(error);
  expect(cache.ledgerOmissions).toBeUndefined();
  expect(cache.resolved).toBeUndefined();
});
