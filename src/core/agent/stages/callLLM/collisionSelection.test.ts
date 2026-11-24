import { expect, it, vi } from 'vitest';
import { Agent, receiptAt } from '../../../../index.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';
import { defineTool } from '../../../../tools/tools.js';
import * as slot from '../../../slots/commitServedTools.js';
import { selectionAtRequest } from './selectionAtRequest.js';

const implementation = (execute: () => string) =>
  defineTool({
    name: 'lookup',
    description: 'Look up a value',
    inputSchema: { type: 'object' },
    execute,
  });

it('ties an accepted collision to the registered implementation that actually answers the call', async () => {
  const executed = vi.fn(() => 'registered');
  const other = vi.fn(() => 'provider');
  const winner = implementation(executed);
  const loser = implementation(other);
  const offers: string[][] = [];
  const selections: NonNullable<slot.ServedToolParties['selection']>[] = [];
  const commit = slot.commitServedTools;
  const spy = vi.spyOn(slot, 'commitServedTools').mockImplementation((owner, input) => {
    commit(owner, input);
    if (owner.selection) selections.push(owner.selection);
  });
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      respond: (req) => {
        offers.push((req.tools ?? []).map((t) => t.name));
        return offers.length === 1
          ? { toolCalls: [{ id: 'lookup-1', name: 'lookup', args: {} }] }
          : 'Finished.';
      },
    }),
  })
    .tool(winner)
    .toolProvider({ id: 'contender', list: () => [loser] })
    .build();
  try {
    await expect(agent.run({ message: 'Look it up.' })).resolves.toBe('Finished.');
    expect(offers).toEqual([['lookup'], ['lookup']]);
    expect(executed).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(selections).toHaveLength(2);
    for (const [i, selection] of selections.entries()) {
      expect(selection.accepted?.iteration).toBe(i + 1);
      const row = selection.accepted?.rows[0];
      if (row?.kind !== 'collision') throw new Error('Missing accepted collision.');
      expect(row.winner.tool).toBe(winner);
      expect(row.tool).toBe(loser);
      const receipt = receiptAt(agent.getLastSnapshot(), i + 1);
      expect(receipt?.basis.epoch).toBe(i + 1);
      expect(receipt?.toolSelection?.absent.map((entry) => entry.name) ?? []).not.toContain(
        'lookup',
      );
    }
  } finally {
    spy.mockRestore();
    await agent.shutdown();
  }
});

const native = { series: 'call-llm#1', attempt: 1, signal: new AbortController().signal };

it.each(['before the request', 'before acceptance'] as const)(
  'withholds a rebound registration %s while retaining an unrelated top-N exclusion',
  async (when) => {
    const winner = implementation(() => 'original');
    const loser = implementation(() => 'competitor');
    const replacement = implementation(() => 'replacement');
    const party = { channel: 'registry' } as const;
    const selection: NonNullable<slot.ServedToolParties['selection']> = {
      iteration: 1,
      complete: true,
      rows: [
        {
          kind: 'collision',
          name: 'lookup',
          party: { channel: 'provider' },
          tool: loser,
          winner: { tool: winner, party },
        },
        {
          kind: 'top-N',
          name: 'other',
          party,
          tool: defineTool({ name: 'other', description: 'Another tool.', execute: () => 'other' }),
        },
      ],
    };
    const owner: slot.ServedToolParties = {
      current: new Map([['lookup', party]]),
      lastServed: new Map(),
      selection,
    };
    const request = { model: 'mock', messages: [], tools: [winner.schema] };
    const response = await mock({ reply: 'Done.' }).complete(request);
    const registryByName = new Map([
      ['lookup', when === 'before the request' ? replacement : winner],
    ]);
    const deps = { servedTools: owner, registrations: { registryByName } };
    const witness = selectionAtRequest(deps, 1, native, request, false);
    if (!witness) throw new Error('Expected the independent top-N witness.');
    const attempt = witness.attempt();
    attempt.observe(request);
    attempt.finish(response);
    registryByName.set('lookup', when === 'before acceptance' ? replacement : winner);
    const accepted = witness.accept(response);
    expect(accepted?.rows).toEqual([selection.rows[1]]);
  },
);

it('does not probe a dynamic provider to identify an offered same-name implementation', () => {
  const winner = implementation(() => 'first');
  const loser = implementation(() => 'second');
  const party = { channel: 'provider', id: 'same' } as const;
  const owner: slot.ServedToolParties = {
    current: new Map([['lookup', party]]),
    lastServed: new Map(),
    selection: {
      iteration: 1,
      complete: true,
      rows: [
        { kind: 'collision', name: 'lookup', party, tool: loser, winner: { tool: winner, party } },
      ],
    },
  };
  const registryByName = new Map([['lookup', winner]]);
  const readBinding = vi.spyOn(registryByName, 'get');
  const request = { model: 'mock', messages: [], tools: [winner.schema] };
  expect(
    selectionAtRequest(
      { servedTools: owner, registrations: { registryByName } },
      1,
      native,
      request,
      false,
    ),
  ).toBeUndefined();
  expect(readBinding).not.toHaveBeenCalled();
});
