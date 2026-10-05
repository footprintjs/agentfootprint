/**
 * Security events identify the dispatched call across a pause, not whichever
 * same-name call happens to run next. Public Agent run/resume paths exercise
 * both the checkpoint carrier and the per-execute pull-provider decorator.
 * These are correlation assertions, not new permission or credential policy.
 */
import { describe, expect, it } from 'vitest';
import { Agent, checkInApproved, defineTool, isPaused } from '../../src/index.js';
import { mock } from '../../src/providers.js';
import { bearer, CredentialConsentRequiredError } from '../../src/identity.js';
import type { CredentialProvider, CredentialResult } from '../../src/identity.js';
import type { PermissionChecker } from '../../src/adapters/types.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { PolicyHaltError } from '../../src/security/index.js';

type VaultMode = 'consent' | 'issued' | 'failed';
const FIRST = 'invoice-call-before-pause';
const SECOND = 'invoice-call-after-resume';
const TOKEN = 'synthetic-test-token-not-for-a-real-service';
const URL = 'https://consent.example.test/authorize?state=synthetic-secret';

const allow: PermissionChecker = {
  name: 'allow-tools',
  check: async () => ({ result: 'allow' }),
};

function vault(state: { mode: VaultMode }): CredentialProvider {
  return {
    id: 'test-consent-vault',
    async getCredential(): Promise<CredentialResult> {
      if (state.mode === 'failed') throw new Error('test vault unavailable');
      return state.mode === 'issued'
        ? { status: 'issued', credential: bearer(TOKEN) }
        : { status: 'authorization-required', authorizationUrl: URL, sessionId: 'consent-id' };
    },
  };
}

function collect(agent: Agent): AgentfootprintEvent[] {
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (event) => {
    if (
      event.type.startsWith('agentfootprint.permission.') ||
      event.type.startsWith('agentfootprint.credential.')
    ) {
      events.push(event);
    }
  });
  return events;
}

function makeAgent(
  credentials: CredentialProvider,
  options: { nextCall?: boolean; pull?: boolean; checker?: PermissionChecker } = {},
) {
  const executed: string[] = [];
  const tool = defineTool({
    name: 'pay_invoice',
    description: 'Pay the selected invoice',
    inputSchema: { type: 'object', properties: {} },
    ...(options.pull ? { checkIn: 'always' as const } : { needs: { credential: 'billing' } }),
    execute: async (_args, ctx) => {
      executed.push(ctx.toolCallId);
      if (options.pull) await ctx.credentials.getCredential({ service: 'billing' });
      return 'invoice paid';
    },
  });
  const agent = Agent.create({
    provider: mock({
      respond: (request) => {
        const results = request.messages.filter((message) => message.role === 'tool').length;
        if (results === 0 || (results === 1 && options.nextCall)) {
          return {
            content: 'Processing invoice',
            toolCalls: [{ id: results === 0 ? FIRST : SECOND, name: 'pay_invoice', args: {} }],
          };
        }
        return { content: 'done', toolCalls: [] };
      },
    }),
    model: 'mock',
    credentials,
    permissionChecker: options.checker ?? allow,
    maxIterations: 4,
  })
    .tool(tool)
    .build();
  return { agent, events: collect(agent), executed };
}

function payloads(events: readonly AgentfootprintEvent[], type: AgentfootprintEvent['type']) {
  return events.filter((event) => event.type === type).map((event) => event.payload);
}

describe.each(['same', 'fresh'] as const)('security correlation on %s-agent resume', (kind) => {
  it('keeps the original consent call and the later same-name call distinct', async () => {
    const state = { mode: 'consent' as VaultMode };
    const initial = makeAgent(vault(state), { nextCall: true });
    const paused = await initial.agent.run({ message: 'Pay two invoices' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) throw new Error('Expected real credential-consent pause');
    const before = [...initial.events];
    state.mode = 'issued';
    const resumed = kind === 'same' ? initial : makeAgent(vault(state), { nextCall: true });
    resumed.events.length = 0;
    await expect(resumed.agent.resume(paused.checkpoint, undefined)).resolves.toBe('done');
    expect(resumed.executed).toEqual([FIRST, SECOND]);
    expect(payloads(before, 'agentfootprint.permission.check')).toEqual([
      expect.objectContaining({ toolCallId: FIRST, iteration: 1, result: 'allow' }),
    ]);
    for (const type of [
      'agentfootprint.credential.requested',
      'agentfootprint.credential.authorization_required',
    ] as const) {
      expect(payloads(before, type)).toEqual([
        expect.objectContaining({ toolCallId: FIRST, iteration: 1 }),
      ]);
    }
    for (const type of [
      'agentfootprint.credential.requested',
      'agentfootprint.credential.acquired',
    ] as const) {
      expect(payloads(resumed.events, type)).toEqual([
        expect.objectContaining({ toolCallId: FIRST, iteration: 1 }),
        expect.objectContaining({ toolCallId: SECOND, iteration: 2 }),
      ]);
    }
    expect(payloads(resumed.events, 'agentfootprint.permission.check')).toEqual([
      expect.objectContaining({ toolCallId: SECOND, iteration: 2 }),
    ]);
    expect(JSON.stringify([...before, ...resumed.events])).not.toContain(TOKEN);
    expect(JSON.stringify([...before, ...resumed.events])).not.toContain(URL);
  });

  it.each(['consent', 'failed'] as const)(
    'attributes a %s credential on resume to the paused call',
    async (mode) => {
      const state = { mode: 'consent' as VaultMode };
      const initial = makeAgent(vault(state));
      const paused = await initial.agent.run({ message: 'Pay invoice' });
      if (!isPaused(paused)) throw new Error('Expected real credential-consent pause');
      state.mode = mode;
      const resumed = kind === 'same' ? initial : makeAgent(vault(state));
      resumed.events.length = 0;
      if (mode === 'consent') {
        await expect(resumed.agent.resume(paused.checkpoint, undefined)).rejects.toBeInstanceOf(
          CredentialConsentRequiredError,
        );
      } else {
        await expect(resumed.agent.resume(paused.checkpoint, undefined)).resolves.toBe('done');
      }
      expect(resumed.executed).toEqual([]);
      expect(payloads(resumed.events, 'agentfootprint.credential.requested')).toEqual([
        expect.objectContaining({ toolCallId: FIRST, iteration: 1 }),
      ]);
      const type =
        mode === 'consent'
          ? 'agentfootprint.credential.authorization_required'
          : 'agentfootprint.credential.failed';
      expect(payloads(resumed.events, type)).toEqual([
        expect.objectContaining({ toolCallId: FIRST, iteration: 1 }),
      ]);
    },
  );

  it('correlates a pull-provider failure after a real approved check-in', async () => {
    const state = { mode: 'failed' as VaultMode };
    const initial = makeAgent(vault(state), { pull: true });
    const paused = await initial.agent.run({ message: 'Pay invoice after approval' });
    if (!isPaused(paused)) throw new Error('Expected real check-in pause');
    const resumed = kind === 'same' ? initial : makeAgent(vault(state), { pull: true });
    resumed.events.length = 0;
    await expect(
      resumed.agent.resume(paused.checkpoint, checkInApproved({ by: 'reviewer' })),
    ).resolves.toBe('done');
    expect(resumed.executed).toEqual([FIRST]);
    expect(payloads(resumed.events, 'agentfootprint.credential.failed')).toEqual([
      expect.objectContaining({ toolCallId: FIRST, iteration: 1, tool: 'pay_invoice' }),
    ]);
    // The pull decorator reports failure only; correlation must not invent
    // requested/acquired events that the pull path never emitted.
    expect(payloads(resumed.events, 'agentfootprint.credential.requested')).toEqual([]);
    expect(payloads(resumed.events, 'agentfootprint.credential.acquired')).toEqual([]);
  });

  it('attributes a later permission halt to the new call, not the resumed one', async () => {
    const state = { mode: 'consent' as VaultMode };
    let halted = false;
    const checker: PermissionChecker = {
      name: 'halt-later',
      check: async () =>
        halted ? { result: 'halt', reason: 'review-required' } : { result: 'allow' },
    };
    const initial = makeAgent(vault(state), { nextCall: true, checker });
    const paused = await initial.agent.run({ message: 'Pay invoices' });
    if (!isPaused(paused)) throw new Error('Expected real credential-consent pause');
    state.mode = 'issued';
    halted = true;
    const resumed =
      kind === 'same' ? initial : makeAgent(vault(state), { nextCall: true, checker });
    resumed.events.length = 0;
    await expect(resumed.agent.resume(paused.checkpoint, undefined)).rejects.toBeInstanceOf(
      PolicyHaltError,
    );
    expect(resumed.executed).toEqual([FIRST]);
    expect(payloads(resumed.events, 'agentfootprint.permission.check')).toEqual([
      expect.objectContaining({ toolCallId: SECOND, iteration: 2, result: 'halt' }),
    ]);
    expect(payloads(resumed.events, 'agentfootprint.permission.halt')).toEqual([
      expect.objectContaining({ toolCallId: SECOND, iteration: 2 }),
    ]);
  });
});

it('retained pull handles keep their own caller instead of reading the active call', async () => {
  const credentials = vault({ mode: 'failed' });
  let retained: CredentialProvider | undefined;
  const calls: string[] = [];
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [
            { id: 'earlier', name: 'pull', args: {} },
            { id: 'current', name: 'pull', args: {} },
          ],
        },
        { content: 'done' },
      ],
    }),
    model: 'mock',
    credentials,
  })
    .tool(
      defineTool({
        name: 'pull',
        description: 'Exercise per-call credential handles',
        execute: async (_args, ctx) => {
          calls.push(ctx.toolCallId);
          if (!retained) retained = ctx.credentials;
          else {
            await retained.getCredential({ service: 'billing' }).catch(() => undefined);
            await ctx.credentials.getCredential({ service: 'billing' }).catch(() => undefined);
          }
          return 'finished';
        },
      }),
    )
    .build();
  const events = collect(agent);
  await expect(agent.run({ message: 'Check the two handles' })).resolves.toBe('done');
  expect(calls).toEqual(['earlier', 'current']);
  expect(payloads(events, 'agentfootprint.credential.failed')).toEqual([
    expect.objectContaining({ toolCallId: 'earlier', iteration: 1 }),
    expect.objectContaining({ toolCallId: 'current', iteration: 1 }),
  ]);
  expect(credentials).not.toHaveProperty('toolCallId');
  expect(credentials).not.toHaveProperty('iteration');
});
