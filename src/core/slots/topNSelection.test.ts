import { flowChart, FlowChartExecutor } from 'footprintjs';
import { expect, it } from 'vitest';
import { mockClassifier } from '../../classify/mock.js';
import { staticTools } from '../../tool-providers/staticTools.js';
import type { ToolProvider } from '../../tools/toolProvider.js';
import { defineTool, type Tool } from '../../tools/tools.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';
import { buildToolsSlot, type ServedToolParties } from './buildToolsSlot.js';
import { commitServedTools } from './commitServedTools.js';

const make = (name: string) =>
  defineTool({
    name,
    description: 'Measure ' + name,
    inputSchema: { type: 'object', properties: {} },
    execute: () => name,
  });
const chosen = make('chosen');
const monitor = make('monitor');
const door = make('read_skill');
const classifier = mockClassifier(() => ({
  model: 'fixture',
  latencyMs: 1,
  usage: { inputTokens: 1, outputTokens: 1 },
  answers: {
    tool: { type: 'choice', choice: 'chosen', confidence: 1, probabilities: { chosen: 1 } },
  },
}));

async function prepare(input: {
  served: ServedToolParties;
  tools?: readonly Tool[];
  provider?: ToolProvider;
  claimants?: ReadonlyMap<string, readonly ToolClaim[]>;
  args?: Record<string, unknown>;
  top?: number;
}) {
  const cache = { current: [] };
  const provider = input.provider ?? staticTools(input.tools ?? [chosen, monitor, door]);
  const slot = buildToolsSlot({
    tools: [],
    toolProvider: provider,
    toolClaimants: input.claimants ?? new Map(),
    toolChoice: { classifier, top: input.top },
    runtime: () => ({ providerToolCache: cache, servedTools: input.served }),
  });
  const chart = flowChart('Seed', () => {}, 'seed')
    .addSubFlowChartNext('sf-tools', slot, 'Tools', {
      inputMapper: () => ({ iteration: 2, ...input.args }),
      outputMapper: (state) => ({ wire: state.toolSchemas }),
    })
    .build();
  const executor = new FlowChartExecutor(chart);
  await executor.run();
  return executor.getSnapshot()?.sharedState.wire;
}

it('records the actual top-N loser and keeps the door, then clears the previous selection on a skipped pick', async () => {
  const served: ServedToolParties = { current: new Map(), lastServed: new Map() };
  expect(await prepare({ served, top: 1 })).toEqual([chosen.schema, door.schema]);
  expect(served.selection?.iteration).toBe(2);
  expect(served.selection?.rows).toHaveLength(1);
  expect(served.selection?.rows[0]).toMatchObject({
    kind: 'top-N',
    name: 'monitor',
    party: { channel: 'provider' },
  });
  expect(served.selection?.rows[0].tool).toBe(monitor);
  expect(await prepare({ served, top: 1, args: { wrapUpAsked: true } })).toEqual([
    chosen.schema,
    monitor.schema,
    door.schema,
  ]);
  expect(served.selection).toBeUndefined();
});

it('keeps a role-hidden omission and an absent candidate indistinguishable', async () => {
  const served: ServedToolParties = { current: new Map(), lastServed: new Map() };
  const claims = new Map<string, ToolClaim[]>([
    ['monitor', [{ channel: 'skill', id: 'triage', tool: monitor }]],
  ]);
  await prepare({ served, top: 1, claimants: claims, args: { hiddenSkillIds: ['triage'] } });
  expect(served.selection).toBeUndefined();
  await prepare({ served, top: 1, tools: [chosen, door], args: { hiddenSkillIds: ['triage'] } });
  expect(served.selection).toBeUndefined();
  await prepare({ served, top: 1, claimants: claims });
  expect(served.selection).toBeUndefined();
  await prepare({ served, top: 1, claimants: claims, args: { hiddenSkillIds: [] } });
  expect(served.selection?.rows[0].tool).toBe(monitor);
});

it('starts fresh on provider rebinding and clears the old selection before a failed acquisition', async () => {
  const served: ServedToolParties = { current: new Map(), lastServed: new Map() };
  await prepare({ served, top: 1 });
  const replacement = make('monitor');
  await prepare({ served, top: 1, tools: [chosen, replacement] });
  expect(served.selection?.rows[0].tool).toBe(replacement);
  const error = Error('provider is unavailable');
  await expect(
    prepare({
      served,
      top: 1,
      provider: {
        list() {
          throw error;
        },
      },
    }),
  ).rejects.toThrow('provider is unavailable');
  expect(served.selection).toBeUndefined();
});

it('shares the discovery bound with eligible pick decisions and ignores hidden and unknown candidates before counting', () => {
  const served: ServedToolParties = { current: new Map(), lastServed: new Map() };
  const tools = ['hidden', 'eligible', 'overflow'].map(make);
  const winners = new Map(
    tools.map((tool) => [tool.schema.name, { channel: 'provider' as const }]),
  );
  const winningTools = new Map(tools.map((tool) => [tool.schema.name, tool]));
  const input = {
    iteration: 3,
    winners,
    winningTools,
    claimants: new Map<string, ToolClaim[]>([
      ['hidden', [{ channel: 'skill', id: 'hidden-skill', tool: tools[0] }]],
    ]),
    hiddenSkillIds: ['hidden-skill'],
    discovered: {
      complete: true,
      rows: Array.from({ length: 1023 }, (_, i) => {
        const name = 'ledger_' + i;
        return { kind: 'ledger' as const, name, tool: make(name) };
      }),
    },
  };
  commitServedTools(served, { ...input, omitted: ['hidden', 'missing', 'eligible'] });
  expect(served.selection?.complete).toBe(true);
  expect(served.selection?.rows).toHaveLength(1024);
  expect(served.selection?.rows.at(-1)?.tool).toBe(tools[1]);
  commitServedTools(served, { ...input, omitted: ['hidden', 'missing', 'eligible', 'overflow'] });
  expect(served.selection?.complete).toBe(false);
  expect(served.selection?.rows).toHaveLength(1024);
  expect(served.selection?.rows.at(-1)?.tool).toBe(tools[1]);
});
