import { expect, it, vi } from 'vitest';
import { Agent, askHuman, defineTool, describedResult, isPaused } from '../../../index.js';
import { mock } from '../../../doors/providers.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { RunCheckpointError, validateCheckpoint } from '../../runCheckpoint.js';
import type { ProseCitationOptions } from './config.js';

const citations: ProseCitationOptions = {
  verification: {
    rules: [
      {
        id: 'reading',
        version: '1',
        toolName: 'read',
        scopeDeclaration: {
          id: 'measurement',
          version: '1',
          dimensions: [{ name: 'unit', argumentPath: ['unit'] }],
        },
        fact: { entity: 'North', field: 'amount' },
        coverage: () => 'complete',
      },
    ],
    authorizeEvidence: () => ({ resultVisible: true, scopeVisible: true }),
  },
};

const read = defineTool({
  name: 'read',
  description: 'Read the measurement.',
  inputSchema: { type: 'object' },
  execute: () =>
    describedResult({
      facts: [{ entity: 'North', amount: 12 }],
      provenance: { measuredAt: '2026-11-23T00:00:00Z', source: 'synthetic fixture' },
      coverage: { checked: ['amount'] },
    }),
});
const ask = defineTool({
  name: 'ask',
  description: 'Wait for confirmation.',
  inputSchema: { type: 'object' },
  execute: () => askHuman({ question: 'Continue?' }),
});

const first = { toolCalls: [{ id: 'read-id', name: 'read', args: { unit: 'mm' } }] };
const pause = { toolCalls: [{ id: 'ask-id', name: 'ask', args: {} }] };

function build(provider: ReturnType<typeof mock>, reactMode: 'dynamic' | 'dynamic-grouped') {
  return Agent.create({ provider, model: 'fixture', maxIterations: 4, citations, reactMode })
    .tool(read)
    .tool(ask)
    .build();
}

it.each(['dynamic', 'dynamic-grouped'] as const)(
  'restores native same-request citation custody and keeps it off exported %s state',
  async (mode) => {
    const agent = build(mock({ replies: [first, pause, 'Confirmed.'] }), mode);
    const current = await agent.run({ message: 'Read and confirm.' });
    if (!isPaused(current)) throw new Error('Fixture must pause in tool calls.');
    const saved = JSON.parse(JSON.stringify(current.checkpoint)) as typeof current.checkpoint;
    const before = agent.checkpoint();
    expect(before?.citationSources).toHaveLength(1);
    expect(saved.sharedState.citationSources).toEqual(before?.citationSources);
    const keptSource = before?.citationSources?.[0];
    if (!keptSource) throw new Error('Fixture must keep one locator.');
    const committedToolRow = before.history.find((message) => message.toolCallId === 'read-id');
    if (!committedToolRow) throw new Error('Fixture must keep the executed tool row.');
    expect(readCallOccurrenceKey(committedToolRow)).toBe(readCallOccurrenceKey(keptSource));
    const { resultId, bodyDigest } = keptSource;
    const publicSnapshot = JSON.stringify(agent.getLastSnapshot());
    expect(publicSnapshot).not.toContain(resultId);
    expect(publicSnapshot).not.toContain(bodyDigest);

    await expect(agent.resume(saved, 'yes')).resolves.toBe('Confirmed.');
    expect(agent.checkpoint()?.citationSources).toEqual(before?.citationSources);
    expect(agent.checkpoint()?.claimVerification).toEqual(before?.claimVerification);

    const continued = build(mock({ reply: 'New answer.' }), mode);
    const input = agent.checkpoint();
    if (!input) throw new Error('Fixture must keep a conversation checkpoint.');
    await expect(continued.run({ message: 'New question.', continueFrom: input })).resolves.toBe(
      'New answer.',
    );
    expect(continued.checkpoint()).not.toHaveProperty('citationSources');
    expect(continued.checkpoint()).not.toHaveProperty('claimVerification');
  },
);

it('restores a real crash checkpoint with one matching receipt and refuses detached locators', async () => {
  const fail = vi.fn(() => {
    throw new Error('Scripted provider failure.');
  });
  const provider = mock({
    respond: (request) => {
      if (!request.messages.some((message) => message.role === 'tool')) return first;
      return fail();
    },
  });
  const agent = build(provider, 'dynamic');
  const identity = { conversationId: 'test', principal: 'alice', tenant: 'measurements' };
  const error: unknown = await agent
    .run({ message: 'Read and report.', identity })
    .catch((cause) => cause);
  if (!(error instanceof RunCheckpointError)) throw error;
  const saved = validateCheckpoint(JSON.parse(JSON.stringify(error.checkpoint)));
  expect(saved.citationSources).toHaveLength(1);
  const source = saved.citationSources?.[0];
  if (!source) throw new Error('Fixture must keep one locator.');
  expect(saved.claimVerification?.evidence.results[0]?.id).toBe(source.resultId);
  expect(saved).not.toHaveProperty('acceptedCitationOffer');
  expect(() =>
    validateCheckpoint({
      ...saved,
      citationSources: [{ ...source, resultId: 'unknown-lineage' }],
    }),
  ).toThrow(/receipt binding/);
  expect(() =>
    validateCheckpoint({
      ...saved,
      citationSources: [{ ...source, body: 'unretained raw body' }],
    }),
  ).toThrow();

  const recovered = build(mock({ reply: 'Recovered.' }), 'dynamic');
  await expect(
    recovered.resumeOnError(saved, {
      identity: { ...identity, principal: 'different-caller' },
    }),
  ).rejects.toThrow(/identity/i);
  await expect(recovered.resumeOnError(saved)).resolves.toBe('Recovered.');
  expect(recovered.checkpoint()?.citationSources).toEqual(saved.citationSources);
  expect(recovered.checkpoint()?.claimVerification).toEqual(saved.claimVerification);
});

it('shares citation and negative-claim reservation state without carrying old evidence into a new turn', async () => {
  const buildWithNegatives = (provider: ReturnType<typeof mock>) =>
    Agent.create({ provider, model: 'fixture', maxIterations: 4, citations })
      .negativeClaims({ prose: true })
      .tool(read)
      .build();
  const agent = buildWithNegatives(mock({ replies: [first, 'Measured.', 'Hello.'] }));
  await expect(agent.run({ message: 'Measure it.' })).resolves.toBe('Measured.');
  const saved = validateCheckpoint(JSON.parse(JSON.stringify(agent.checkpoint())));
  expect(saved.citationSources).toHaveLength(1);
  expect(saved.claimVerification?.evidence.results).toHaveLength(1);
  expect(saved.negativeClaimState).toBeDefined();
  expect(saved).not.toHaveProperty('resultIdentities');

  await expect(agent.followUp('Say hello.')).resolves.toBe('Hello.');
  const next = validateCheckpoint(JSON.parse(JSON.stringify(agent.checkpoint())));
  expect(next.citationSources).toEqual([]);
  expect(next.claimVerification?.evidence.results).toEqual([]);
  expect(next.claimVerification?.nextResultOrdinal).toBe(
    saved.claimVerification?.nextResultOrdinal,
  );
});
