import { describe, expect, it } from 'vitest';
import { Agent, defineTool, inMemoryArtifacts } from '../../src/index.js';
import { accountForAnswer } from '../../src/answer-account/account.js';
import { NoOpCacheStrategy } from '../../src/cache/strategies/NoOpCacheStrategy.js';
import { defineSkill } from '../../src/injection-engine.js';
import { stepAdvanceSuffix } from '../../src/injection-engine/skillSteps.js';
import { readEmptiness } from '../../src/core/agent/emptiness.js';
import { issuedTicketsOf } from '../../src/core/agent/placedTickets.js';
import type { FindingsRequest } from '../../src/core/agent/findings/admission.js';
import type { LLMMessage, LLMProvider, LLMRequest } from '../../src/provider-contract/types.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';

const identity = { conversationId: 'placement-receipts' };
const sourceId = 'fixture-read';
const readName = 'read_fixture';
const placementStepNote = stepAdvanceSuffix(
  {
    skillId: 'sample-procedure',
    step: 2,
    total: 1,
    skipped: [],
    advanceOutcomes: { succeeded: 0, notReported: 1 },
  },
  {
    skillId: 'sample-procedure',
    steps: [{ tool: readName, note: 'Read the sample rows.' }],
    toolNames: new Set([readName]),
    onSkip: 'advance',
  },
  { outcome: 'not-reported' },
);
const declarations = { tools: { [readName]: { rowsAt: 'rows' } } };
const fixtureTicket = {
  placed: true,
  ref: 'art_fixture_never_stored',
  kind: 'dataset/rows',
  reason: 'sample description',
  rows: [{ name: 'sample' }],
};

class ReformatResult extends NoOpCacheStrategy {
  async prepareRequest(request: LLMRequest) {
    return {
      request: {
        ...request,
        messages: request.messages.map((message) =>
          message.role === 'tool' && message.toolCallId === sourceId
            ? { ...message, content: JSON.stringify(JSON.parse(message.content), null, 2) }
            : message,
        ),
      },
      markersApplied: [],
    };
  }
}

async function run(
  options: {
    placed?: boolean;
    stepped?: boolean;
    rewrite?: boolean;
    reactMode?: 'dynamic' | 'dynamic-grouped';
  } = {},
) {
  const store = inMemoryArtifacts();
  const read = defineTool({
    name: readName,
    description: 'Read sample rows.',
    resultKind: 'dataset/rows',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      options.placed
        ? { rows: Array.from({ length: 100 }, () => ({ name: 'sample' })) }
        : fixtureTicket,
  });
  const note = defineTool({
    name: 'note_fixture',
    description: 'Record that the sample was read.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'noted',
  });
  const seen: LLMMessage[] = [];
  const nudged: unknown[] = [];
  const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
    id,
    name,
    args,
  });
  const replies = [
    ...(options.stepped ? [call('start-procedure', 'read_skill', { id: 'sample-procedure' })] : []),
    call(sourceId, readName),
    call('fixture-note', 'note_fixture', {
      _findings: {
        basis: 'direct',
        previous: [
          {
            toolCallId: sourceId,
            standing: 'fact',
            assertions: [
              {
                subject: { kind: 'fixture', id: 'sample' },
                predicate: 'availability',
                value: 'listed',
              },
            ],
          },
        ],
      },
    }),
  ];
  let iteration = 0;
  const provider: LLMProvider = {
    name: 'scripted',
    complete: async (request) => {
      const source = request.messages.find((message) => message.toolCallId === sourceId);
      if (source) seen.push(source);
      const next = replies[iteration++];
      return {
        content: next === undefined ? 'Sample checked.' : '',
        toolCalls: next === undefined ? [] : [next],
        usage: { input: 0, output: 0 },
      };
    },
  };
  const builder = Agent.create({
    provider,
    model: 'mock',
    reactMode: options.reactMode ?? 'dynamic',
    artifacts: { store, recordings: true, placement: { maxInlineChars: 500 } },
    ...(options.rewrite && { cacheStrategy: new ReformatResult() }),
  })
    .tool(note)
    .tool(
      defineTool({
        name: 'render_fixture',
        description: 'Render a staged sample.',
        inputSchema: { type: 'object', properties: { dataset: { type: 'string' } } },
        wants: { dataset: 'dataset/rows' },
        execute: () => 'rendered',
      }),
    )
    .findings()
    .namesAndNumbersFromEvidence({ nudge: true });
  if (options.stepped) {
    builder.injection(
      defineSkill({
        id: 'sample-procedure',
        description: 'A procedure for reading the sample.',
        body: 'Read the sample rows.',
        tools: [read],
        steps: [{ tool: readName, note: 'Read the sample rows.' }],
      }),
    );
  } else {
    builder.tool(read);
  }
  const agent = builder.build();
  let recordingRef: string | undefined;
  agent.on('agentfootprint.artifacts.minted', ({ payload }) => {
    if (payload.kind === 'recording/run') recordingRef = payload.ref;
  });
  agent.on('agentfootprint.agent.grounding_nudged', ({ payload }) => {
    nudged.push(payload);
  });
  await agent.run({ message: 'Check the sample.', identity });
  if (recordingRef === undefined) throw Error('The run did not mint a recording.');
  const stored = await store.get(identity, recordingRef);
  const recording = JSON.parse(stored!.data as string) as Recording;
  const runId = stored!.meta.origin?.runId;
  const account = accountForAnswer(recording, declarations, { runId });
  const state = agent.getLastSnapshot()!.sharedState as {
    readonly placedTickets?: readonly { toolCallId: string; ref: string }[];
    readonly findingsRequest?: readonly FindingsRequest[];
  };
  const observed = state.findingsRequest?.[0]?.results.find(
    (result) => result.toolCallId === sourceId,
  );
  const standing = agent
    .findings()
    ?.find((row) => row.kind === 'standing' && row.toolCallId === sourceId);
  return { account, nudged, observed, recording, runId, seen, standing, state };
}

function placementSentence(account: ReturnType<typeof accountForAnswer>) {
  return account.unreachable.find(
    ({ sentence }) => sentence.template.id === 'unreachable.empty.uncountedTicket',
  );
}

describe('placement receipts through an actual agent run', () => {
  it('reads rows from the tool’s own ticket-shaped value', async () => {
    const { account, observed, state } = await run();
    expect(state.placedTickets ?? []).toEqual([]);
    expect(observed).toMatchObject({ execution: 'result', visibility: 'unknown' });
    expect(observed).not.toHaveProperty('ref');
    expect(placementSentence(account)).toBeUndefined();
    expect(
      account.rows.find((row) => row.id === 'found')?.lines.map((line) => line.text),
    ).toContain('read_fixture returned 1 item.');
  });

  it('attributes a claim to its tool call after provider preparation reformats the sample', async () => {
    const { seen, observed, standing, state } = await run({ rewrite: true });
    expect(seen[0]?.content).toBe(JSON.stringify(fixtureTicket, null, 2));
    expect(state.placedTickets ?? []).toEqual([]);
    expect(standing).toMatchObject({ assertions: [{ provenance: 'tool:fixture-read' }] });
    expect(standing).not.toHaveProperty('ref');
    expect(observed).toMatchObject({ execution: 'result', visibility: 'unknown' });
    expect(observed).not.toHaveProperty('ref');
  });

  it('names a receipt-backed staged ref after the procedure appends its step note', async () => {
    const { nudged, seen, state } = await run({ placed: true, stepped: true });
    const receipt = state.placedTickets?.find((ticket) => ticket.toolCallId === sourceId);
    expect(receipt?.ref).toBeTypeOf('string');
    expect(seen[0]?.content).toContain(placementStepNote);
    expect(nudged[0]).toMatchObject({
      refs: [{ ref: receipt!.ref, kind: 'dataset/rows' }],
      tools: ['render_fixture'],
    });
  });

  it.each([
    ['dynamic', false],
    ['dynamic', true],
    ['dynamic-grouped', true],
  ] as const)(
    '%s reads a library placement in all three readers with steps = %s',
    async (reactMode, stepped) => {
      const { account, observed, recording, runId, seen, standing, state } = await run({
        placed: true,
        stepped,
        reactMode,
      });
      const receipt = state.placedTickets?.find((ticket) => ticket.toolCallId === sourceId);
      expect(receipt?.ref).toBeTypeOf('string');
      expect(seen[0]?.content).toContain(receipt!.ref);
      if (stepped) expect(seen[0]?.content).toContain(placementStepNote);
      expect(
        readEmptiness(seen[0]?.content, {
          placement: { toolCallId: sourceId, issued: issuedTicketsOf(state.placedTickets) },
        }),
      ).toMatchObject({ emptiness: 'unknown', rowsUnread: 'uncounted-ticket' });
      expect(placementSentence(account)?.sentence.text).toContain('ticket to the artifact store');
      expect(standing).toMatchObject({
        ref: receipt!.ref,
        assertions: [{ provenance: 'artifact:' + receipt!.ref }],
      });
      expect(observed).toMatchObject({
        execution: 'result',
        visibility: 'ticket',
        ref: receipt!.ref,
      });

      const snapshot = recording.snapshot as { sharedState: Record<string, unknown> };
      const { placedTickets: _receipt, ...legacy } = snapshot.sharedState;
      expect(
        placementSentence(
          accountForAnswer(
            { ...recording, snapshot: { ...snapshot, sharedState: legacy } },
            declarations,
            { runId },
          ),
        ),
      ).toBeUndefined();
    },
  );
});
