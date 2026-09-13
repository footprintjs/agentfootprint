/** Regression: internal evidence feedback must never impersonate a user. */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  UnsupportedValuesError,
  servedAt,
  receiptAt,
  receiptHash,
} from '../../../src/index.js';
import type { EvidenceRecoveryContext, NamesAndNumbersOptions } from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

const question = 'Show SMB on SHISOLPLPAP006 between 14:15 and 14:40 on 11 September';
const draft = 'Which year: 2024 or 2023?';
const clarification = 'Which year and timezone should I use?';
const guidance =
  'Ask only for missing time details. Preserve the supplied cluster and clock times.';

function setup(
  replies: readonly Partial<LLMResponse>[],
  options: NamesAndNumbersOptions = { posture: 'guard' },
  reactMode: 'dynamic' | 'dynamic-grouped' | 'classic' = 'dynamic',
) {
  const requests: LLMRequest[] = [];
  const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const tool = defineTool({
    name: 'lookup',
    description: 'Read the measured year',
    inputSchema: { type: 'object', properties: {} },
    execute: () => ({ year: 2024 }),
  });
  const provider = {
    name: 'recorded-mock',
    complete: async (request: LLMRequest): Promise<LLMResponse> => {
      const reply = replies[requests.length];
      // The provider can receive scope-backed arrays; record their JSON wire values.
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      if (reply === undefined) throw new Error('Unexpected additional model call');
      return { content: '', toolCalls: [], usage: { input: 1, output: 1 }, ...reply };
    },
  };
  const agent = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 8,
    reactMode,
    recordSystemPrompt: true,
  })
    .system('Answer from evidence. Ask when required information is missing.')
    .tool(tool)
    .namesAndNumbersFromEvidence(options)
    .watch({
      id: 'recovery-record',
      onEmit: (e) => {
        events.push({ name: e.name, payload: (e.payload ?? {}) as Record<string, unknown> });
      },
    })
    .build();
  return { agent, requests, events };
}

describe('evidence recovery: provenance, lifetime and preserved enforcement', () => {
  for (const mode of ['dynamic', 'dynamic-grouped', 'classic'] as const) {
    it(`serves internal repair without inserting a user correction (${mode})`, async () => {
      const { agent, requests, events } = setup(
        [{ content: draft }, { content: clarification }, { content: 'Ready.' }],
        { posture: 'guard', recoveryInstruction: guidance },
        mode,
      );
      expect(await agent.run({ message: question })).toBe(clarification);
      expect(requests).toHaveLength(2);
      expect(requests[1]!.messages).toEqual(requests[0]!.messages);
      expect(requests[1]!.systemPrompt).toContain(guidance);
      expect(requests[1]!.systemPrompt).toContain(draft);
      expect(requests[1]!.systemPrompt).toMatch(/internal/i);
      expect(requests[0]!.systemPrompt).not.toContain(guidance);
      const history = (agent.getLastSnapshot()!.sharedState as { history: unknown }).history;
      expect(JSON.stringify(history)).not.toContain(draft);
      expect(JSON.stringify(history)).not.toContain(guidance);
      const calls = events.filter((e) => e.name === 'agentfootprint.stream.llm_start');
      expect(calls[1]!.payload.systemPromptText).toBe(requests[1]!.systemPrompt);
      const snapshot = agent.getLastSnapshot()!;
      const served = servedAt(snapshot, 2)!;
      const receipt = receiptAt(snapshot, 2)!;
      expect(served.system.text).toBe(requests[1]!.systemPrompt);
      expect(served.system.pieces.some((p) => p.source === 'evidence-recovery')).toBe(true);
      expect(receipt.system.hash).toBe(receiptHash(receipt.basis.runId, served.system.text));
      expect(receipt.system.pieces.map((p) => p.source)).toEqual(
        served.system.pieces.map((p) => p.source),
      );
      expect(
        events
          .filter((e) => e.name === 'agentfootprint.agent.evidence_checked')
          .map((e) => e.payload.action),
      ).toEqual(['revision-asked', 'grounded']);
      await agent.run({ message: 'Start another request.', continueFrom: agent.checkpoint() });
      expect(requests[2]!.systemPrompt).not.toContain(guidance);
      expect(JSON.stringify(requests[2])).not.toContain(draft);
    });
  }

  it('gives the app detached structured feedback exactly once', async () => {
    const seen: EvidenceRecoveryContext[] = [];
    const { agent } = setup([{ content: draft }, { content: clarification }], {
      posture: 'guard',
      recoveryInstruction: (context) => {
        seen.push(context);
        return guidance;
      },
    });
    await agent.run({ message: question });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: 'evidence',
      attempt: 1,
      originalRequest: question,
      rejectedDraft: draft,
    });
    expect(seen[0]!.unsupported.map((v) => v.value).sort()).toEqual(['2023', '2024']);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(Object.isFrozen(seen[0]!.unsupported)).toBe(true);
  });

  it('does not launder quoted or custom values into evidence on the retry', async () => {
    const { agent, requests } = setup(
      [{ content: 'It happened in 2024.' }, { content: 'It happened in 2024.' }],
      {
        posture: 'rails',
        recoveryInstruction: 'The rejected example says 2024; that is not verified.',
      },
    );
    await expect(agent.run({ message: question })).rejects.toThrow(UnsupportedValuesError);
    expect(requests).toHaveLength(2);
  });

  it('allows a real lookup during repair and removes the instruction on the following call', async () => {
    const { agent, requests } = setup(
      [
        { content: 'It happened in 2024.' },
        { toolCalls: [{ id: 'lookup-1', name: 'lookup', args: {} }] },
        { content: 'It happened in 2024.' },
      ],
      { posture: 'rails', recoveryInstruction: guidance },
    );
    expect(await agent.run({ message: question })).toBe('It happened in 2024.');
    expect(requests[1]!.systemPrompt).toContain(guidance);
    expect(requests[2]!.systemPrompt).not.toContain(guidance);
    expect(requests[2]!.messages.some((m) => m.role === 'tool' && m.content.includes('2024'))).toBe(
      true,
    );
  });

  it('never invokes recovery for assist or an already grounded answer', async () => {
    let calls = 0;
    const recoveryInstruction = () => {
      calls++;
      return guidance;
    };
    await setup([{ content: draft }], { posture: 'assist', recoveryInstruction }).agent.run({
      message: question,
    });
    await setup([{ content: clarification }], { posture: 'guard', recoveryInstruction }).agent.run({
      message: question,
    });
    expect(calls).toBe(0);
  });

  it('undefined app guidance still delivers the internal default repair', async () => {
    const { agent, requests } = setup([{ content: draft }, { content: clarification }], {
      posture: 'guard',
      recoveryInstruction: () => undefined,
    });
    await agent.run({ message: question });
    expect(requests[1]!.systemPrompt).toMatch(/internal/i);
    expect(requests[1]!.systemPrompt).toContain(draft);
  });

  it('refuses an asynchronous policy instead of injecting a Promise', async () => {
    const { agent, requests } = setup([{ content: draft }], {
      posture: 'guard',
      recoveryInstruction: (() => Promise.resolve(guidance)) as never,
    });
    await expect(agent.run({ message: question })).rejects.toThrow(/recoveryInstruction/);
    expect(requests).toHaveLength(1);
  });

  it('refuses oversized guidance before any model call', () => {
    expect(() => setup([], { posture: 'guard', recoveryInstruction: 'x'.repeat(4001) })).toThrow(
      /recoveryInstruction/,
    );
  });

  it('restores pending feedback on crash resume without granting another revision', async () => {
    const first = setup([{ content: draft }], { posture: 'rails', recoveryInstruction: guidance });
    const error = await first.agent.run({ message: question }).catch((e: unknown) => e);
    const checkpoint = JSON.parse(JSON.stringify((error as { checkpoint: unknown }).checkpoint));
    expect(checkpoint.evidenceRecovery).toMatchObject({ revisionSpent: true });
    expect(checkpoint.evidenceRecovery.pending.instruction).toContain(guidance);
    expect(JSON.stringify(checkpoint.history)).not.toContain(draft);
    const resumed = setup([{ content: draft }], { posture: 'rails' });
    await expect(resumed.agent.resumeOnError(checkpoint)).rejects.toThrow(UnsupportedValuesError);
    expect(resumed.requests).toHaveLength(1);
    expect(resumed.requests[0]!.systemPrompt).toContain(guidance);
    expect(
      resumed.requests[0]!.messages.filter((m) => m.role === 'user').map((m) => m.content),
    ).toEqual([question]);
  });

  it('keeps the spent budget after repair used a tool, with no stale feedback on resume', async () => {
    const first = setup(
      [{ content: draft }, { toolCalls: [{ id: 'repair-lookup', name: 'lookup', args: {} }] }],
      { posture: 'rails', recoveryInstruction: guidance },
    );
    const error = await first.agent.run({ message: question }).catch((e: unknown) => e);
    const checkpoint = JSON.parse(JSON.stringify((error as { checkpoint: unknown }).checkpoint));
    expect(checkpoint.evidenceRecovery).toEqual({ revisionSpent: true });
    const resumed = setup([{ content: 'It happened in 2025.' }], { posture: 'rails' });
    await expect(resumed.agent.resumeOnError(checkpoint)).rejects.toThrow(UnsupportedValuesError);
    expect(resumed.requests).toHaveLength(1);
    expect(resumed.requests[0]!.systemPrompt).not.toContain(guidance);
  });
});

// The choice checker is advisory: the tool still runs, but a quoted rejected
// identifier must not be credited to a person or to trusted system evidence.
describe('evidence recovery at the tool-argument boundary', () => {
  it('keeps a rejected identifier unsupported while preserving genuine user ground', async () => {
    const requests: LLMRequest[] = [];
    const findings: Array<Record<string, unknown>> = [];
    const executed: unknown[] = [];
    const replies: readonly Partial<LLMResponse>[] = [
      { content: 'Machine ghost-9917 is ready.' },
      {
        toolCalls: [
          {
            id: 'inspect-repaired',
            name: 'inspect_machine',
            args: { machine: 'ghost-9917', peer: 'callisto-02' },
          },
        ],
      },
      { content: 'No records were found.' },
    ];
    const agent = Agent.create({
      provider: {
        name: 'recorded-mock',
        complete: async (request: LLMRequest): Promise<LLMResponse> => {
          const reply = replies[requests.length];
          requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
          if (reply === undefined) throw new Error('Unexpected additional model call');
          return { content: '', toolCalls: [], usage: { input: 1, output: 1 }, ...reply };
        },
      },
      model: 'mock',
      maxIterations: 5,
      reactMode: 'dynamic-grouped',
    })
      .system('Inspect only machines identified by the person or the fleet report.')
      .tool(
        defineTool({
          name: 'fleet_report',
          description: 'Lists known machines.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => ({ machines: ['callisto-02'] }),
        }),
      )
      .tool(
        defineTool({
          name: 'inspect_machine',
          description: 'Inspect a machine and its peer.',
          inputSchema: {
            type: 'object',
            properties: { machine: { type: 'string' }, peer: { type: 'string' } },
            required: ['machine', 'peer'],
          },
          argumentsFrom: ['fleet_report'],
          execute: (args) => {
            executed.push(args);
            return 'No records were found.';
          },
        }),
      )
      .namesAndNumbersFromEvidence({ posture: 'guard' })
      .build();
    agent.on('agentfootprint.integrity.context_error', (event) => {
      if (event.payload.kind === 'unsupported-argument') {
        findings.push(event.payload as unknown as Record<string, unknown>);
      }
    });

    expect(await agent.run({ message: 'Inspect callisto-02.' })).toBe('No records were found.');
    expect(requests).toHaveLength(3);
    expect(executed).toEqual([{ machine: 'ghost-9917', peer: 'callisto-02' }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ seam: 'choice', predicate: 'machine' });
    expect(String(findings[0]!.message)).toContain('ghost-9917');
    expect(String(findings[0]!.message)).toContain('inspect_machine');
  });
});
