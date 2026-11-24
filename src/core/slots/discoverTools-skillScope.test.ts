import { expect, it, vi } from 'vitest';
import { defineSkill } from '../../injection-engine/factories/defineSkill.js';
import { ledgerToolGate } from '../../context-ledger/gates.js';
import type { ContextLedger } from '../../context-ledger/types.js';
import { gatedTools } from '../../tool-providers/gatedTools.js';
import { skillScopedTools } from '../../tools/skillScopedTools.js';
import type { ToolProvider } from '../../tools/toolProvider.js';
import { defineTool, type Tool } from '../../tools/tools.js';
import { buildToolRegistry, type ToolClaim } from '../agent/buildToolRegistry.js';
import { discoverTools, type ProviderToolCache } from './discoverTools.js';

const monitor = () =>
  defineTool({
    name: 'monitor',
    description: 'Read a measurement',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'read',
  });

async function collect(
  provider: ToolProvider,
  claims: readonly ToolClaim[],
  hiddenSkillIds: string[] | undefined,
  activated: string[] = [],
) {
  const cache: ProviderToolCache = { current: [] };
  const scope = {
    $getArgs: () => ({ hiddenSkillIds }),
    $getEnv: () => ({}),
    $getValue: (key: string) => {
      if (key === 'activatedInjectionIds') return activated;
      if (key === 'activeInjections') return [{ flavor: 'skill', id: 'triage' }];
      return undefined;
    },
    $emit: vi.fn(),
  };
  await discoverTools(scope as Parameters<typeof discoverTools>[0], {
    provider,
    cache,
    claimants: new Map([['monitor', claims]]),
  });
  return cache;
}

it('records an inactive visible skill at its original read_skill decision, even under a known ledger gate', async () => {
  const tool = monitor();
  const skill = defineSkill({
    id: 'triage',
    description: 'Read a measurement',
    body: 'Check the monitor.',
    autoActivate: 'currentSkill',
    tools: [tool],
  });
  const claims = buildToolRegistry([], [skill]).toolClaimants.get('monitor')!;
  const gate = ledgerToolGate({ row: () => undefined } as unknown as ContextLedger);
  const provider = gatedTools(skillScopedTools('triage', [tool, tool]), gate);
  const missed = await collect(provider, claims, [], ['triage', 'other']);
  expect(missed.current).toEqual([]);
  expect(missed.selectionOmissions).toEqual({
    rows: [{ kind: 'skill-scope', skillId: 'triage', name: 'monitor', tool }],
    complete: true,
  });
  const active = await collect(provider, claims, [], ['other', 'triage']);
  expect(active.current).toEqual([tool, tool]);
  expect(active.selectionOmissions).toBeUndefined();
});

it('requires this skill and this implementation, with a resolved visibility decision', async () => {
  const tool = monitor();
  const provider = skillScopedTools('triage', [tool]);
  const mine: ToolClaim = { channel: 'skill', id: 'triage', tool };
  const peer: ToolClaim = { channel: 'skill', id: 'peer', tool };
  const hidden = await collect(provider, [mine, peer], ['triage']);
  const absent = await collect(skillScopedTools('triage', []), [peer], ['triage']);
  expect(hidden).toEqual(absent);
  expect(hidden.selectionOmissions).toBeUndefined();
  expect((await collect(provider, [mine], undefined)).selectionOmissions).toBeUndefined();
  expect((await collect(provider, [peer], [])).selectionOmissions).toBeUndefined();
  expect(
    (await collect(provider, [{ ...mine, tool: monitor() }], [])).selectionOmissions,
  ).toBeUndefined();
});

it('does not inspect a withheld implementation or pass a decision through a replacement or opaque gate', async () => {
  const tool = monitor();
  const unregistered = {
    get schema() {
      throw Error('withheld schema was inspected');
    },
  } as Tool;
  const provider = skillScopedTools('triage', [unregistered, tool]);
  const claims: ToolClaim[] = [{ channel: 'skill', id: 'triage', tool }];
  expect((await collect(provider, claims, [])).selectionOmissions?.rows).toHaveLength(1);
  const opaque = gatedTools(provider, () => true);
  expect((await collect(opaque, claims, [])).selectionOmissions).toBeUndefined();
  expect((await collect({ ...provider }, claims, [])).selectionOmissions).toBeUndefined();
  provider.list = () => [];
  expect((await collect(provider, claims, [])).selectionOmissions).toBeUndefined();
});
