/**
 * Freeze the current public persistence boundary before typed findings work.
 * These are today's model-authored standings, not checked claims. The same
 * reader and writer run together; no older reader or future row is emulated.
 */
import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  type AgentRunCheckpoint,
  type RedactionPolicy,
} from '../../../src/index.js';
import { recordRun } from '../../../src/doors/observe.js';
import { mock } from '../../../src/doors/providers.js';
import { conversationRedaction } from '../../../src/doors/security.js';

const CANARY = 'findings-private-value-7b4';
const ASSERTION = {
  subject: { kind: 'port', id: 'p1' },
  predicate: 'reading',
  value: { token: CANARY, count: 0, flag: false, missing: null },
};

function agentWith(provider: ReturnType<typeof mock>, ran: string[], redact?: RedactionPolicy) {
  return Agent.create({ provider, model: 'mock', maxIterations: 4, ...(redact && { redact }) })
    .tool(
      defineTool<{ q: string }, string>({
        name: 'look',
        description: 'Read the synthetic port fixture.',
        inputSchema: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
        execute: ({ q }) => {
          ran.push(q);
          return `fixture result for ${q}`;
        },
      }),
    )
    .findings()
    .build();
}

async function recordedFindings(redact?: RedactionPolicy) {
  const ran: string[] = [];
  const agent = agentWith(
    mock({
      chunkDelayMs: 0,
      replies: [
        {
          toolCalls: [
            { id: 'c1', name: 'look', args: { q: 'p1', _findings: { basis: 'direct' } } },
          ],
        },
        {
          toolCalls: [
            {
              id: 'c2',
              name: 'look',
              args: {
                q: 'p2',
                _findings: {
                  basis: 'exploratory',
                  previous: [{ toolCallId: 'c1', standing: 'fact', assertions: [ASSERTION] }],
                },
              },
            },
          ],
        },
        {
          content: JSON.stringify({
            answer: 'complete',
            _findings: {
              previous: ['open', 'ruled-out', 'noise'].map((standing) => ({
                toolCallId: 'c1',
                standing,
                assertions: [ASSERTION],
              })),
            },
          }),
        },
      ],
    }),
    ran,
    redact,
  );
  const recorder = recordRun(agent);
  await agent.run({ message: 'Read the synthetic ports.' });
  expect(ran).toEqual(['p1', 'p2']);
  const checkpoint = agent.checkpoint();
  expect(checkpoint).toBeDefined();
  if (checkpoint === undefined) throw new Error('The completed fixture must have a checkpoint.');
  return { agent, checkpoint, recording: recorder.toRecording() };
}

const doors = ['continueFrom', 'resumeOnError'] as const;
function continueThrough(
  agent: Agent,
  door: (typeof doors)[number],
  checkpoint: AgentRunCheckpoint,
) {
  return door === 'continueFrom'
    ? agent.run({ message: 'Continue without declaring anything.', continueFrom: checkpoint })
    : agent.resumeOnError(checkpoint);
}

describe('existing findings through the public checkpoint doors', () => {
  it.each(doors)(
    '%s preserves JSON-stored standings without declaring them again',
    async (door) => {
      const { agent: first, checkpoint } = await recordedFindings();
      const stored = JSON.parse(JSON.stringify(checkpoint)) as AgentRunCheckpoint;
      const original = first.findings();
      expect(stored.findingsLedger).toEqual(original);
      const standings = original?.filter((row) => row.kind === 'standing');
      expect(standings?.map((row) => row.standing)).toEqual(['fact', 'open', 'ruled-out', 'noise']);
      expect(standings?.map((row) => row.assertions)).toEqual([
        [{ ...ASSERTION, stratum: 'asserted', provenance: 'tool:c1' }],
        [{ ...ASSERTION, stratum: 'quoted', provenance: 'tool:c1' }],
        [{ ...ASSERTION, stratum: 'quoted', provenance: 'tool:c1' }],
        [],
      ]);
      expect(standings?.map((row) => row.declaredOn)).toEqual([
        { toolCallId: 'c2' },
        'answer',
        'answer',
        'answer',
      ]);

      const ran: string[] = [];
      const requests: string[] = [];
      const second = agentWith(
        mock({
          chunkDelayMs: 0,
          respond: (request) => {
            requests.push(JSON.stringify(request.messages));
            return 'continued';
          },
        }),
        ran,
      );
      const events: string[] = [];
      second.on('*', (event) => events.push(event.type));
      await continueThrough(second, door, stored);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain(CANARY);
      expect(ran).toEqual([]);
      expect(second.findings()).toEqual(original);
      expect(second.checkpoint()?.findingsLedger).toEqual(original);
      expect(events.filter((type) => type.startsWith('agentfootprint.findings.'))).toEqual([]);
      expect(stored).toEqual(checkpoint);
    },
  );

  it.each(doors)(
    '%s refuses an unknown stored row kind before provider or tool work',
    async (door) => {
      const { checkpoint } = await recordedFindings();
      const raw = JSON.parse(JSON.stringify(checkpoint));
      raw.findingsLedger[0].kind = 'unrecognized-test-row';
      const ran: string[] = [];
      let providerCalls = 0;
      const next = agentWith(
        mock({
          chunkDelayMs: 0,
          respond: () => {
            providerCalls += 1;
            return 'must not run';
          },
        }),
        ran,
      );
      // Deliberately tampered serialized input, not a fabricated internal stage.
      await expect(continueThrough(next, door, raw as AgentRunCheckpoint)).rejects.toThrow(
        /findingsLedger/,
      );
      expect(providerCalls).toBe(0);
      expect(ran).toEqual([]);
      expect(next.findings()).toBeUndefined();
    },
  );

  it('serves redacted findings records while live findings and continuation retain their values', async () => {
    const control = await recordedFindings();
    const protectedRun = await recordedFindings(conversationRedaction());
    expect(JSON.stringify(control.recording)).toContain(CANARY);
    expect(JSON.stringify(control.agent.getLastSnapshot())).toContain(CANARY);
    expect(JSON.stringify(protectedRun.recording)).not.toContain(CANARY);
    expect(JSON.stringify(protectedRun.agent.getLastSnapshot())).not.toContain(CANARY);
    // These are caller-owned live/resume surfaces, not served recordings.
    expect(protectedRun.agent.findings()).toEqual(control.agent.findings());
    expect(protectedRun.checkpoint.findingsLedger).toEqual(control.checkpoint.findingsLedger);

    const next = agentWith(
      mock({ reply: 'continued', chunkDelayMs: 0 }),
      [],
      conversationRedaction(),
    );
    const recorder = recordRun(next);
    await next.run({
      message: 'Continue.',
      continueFrom: JSON.parse(JSON.stringify(protectedRun.checkpoint)) as AgentRunCheckpoint,
    });
    expect(next.findings()).toEqual(control.agent.findings());
    expect(next.checkpoint()?.findingsLedger).toEqual(control.checkpoint.findingsLedger);
    expect(JSON.stringify(recorder.toRecording())).not.toContain(CANARY);
  });
});
