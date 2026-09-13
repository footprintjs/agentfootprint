import { describe, expect, it } from 'vitest';
import { Agent, defineTool, isInputPause, requestInput } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { inProcessHost } from '../../hosting/testHost.js';
import { memorySessions, readPausedRun, standingAgent } from '../../../src/hosting/index.js';
import { defineSkill, pointerOf, skillGraph } from '../../../src/injection-engine.js';
import { allow } from '../../../src/core/agent/middleware/outcomes.js';

function agent() {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'collect-1', name: 'collect_input', args: {} }] },
        { content: 'Ready.' },
      ],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'collect_input',
        description: 'Collect missing query inputs.',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          requestInput({
            id: 'query-window',
            question: 'Year and timezone?',
            fields: [
              { id: 'year', type: 'number', required: true },
              { id: 'timezone', type: 'string', required: true },
            ],
          }),
      }),
    )
    .build();
}

describe('typed input collection', () => {
  it.each(['cancel', 'complete'] as const)(
    '%s releases only that session’s run resources, leaving other pauses and session resources alive',
    async (terminal) => {
      const closed: string[] = [];
      const runner = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'collect-a', name: 'collect', args: {} }] },
            { toolCalls: [{ id: 'collect-b', name: 'collect', args: {} }] },
            ...(terminal === 'complete' ? [{ content: 'Ready A.' }] : []),
            { content: 'Ready B.' },
          ],
        }),
        model: 'mock',
      })
        .tool(
          defineTool({
            name: 'collect',
            description: 'Collect missing input.',
            inputSchema: { type: 'object', properties: {} },
            execute: (_args, ctx) => {
              for (const scope of ['run', 'session'] as const)
                ctx.onTeardown?.(
                  () => {
                    closed.push(`${ctx.sessionId}:${scope}`);
                  },
                  { scope, key: `${ctx.sessionId}:${scope}` },
                );
              return requestInput({
                id: 'input',
                question: 'Year?',
                fields: [{ id: 'year', type: 'number' }],
              });
            },
          }),
        )
        .build();
      const closedSessions: (string | undefined)[] = [];
      runner.on('agentfootprint.tools.session_closed', (event) => {
        closedSessions.push(event.meta.sessionId);
      });
      const sessions = memorySessions();
      const host = inProcessHost();
      const handle = await standingAgent({ agent: runner, sessions, host });
      try {
        const a = await host.deliver({ input: 'Inspect A', sessionId: 'a' });
        const b = await host.deliver({ input: 'Inspect B', sessionId: 'b' });
        expect(closed).toEqual([]);
        const cancelled = await host.deliver({
          input: '',
          sessionId: 'a',
          decision: {
            requestId: a.awaiting!.awaitingInput!.requestId,
            ...(terminal === 'cancel' ? { cancel: true } : { values: { year: 2026 } }),
          },
        });
        expect(cancelled.output).toBe(
          terminal === 'cancel' ? 'Input request cancelled.' : 'Ready A.',
        );
        expect(closed).toEqual(['a:run']);
        expect(closedSessions).toEqual(['a']);
        expect(readPausedRun(await sessions.hydrate('b'))?.pending.awaitingInput?.requestId).toBe(
          b.awaiting!.awaitingInput!.requestId,
        );
        const done = await host.deliver({
          input: '',
          sessionId: 'b',
          decision: {
            requestId: b.awaiting!.awaitingInput!.requestId,
            values: { year: 2026 },
          },
        });
        expect(done.output).toBe('Ready B.');
        expect(closed).toEqual(['a:run', 'b:run']);
        await runner.closeToolSessions({ sessionId: 'a' });
        expect(closed).toEqual(['a:run', 'b:run', 'a:session']);
      } finally {
        await handle.close();
      }
      expect(closed).toEqual(['a:run', 'b:run', 'a:session', 'b:session']);
    },
  );
  it('runs result redaction once after full input, and never calls it on partial updates', async () => {
    let afterCalls = 0;
    const runner = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'collect', name: 'collect', args: {} }] },
          { content: 'Ready.' },
        ],
      }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'collect',
          description: 'Collect inputs.',
          inputSchema: { type: 'object', properties: {} },
          execute: () =>
            requestInput({
              id: 'collect',
              question: 'Name and region?',
              fields: [
                { id: 'name', type: 'string' },
                { id: 'region', type: 'string' },
              ],
            }),
        }),
      )
      .act({
        afterTool: [
          {
            name: 'redact-name',
            onToolResult: (call) => {
              afterCalls++;
              return allow(
                JSON.stringify(call.result).replaceAll('PRIVATE-NAME', '[redacted]'),
                'masked input',
              );
            },
          },
        ],
      })
      .build();
    const first = await runner.run({ message: 'Inspect the request.' });
    if (!isInputPause(first)) throw new Error('expected input');
    const partial = await runner.resume(first.checkpoint, {
      requestId: first.awaitingInput.requestId,
      values: { name: 'PRIVATE-NAME' },
    });
    if (!isInputPause(partial)) throw new Error('expected partial');
    expect(afterCalls).toBe(0);
    await runner.resume(partial.checkpoint, {
      requestId: partial.awaitingInput.requestId,
      values: { region: 'east' },
    });
    expect(afterCalls).toBe(1);
    const history = JSON.stringify(runner.checkpoint()!.history);
    expect(history).not.toContain('PRIVATE-NAME');
    expect(history).toContain('[redacted]');
  });
  it.each(['dynamic', 'dynamic-grouped'] as const)(
    'retains the selected skill and step across a new process (%s)',
    async (reactMode) => {
      let collected = 0;
      let queried = 0;
      const skill = () =>
        defineSkill({
          id: 'investigate',
          description: 'Investigate data.',
          body: 'Collect inputs then query.',
          tools: [
            defineTool({
              name: 'collect',
              description: 'Collect missing fields.',
              inputSchema: { type: 'object', properties: {} },
              execute: () => {
                collected++;
                return requestInput({
                  id: 'window',
                  question: 'Year and timezone?',
                  fields: [
                    { id: 'year', type: 'number' },
                    { id: 'zone', type: 'string' },
                  ],
                });
              },
            }),
            defineTool({
              name: 'query',
              description: 'Query data.',
              inputSchema: { type: 'object', properties: {} },
              execute: () => {
                queried++;
                return 'rows';
              },
            }),
          ],
          steps: [
            { tool: 'collect', note: 'Collect fields' },
            { tool: 'query', note: 'Run the query' },
          ],
        });
      const first = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'skill', name: 'read_skill', args: { id: 'investigate' } }] },
            { toolCalls: [{ id: 'input', name: 'collect', args: {} }] },
          ],
        }),
        model: 'mock',
        reactMode,
      })
        .skillGraph(skillGraph().entry(skill()).build())
        .build();
      const paused = await first.run({ message: 'Investigate the data.' });
      if (!isInputPause(paused)) throw new Error('expected pause');
      expect(paused.awaitingInput.origin.skillId).toBe('investigate');
      const restored = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'query', name: 'query', args: {} }] },
            { content: 'Done.' },
          ],
        }),
        model: 'mock',
        reactMode,
      })
        .skillGraph(skillGraph().entry(skill()).build())
        .build();
      const partial = await restored.resume(JSON.parse(JSON.stringify(paused.checkpoint)), {
        requestId: paused.awaitingInput.requestId,
        values: { year: 2026 },
      });
      if (!isInputPause(partial)) throw new Error('expected partial pause');
      expect(collected).toBe(1);
      expect(queried).toBe(0);
      expect(
        await restored.resume(partial.checkpoint, {
          requestId: partial.awaitingInput.requestId,
          values: { zone: 'UTC' },
        }),
      ).toBe('Done.');
      expect(collected).toBe(1);
      expect(queried).toBe(1);
      const state = restored.getLastSnapshot()!.sharedState as {
        currentSkillId?: string;
        stepPointer?: unknown;
      };
      expect(state.currentSkillId).toBe('investigate');
      expect(pointerOf(state.stepPointer)).toMatchObject({ step: 3 });
    },
  );
  it('carries the real request, accepts partial values without a model call, and completes after JSON restoration', async () => {
    const runner = agent();
    const first = await runner.run({ message: 'Inspect this query window.' });
    expect(isInputPause(first)).toBe(true);
    if (!isInputPause(first)) throw new Error('expected input pause');
    expect(first.awaitingInput.status).toBe('awaiting_input');
    expect(first.awaitingInput.origin.originalRequest).toBe('Inspect this query window.');
    expect(first.checkIn).toBeUndefined();
    expect(first.ask).toBeUndefined();
    const second = await runner.resume(JSON.parse(JSON.stringify(first.checkpoint)), {
      requestId: first.awaitingInput.requestId,
      values: { year: 2026 },
    });
    expect(isInputPause(second)).toBe(true);
    if (!isInputPause(second)) throw new Error('expected partial input pause');
    expect(second.awaitingInput.missing).toEqual(['timezone']);
    expect(second.awaitingInput.supplied).toEqual({ year: 2026 });
    // Supply a provider which only answers: the first tool must never execute again.
    const finalRunner = Agent.create({ provider: mock({ reply: 'Ready.' }), model: 'mock' })
      .tool(
        defineTool({
          name: 'collect_input',
          description: 'Collect missing query inputs.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => {
            throw new Error('must not replay');
          },
        }),
      )
      .build();
    expect(
      await finalRunner.resume(JSON.parse(JSON.stringify(second.checkpoint)), {
        requestId: second.awaitingInput.requestId,
        values: { timezone: 'UTC' },
      }),
    ).toBe('Ready.');
    const history = finalRunner.checkpoint()!.history;
    const result = history.find((m) => m.role === 'tool' && m.toolCallId === 'collect-1');
    expect(JSON.parse(result!.content!)).toMatchObject({
      status: 'input_received',
      values: { year: 2026, timezone: 'UTC' },
    });
    expect(history.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'Inspect this query window.',
    ]);
  });

  it.each([
    { requestId: 'stale', values: { year: 2026 } },
    { values: { year: '2026' } },
    { values: { unknown: 'value' } },
  ])('refuses malformed input without consuming the checkpoint: %j', async (reply) => {
    const runner = agent();
    const first = await runner.run({ message: 'Inspect this query window.' });
    if (!isInputPause(first)) throw new Error('expected input pause');
    await expect(
      runner.resume(first.checkpoint, { requestId: first.awaitingInput.requestId, ...reply }),
    ).rejects.toThrow();
    expect(
      await runner.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { year: 2026, timezone: 'UTC' },
      }),
    ).toBe('Ready.');
  });

  it('uses the existing hosted response transport and persists partial input', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: agent(), sessions, host });
    try {
      const first = await host.deliver({
        input: 'Inspect this query window.',
        sessionId: 'input-session',
      });
      expect(first.awaiting?.awaitingInput?.status).toBe('awaiting_input');
      const requestId = first.awaiting!.awaitingInput!.requestId;
      const partial = await host.deliver({
        input: '',
        sessionId: 'input-session',
        decision: { requestId, values: { year: 2026 } },
      });
      expect(partial.awaiting?.awaitingInput?.missing).toEqual(['timezone']);
      expect(
        readPausedRun((await sessions.hydrate('input-session'))!).pending.awaitingInput?.supplied,
      ).toEqual({ year: 2026 });
      const done = await host.deliver({
        input: '',
        sessionId: 'input-session',
        decision: { requestId, values: { timezone: 'UTC' } },
      });
      expect(done.output).toBe('Ready.');
    } finally {
      await handle.close();
    }
  });

  it('cancels only the named input request, retaining history without a model or query call', async () => {
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: agent(), sessions, host });
    try {
      const first = await host.deliver({
        input: 'Inspect this query window.',
        sessionId: 'cancel-session',
      });
      const requestId = first.awaiting!.awaitingInput!.requestId;
      const stale = await host.deliver({
        input: '',
        sessionId: 'cancel-session',
        decision: { requestId: 'stale', cancel: true },
      });
      expect(stale.error).toBeDefined();
      const cancelled = await host.deliver({
        input: '',
        sessionId: 'cancel-session',
        decision: { requestId, cancel: true },
      });
      expect(cancelled.output).toBe('Input request cancelled.');
      const saved = await sessions.hydrate('cancel-session');
      expect(saved?.format).toBe('conversation-v1');
      if (saved?.format !== 'conversation-v1') throw new Error('expected saved conversation');
      expect(
        saved.data.history.some(
          (m) => m.role === 'tool' && JSON.parse(m.content!).status === 'input_cancelled',
        ),
      ).toBe(true);
      expect(saved.data.history.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
        'Inspect this query window.',
      ]);
    } finally {
      await handle.close();
    }
  });
  it('settles the current batch when a provider reuses an older tool-call id', async () => {
    const runner = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'same-call-id', name: 'lookup', args: {} }] },
          { content: 'First answer.' },
          { toolCalls: [{ id: 'same-call-id', name: 'collect', args: {} }] },
        ],
      }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'lookup',
          description: 'Lookup.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => 'rows',
        }),
      )
      .tool(
        defineTool({
          name: 'collect',
          description: 'Collect.',
          inputSchema: { type: 'object', properties: {} },
          execute: () =>
            requestInput({
              id: 'input',
              question: 'Year?',
              fields: [{ id: 'year', type: 'number' }],
            }),
        }),
      )
      .build();
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: runner, sessions, host });
    try {
      await host.deliver({ input: 'First request.', sessionId: 'reused' });
      const asked = await host.deliver({ input: 'Second request.', sessionId: 'reused' });
      await host.deliver({
        input: '',
        sessionId: 'reused',
        decision: { requestId: asked.awaiting!.awaitingInput!.requestId, cancel: true },
      });
      const saved = await sessions.hydrate('reused');
      if (saved?.format !== 'conversation-v1') throw new Error('expected conversation');
      expect(saved.data.history.filter((m) => m.role === 'tool').map((m) => m.toolName)).toEqual([
        'lookup',
        'collect',
      ]);
    } finally {
      await handle.close();
    }
  });
});
