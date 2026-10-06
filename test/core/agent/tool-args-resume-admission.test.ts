import { describe, expect, it, vi } from 'vitest';

import { Agent, allow, ask, checkInApproved, defineTool, isPaused } from '../../../src/index.js';
import { mock } from '../../../src/providers.js';
import { bearer } from '../../../src/identity.js';
import type { CredentialProvider } from '../../../src/identity.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';

const CALL_ID = 'paused-argument-call';
const VALID = { text: 'requested item' };
const EXTRA = { ...VALID, unrecognizedFilter: 'silently ignored before admission' };

function setup(
  options: {
    mode?: 'enforce' | 'warn' | 'off';
    open?: boolean;
    transform?: boolean;
    args?: Record<string, unknown>;
  } = {},
) {
  const execute = vi.fn((_args: Record<string, unknown>) => 'tool ran');
  const getCredential = vi.fn(async () => ({
    status: 'issued' as const,
    credential: bearer('synthetic-test-credential'),
  }));
  const credentials: CredentialProvider = { id: 'test-vault', getCredential };
  const after = vi.fn(() => allow());
  const events: AgentfootprintEvent[] = [];
  const results: string[] = [];
  const agent = Agent.create({
    provider: mock({
      respond: (request) => {
        const result = request.messages.find((message) => message.role === 'tool');
        if (result) {
          results.push(String(result.content));
          return { content: 'done' };
        }
        return { toolCalls: [{ id: CALL_ID, name: 'lookup', args: options.args ?? VALID }] };
      },
    }),
    model: 'mock',
    credentials,
    ...(options.mode !== undefined && { toolArgValidation: options.mode }),
  })
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Read a requested item',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          ...(options.open ? {} : { additionalProperties: false }),
        },
        needs: { credential: 'items' },
        execute,
      }),
    )
    .toolMiddleware({ name: 'review', onToolCall: () => ask({ question: 'Approve this call?' }) })
    .toolMiddleware({
      name: 'remaining-link',
      onToolCall: () =>
        options.transform ? allow(EXTRA, 'Exercise a changed resumed call') : allow(),
      onToolResult: after,
    })
    .build();
  agent.on('*', (event) => events.push(event));
  return { agent, execute, getCredential, after, events, results };
}

describe.each(['same', 'fresh'] as const)(
  'argument admission on %s-agent middleware resume',
  (kind) => {
    it.each(['proposed', 'transformed'] as const)(
      'rejects %s extra arguments before credentials or execute, with a model-visible result',
      async (origin) => {
        const options = origin === 'proposed' ? { args: EXTRA } : { transform: true };
        const initial = setup(options);
        const paused = await initial.agent.run('Read an item');
        if (!isPaused(paused)) throw new Error('Expected a real middleware pause');
        expect(initial.execute).not.toHaveBeenCalled();
        expect(initial.getCredential).not.toHaveBeenCalled();
        const resumed = kind === 'same' ? initial : setup(options);
        const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
        await expect(
          resumed.agent.resume(checkpoint, checkInApproved({ by: 'reviewer' })),
        ).resolves.toBe('done');

        expect(resumed.execute).not.toHaveBeenCalled();
        expect(resumed.getCredential).not.toHaveBeenCalled();
        expect(resumed.after).not.toHaveBeenCalled();
        expect(resumed.results).toHaveLength(1);
        expect(resumed.results[0]).toContain("Invalid arguments for tool 'lookup'");
        expect(resumed.results[0]).toContain('unrecognizedFilter');
        expect(
          resumed.events.filter((event) => event.type === 'agentfootprint.validation.args_invalid'),
        ).toMatchObject([
          { payload: { toolName: 'lookup', toolCallId: CALL_ID, iteration: 1, enforced: true } },
        ]);
        expect(
          resumed.events.some((event) => event.type === 'agentfootprint.credential.requested'),
        ).toBe(false);
      },
    );
  },
);

describe('resumed admission preserves declared openness and validation modes', () => {
  it.each([
    { label: 'open schema', open: true, mode: undefined, invalidEvents: 0 },
    { label: 'warn', open: false, mode: 'warn' as const, invalidEvents: 1 },
    { label: 'off', open: false, mode: 'off' as const, invalidEvents: 0 },
  ])('$label passes the complete arguments to execute', async ({ open, mode, invalidEvents }) => {
    const state = setup({ open, ...(mode !== undefined && { mode }), transform: true });
    const paused = await state.agent.run('Read an item');
    if (!isPaused(paused)) throw new Error('Expected a real middleware pause');
    await state.agent.resume(paused.checkpoint, checkInApproved({ by: 'reviewer' }));
    expect(state.execute).toHaveBeenCalledOnce();
    expect(state.execute.mock.calls[0]?.[0]).toEqual(EXTRA);
    expect(state.getCredential).toHaveBeenCalledOnce();
    expect(state.after).toHaveBeenCalledOnce();
    const invalid = state.events.filter(
      (event) => event.type === 'agentfootprint.validation.args_invalid',
    );
    expect(invalid).toHaveLength(invalidEvents);
    if (invalidEvents)
      expect(invalid[0]?.payload).toMatchObject({ enforced: false, toolCallId: CALL_ID });
  });
});
