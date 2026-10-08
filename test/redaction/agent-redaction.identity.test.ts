/**
 * The host's identity on a redacted record — who asked (`principal`,
 * `tenant`) and who approved (a check-in decision's `by`). This release keeps
 * events to the library's own words under ANY policy, so the identity is the
 * placeholder on every event too: a value a resume input carries can be any
 * text (a remote client writes `by` through the hosting door), and the
 * checkpoint a run resumes from can carry any identity. With no policy the
 * record names both, as before. Named in `src/redaction/README.md` ("Who
 * asked and who approved").
 */
import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import { Agent, checkInApproved, defineTool, isPaused } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { locationsOf } from './fixture.js';

const PRINCIPAL = 'alice@example.com';
const TENANT = 'acme-corp';
const APPROVER = 'approver-ops-7';
const IDENTITY = { conversationId: 'conv-1', principal: PRINCIPAL, tenant: TENANT };

/** A run whose model also writes the host's identity into its own words and arguments. */
async function askedRun(redact: RedactionPolicy | undefined) {
  const agent = Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      replies: [
        { toolCalls: [{ id: 'c1', name: 'lookup', args: { q: PRINCIPAL, note: TENANT } }] },
        { content: PRINCIPAL },
      ],
    }),
    model: 'm',
    ...(redact && { redact }),
  })
    .tool(
      defineTool<{ q: string; note: string }, string>({
        name: 'lookup',
        description: 'Look it up.',
        inputSchema: {
          type: 'object',
          properties: { q: { type: 'string' }, note: { type: 'string' } },
        },
        execute: () => 'ok',
      }),
    )
    .build();
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (e) => events.push(e));
  await agent.run({ message: 'go', identity: IDENTITY });
  return events;
}

/** A run paused for a check-in and approved by the host. */
async function approvedRun(redact: RedactionPolicy | undefined) {
  const agent = Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      replies: [
        { toolCalls: [{ id: 't1', name: 'close_account', args: { reason: APPROVER } }] },
        { content: 'closed' },
      ],
    }),
    model: 'm',
    ...(redact && { redact }),
  })
    .tool(
      defineTool<{ reason: string }, string>({
        name: 'close_account',
        description: 'Close the account.',
        inputSchema: { type: 'object', properties: { reason: { type: 'string' } } },
        checkIn: 'always',
        execute: () => 'closed',
      } as never),
    )
    .checkIn({ evidence: 'minimal' })
    .build();
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (e) => events.push(e));
  const outcome = await agent.run({ message: 'close it' });
  if (!isPaused(outcome)) throw new Error('the case must pause for the check-in');
  await agent.resume(outcome.checkpoint, checkInApproved({ by: APPROVER }));
  return events;
}

const POLICIES: readonly [string, RedactionPolicy][] = [
  ['a name-only policy', { keys: ['ssn'] }],
  ['a policy naming the identity', { keys: ['principal', 'tenant', 'by'] }],
];

describe('who asked — the meta', () => {
  it('CONTROL — with no policy every event names who asked', async () => {
    const events = await askedRun(undefined);
    for (const e of events) {
      expect((e.meta as { principal?: unknown }).principal).toBe(PRINCIPAL);
      expect((e.meta as { tenant?: unknown }).tenant).toBe(TENANT);
    }
  });

  for (const [label, policy] of POLICIES) {
    it(`${label}: the placeholder on every event, and in no payload`, async () => {
      const events = await askedRun(policy);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect((e.meta as { principal?: unknown }).principal).toBe('[REDACTED]');
        expect((e.meta as { tenant?: unknown }).tenant).toBe('[REDACTED]');
      }
      expect(locationsOf(events, PRINCIPAL)).toEqual([]);
      expect(locationsOf(events, TENANT)).toEqual([]);
    });
  }
});

describe('who approved — the decision and the resume', () => {
  it('CONTROL — with no policy the decision and the resume name who approved', async () => {
    const events = await approvedRun(undefined);
    const decision = events.find((e) => e.type === 'agentfootprint.checkin.decision');
    expect((decision?.payload as { by?: unknown }).by).toBe(APPROVER);
  });

  for (const [label, policy] of POLICIES) {
    it(`${label}: the placeholder on every event`, async () => {
      const events = await approvedRun(policy);
      const decision = events.find((e) => e.type === 'agentfootprint.checkin.decision');
      expect((decision?.payload as { by?: unknown }).by).toBe('[REDACTED]');
      expect(locationsOf(events, APPROVER)).toEqual([]);
    });
  }
});
