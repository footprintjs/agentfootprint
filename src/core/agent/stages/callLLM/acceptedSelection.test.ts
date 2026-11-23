import { expect, it, vi } from 'vitest';
import { requestAttempt } from '../../../../provider-contract/requestObserver.js';
import { selectionAtRequest } from './selectionAtRequest.js';
import { Agent } from '../../../Agent.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';
import { mockClassifier } from '../../../../classify/mock.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../../provider-contract/types.js';
import { defineTool } from '../../../../tools/tools.js';
import * as slot from '../../../slots/commitServedTools.js';

const tool = (name: string) =>
  defineTool({
    name,
    description: 'Measure ' + name,
    inputSchema: { type: 'object', properties: {} },
    execute: () => name,
  });
const native = { series: 'call-llm#7', attempt: 1, signal: new AbortController().signal };
const chosen = tool('chosen');
const skipped = tool('monitor');
async function run(provider: LLMProvider) {
  let owner: slot.ServedToolParties | undefined;
  const commit = slot.commitServedTools;
  const spy = vi.spyOn(slot, 'commitServedTools').mockImplementation((current, input) => {
    owner = current;
    commit(current, input);
  });
  try {
    const classifier = mockClassifier(() => ({
      model: 'fixture',
      latencyMs: 1,
      usage: { inputTokens: 1, outputTokens: 1 },
      answers: {
        tool: { type: 'choice', choice: 'chosen', confidence: 1, probabilities: { chosen: 1 } },
      },
    }));
    const agent = Agent.create({ provider, model: 'mock' })
      .system('Select.')
      .tool(chosen)
      .tool(skipped)
      .toolChoice({ classifier, serve: { top: 1 } })
      .build();
    await agent.run({ message: 'Check.' });
    expect(owner?.selection?.rows[0].tool).toBe(skipped);
    return owner?.selection?.accepted;
  } finally {
    spy.mockRestore();
  }
}

it('keeps the selected implementation on the accepted native call when the adapter confirms the wire', async () => {
  const accepted = await run(mock({ reply: 'done' }));
  expect(accepted?.consumer).toEqual({ series: expect.any(String), attempt: 1 });
  expect(accepted?.iteration).toBe(1);
  expect(accepted?.rows).toHaveLength(1);
  expect(accepted?.rows[0].tool).toBe(skipped);
});

it('leaves a missing manifest, a reintroduced name and a different final catalog unproved', async () => {
  for (const names of [undefined, ['chosen', 'monitor'], []]) {
    const base = mock({ reply: 'done' });
    const provider: LLMProvider = {
      name: 'fixture',
      async complete(request: LLMRequest): Promise<LLMResponse> {
        const response = await base.complete(request);
        return { ...response, wireManifest: names && { toolNames: names } };
      },
    };
    expect(await run(provider)).toBeUndefined();
  }
});

it('withholds the omission when a leaf changes a retained contract under the same name', async () => {
  const base = mock({ reply: 'done' });
  const provider: LLMProvider = {
    name: 'wrapper',
    async complete(req, hooks) {
      const leaf = { ...req, tools: req.tools?.map((t) => ({ ...t, description: 'replaced' })) };
      const attempt = requestAttempt(hooks, leaf);
      try {
        return await base.complete(leaf);
      } finally {
        attempt.close();
      }
    },
  };
  expect(await run(provider)).toBeUndefined();
});

it('binds the evidence to one successful attempt and discards an ambiguous reused response object', async () => {
  const party = { channel: 'provider' } as const;
  const owner: slot.ServedToolParties = {
    current: new Map([['chosen', party]]),
    lastServed: new Map(),
    selection: {
      iteration: 2,
      complete: true,
      rows: [{ kind: 'top-N', name: 'monitor', tool: skipped, party }],
    },
  };
  const req: LLMRequest = { model: 'mock', messages: [], tools: [chosen.schema] };
  const response = await mock({ reply: 'done' }).complete(req);
  const evidence = selectionAtRequest(owner, 2, native, req, false);
  if (!evidence) throw new Error('missing selection witness');
  const previous = evidence.attempt();
  previous.observe(req);
  previous.finish(response);
  evidence.accept({ ...response });
  expect(owner.selection?.accepted).toBeUndefined();
  const next = evidence.attempt();
  // Even two matching observations cannot identify which attempt supplied a reused object.
  next.observe(req);
  next.finish(response);
  evidence.accept(response);
  expect(owner.selection?.accepted).toBeUndefined();
  expect(selectionAtRequest(owner, 3, native, req, false)).toBeUndefined();
  expect(selectionAtRequest(owner, 2, native, req, true)).toBeUndefined();
});

it('keeps collision winners, a name that another source supplied, and incomplete selection out of the accepted omission list', () => {
  const party = { channel: 'provider' } as const;
  const req: LLMRequest = { model: 'mock', messages: [], tools: [chosen.schema] };
  const owner: slot.ServedToolParties = {
    current: new Map([['chosen', party]]),
    lastServed: new Map(),
    selection: {
      iteration: 1,
      complete: true,
      rows: [
        { kind: 'ledger', name: 'chosen', tool: chosen },
        {
          kind: 'collision',
          name: 'chosen',
          tool: skipped,
          party,
          winner: { tool: chosen, party },
        },
      ],
    },
  };
  expect(selectionAtRequest(owner, 1, native, req, false)).toBeUndefined();
  owner.selection = {
    iteration: 1,
    complete: false,
    rows: [{ kind: 'ledger', name: 'monitor', tool: skipped }],
  };
  expect(selectionAtRequest(owner, 1, native, req, false)).toBeUndefined();
});

it('withholds a completed candidate after native cancellation or an intervening new slot', async () => {
  const party = { channel: 'provider' } as const;
  const owner: slot.ServedToolParties = {
    current: new Map([['chosen', party]]),
    lastServed: new Map(),
    selection: {
      iteration: 1,
      complete: true,
      rows: [{ kind: 'ledger', name: 'monitor', tool: skipped }],
    },
  };
  const req: LLMRequest = { model: 'mock', messages: [], tools: [chosen.schema] };
  const response = await mock({ reply: 'done' }).complete(req);
  for (const cause of ['cancel', 'new-slot']) {
    const controller = new AbortController();
    const witness = selectionAtRequest(
      owner,
      1,
      { ...native, signal: controller.signal },
      req,
      false,
    );
    if (!witness) throw new Error('missing selection witness');
    const attempt = witness.attempt();
    attempt.observe(req);
    attempt.finish(response);
    if (cause === 'cancel') controller.abort();
    else owner.selection = { iteration: 1, complete: true, rows: [] };
    witness.accept(response);
    expect(owner.selection?.accepted).toBeUndefined();
  }
});
