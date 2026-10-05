import { describe, expect, it } from 'vitest';
import { Agent, defineTool, isPaused, type Tool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { defineSkill } from '../../src/doors/context.js';
import {
  bearer,
  PolicyHaltError,
  type CredentialProvider,
  type PermissionChecker,
  type PermissionDecision,
} from '../../src/doors/security.js';

interface Fact {
  type: string;
  payload: Record<string, unknown>;
  stage: string;
}

function observe(agent: Agent) {
  const facts: Fact[] = [];
  agent.on('*', (event) => {
    if (
      event.type.startsWith('agentfootprint.permission.') ||
      event.type.startsWith('agentfootprint.credential.') ||
      event.type === 'agentfootprint.stream.tool_start'
    ) {
      facts.push({
        type: event.type,
        payload: { ...event.payload },
        stage: event.meta.runtimeStageId,
      });
    }
  });
  return {
    facts,
    of: (suffix: string) => facts.filter((fact) => fact.type === `agentfootprint.${suffix}`),
  };
}

const issued: CredentialProvider = {
  id: 'synthetic-vault',
  getCredential: async () => ({ status: 'issued', credential: bearer('synthetic-token-canary') }),
};

function checker(answer: () => PermissionDecision): PermissionChecker {
  return { name: 'synthetic-checker', check: answer };
}

function readTool(options: { needs?: boolean; capabilities?: boolean; pull?: boolean } = {}): Tool {
  return defineTool({
    name: 'read_same',
    description: 'Read a synthetic value.',
    inputSchema: { type: 'object', properties: {} },
    ...(options.needs && { needs: { credential: 'synthetic-service' } }),
    ...(options.capabilities && { capabilities: ['external_net', 'user_data'] as const }),
    execute: async (_args, context) => {
      if (options.pull) await context.credentials.getCredential({ service: 'synthetic-service' });
      return 'synthetic result';
    },
  });
}

function build(options: {
  tool?: Tool;
  permissionChecker?: PermissionChecker;
  credentials?: CredentialProvider;
  reactMode?: 'classic' | 'dynamic' | 'dynamic-grouped';
  observerDelivery?: 'inline' | 'deferred';
  repeat?: boolean;
}) {
  const calls = [
    { id: 'call-one', name: 'read_same', args: {} },
    { id: 'call-two', name: 'read_same', args: {} },
  ];
  return Agent.create({
    provider: mock({
      replies: options.repeat
        ? [{ toolCalls: [calls[0]] }, { toolCalls: [calls[0]] }, { content: 'done' }]
        : [{ toolCalls: calls }, { content: 'done' }],
    }),
    model: 'mock',
    ...(options.permissionChecker && { permissionChecker: options.permissionChecker }),
    ...(options.credentials && { credentials: options.credentials }),
    ...(options.reactMode && { reactMode: options.reactMode }),
    ...(options.observerDelivery && { observerDelivery: options.observerDelivery }),
  })
    .tool(options.tool ?? readTool())
    .build();
}

const firstBatch = [
  { toolCallId: 'call-one', iteration: 1 },
  { toolCallId: 'call-two', iteration: 1 },
];

function expectCalls(facts: readonly Fact[], expected = firstBatch) {
  expect(
    facts.map(({ payload }) => ({ toolCallId: payload.toolCallId, iteration: payload.iteration })),
  ).toEqual(expected);
}

describe('runtime tool security facts carry the actual call identity', () => {
  for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    for (const observerDelivery of ['inline', 'deferred'] as const) {
      it(`distinguishes two same-name calls in one batch (${reactMode}, ${observerDelivery})`, async () => {
        const agent = build({
          tool: readTool({ needs: true }),
          permissionChecker: checker(() => ({ result: 'allow' })),
          credentials: issued,
          reactMode,
          observerDelivery,
        });
        const seen = observe(agent);
        expect(await agent.run('read twice')).toBe('done');
        const starts = seen.of('stream.tool_start');
        expect(starts.map(({ payload }) => payload.toolCallId)).toEqual(['call-one', 'call-two']);
        expect(starts.map(({ payload }) => payload.parallelCount)).toEqual([2, 2]);
        // These are a provider batch, not concurrent tool executions. Stage alone cannot join them.
        expect(new Set(starts.map(({ stage }) => stage)).size).toBe(1);
        expectCalls(seen.of('permission.check'));
        expectCalls(seen.of('credential.requested'));
        expectCalls(seen.of('credential.acquired'));
        expect(JSON.stringify(seen.facts)).not.toContain('synthetic-token-canary');
      });
    }
  }

  for (const verdict of ['deny', 'throw', 'gate_open'] as const) {
    it(`correlates a tool-call permission ${verdict} without inventing a gate lifecycle`, async () => {
      const agent = build({
        permissionChecker: checker(() => {
          if (verdict === 'throw') throw new Error('synthetic checker failure');
          return { result: verdict };
        }),
      });
      const seen = observe(agent);
      await agent.run('read twice');
      expectCalls(seen.of('permission.check'));
      expect(seen.of('permission.check').map(({ payload }) => payload.result)).toEqual([
        verdict === 'throw' ? 'deny' : verdict,
        verdict === 'throw' ? 'deny' : verdict,
      ]);
      expect(seen.of('permission.gate_opened')).toEqual([]);
      expect(seen.of('permission.gate_closed')).toEqual([]);
    });
  }

  for (const verdict of ['allow', 'deny', 'throw'] as const) {
    it(`correlates declared-capability ${verdict} separately from tool-call permission`, async () => {
      const agent = build({
        tool: readTool({ capabilities: true }),
        permissionChecker: {
          name: 'capability-checker',
          governs: ['external_net', 'user_data'],
          check(request) {
            if (request.capability !== 'external_net') return { result: 'allow' };
            if (verdict === 'throw') throw new Error('synthetic capability failure');
            return { result: verdict };
          },
        },
      });
      const seen = observe(agent);
      await agent.run('read twice');
      const checks = seen.of('permission.check');
      expectCalls(checks.filter(({ payload }) => payload.capability === 'tool_call'));
      expectCalls(checks.filter(({ payload }) => payload.capability === 'external_net'));
      expect(checks.filter(({ payload }) => payload.capability === 'user_data')).toHaveLength(
        verdict === 'allow' ? 2 : 0,
      );
    });
  }

  for (const result of ['allow', 'deny'] as const) {
    it(`correlates skill-read dispatch ${result} without claiming visibility checks were emitted`, async () => {
      const agent = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'skill-call', name: 'read_skill', args: { id: 'lookup' } }] },
            { content: 'done' },
          ],
        }),
        model: 'mock',
        permissionChecker: {
          name: 'skill-checker',
          governs: ['skill_read'],
          check: (request) => ({
            result:
              request.capability === 'skill_read' && request.iteration !== undefined
                ? result
                : 'allow',
          }),
        },
      })
        .skill(
          defineSkill({
            id: 'lookup',
            description: 'Synthetic lookup',
            body: 'Lookup instructions',
          }),
        )
        .build();
      const seen = observe(agent);
      await agent.run('read the skill');
      const rows = seen
        .of('permission.check')
        .filter(({ payload }) => payload.capability === 'skill_read');
      expectCalls(rows, [{ toolCallId: 'skill-call', iteration: 1 }]);
      expect(rows[0].payload).toMatchObject({ target: 'skill:lookup', result });
    });
  }

  it('correlates a terminal halt to its check and does not dispatch a sibling', async () => {
    const agent = build({
      permissionChecker: checker(() => ({ result: 'halt', reason: 'test-stop' })),
    });
    const seen = observe(agent);
    await expect(agent.run('read twice')).rejects.toBeInstanceOf(PolicyHaltError);
    expectCalls(seen.of('permission.check'), [firstBatch[0]]);
    expectCalls(seen.of('permission.halt'), [firstBatch[0]]);
    expect(seen.of('stream.tool_start')).toHaveLength(1);
  });

  for (const pull of [false, true]) {
    it(`correlates credential failure on the ${
      pull ? 'pull' : 'declared-needs'
    } path`, async () => {
      const agent = build({
        tool: readTool({ needs: !pull, pull }),
        credentials: {
          id: 'failing-vault',
          getCredential: async () => {
            throw new Error('synthetic vault failure');
          },
        },
      });
      const seen = observe(agent);
      await agent.run('read twice');
      expectCalls(seen.of('credential.failed'));
      expect(seen.of('credential.failed').map(({ payload }) => payload.tool)).toEqual([
        'read_same',
        'read_same',
      ]);
      // The pull decorator reports failure only; correlation must not fabricate other facts.
      expect(seen.of('credential.requested')).toHaveLength(pull ? 0 : 2);
      expect(seen.of('credential.acquired')).toHaveLength(0);
    });
  }

  it('correlates authorization-required to the call that paused without retaining its URL', async () => {
    const agent = build({
      tool: readTool({ needs: true }),
      credentials: {
        id: 'consent-vault',
        getCredential: async () => ({
          status: 'authorization-required',
          authorizationUrl: 'https://synthetic.invalid/consent?secret=canary',
          sessionId: 'consent-session',
        }),
      },
    });
    const seen = observe(agent);
    expect(isPaused(await agent.run('read twice'))).toBe(true);
    expectCalls(seen.of('credential.requested'), [firstBatch[0]]);
    expectCalls(seen.of('credential.authorization_required'), [firstBatch[0]]);
    expect(JSON.stringify(seen.facts)).not.toContain('synthetic.invalid');
    expect(seen.of('credential.acquired')).toEqual([]);
  });

  it('keeps iteration alongside a provider call ID reused on the next iteration', async () => {
    const agent = build({
      repeat: true,
      tool: readTool({ needs: true }),
      credentials: issued,
      permissionChecker: checker(() => ({ result: 'allow' })),
    });
    const seen = observe(agent);
    await agent.run('read again');
    const expected = [
      { toolCallId: 'call-one', iteration: 1 },
      { toolCallId: 'call-one', iteration: 2 },
    ];
    for (const suffix of ['permission.check', 'credential.requested', 'credential.acquired']) {
      expectCalls(seen.of(suffix), expected);
    }
  });

  for (const observerDelivery of ['inline', 'deferred'] as const) {
    it(`keeps a nested credential failure on its derived inner call (${observerDelivery})`, async () => {
      const entered: { toolCallId: string; iteration: number }[] = [];
      const inner = defineTool({
        name: 'inner_read',
        description: 'Pull a synthetic credential inside a nested call.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (_args, context) => {
          entered.push({ toolCallId: context.toolCallId, iteration: context.iteration });
          await context.credentials.getCredential({ service: 'nested-service' });
          return 'unreachable';
        },
      });
      const outer = defineTool({
        name: 'read_same',
        description: 'Invoke the nested read.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (_args, context) => {
          if (context.tools === undefined) throw new Error('nested dispatch is unavailable');
          return await context.tools.call('inner_read', {});
        },
      });
      const agent = Agent.create({
        provider: mock({
          replies: [
            {
              toolCalls: [
                { id: 'outer-one', name: 'read_same', args: {} },
                { id: 'outer-two', name: 'read_same', args: {} },
              ],
            },
            { content: 'done' },
          ],
        }),
        model: 'mock',
        observerDelivery,
        permissionChecker: checker(() => ({ result: 'allow' })),
        credentials: {
          id: 'nested-vault',
          getCredential: async () => {
            throw new Error('synthetic nested failure');
          },
        },
      })
        .tools([inner, outer])
        .build();
      const seen = observe(agent);
      await agent.run('read through nested calls');
      const expected = [
        { toolCallId: 'outer-one#inner-1', iteration: 1 },
        { toolCallId: 'outer-two#inner-1', iteration: 1 },
      ];
      expect(entered).toEqual(expected);
      expectCalls(seen.of('credential.failed'), expected);
      expect(seen.of('credential.failed').map(({ payload }) => payload.tool)).toEqual([
        'inner_read',
        'inner_read',
      ]);
      // Nested calls do not invent ordinary model-call brackets or permission consultations.
      expect(seen.of('stream.tool_start').map(({ payload }) => payload.toolCallId)).toEqual([
        'outer-one',
        'outer-two',
      ]);
      expectCalls(seen.of('permission.check'), [
        { toolCallId: 'outer-one', iteration: 1 },
        { toolCallId: 'outer-two', iteration: 1 },
      ]);
    });
  }

  it('does not invent security facts when neither service is configured', async () => {
    const agent = build({});
    const seen = observe(agent);
    await agent.run('read twice');
    expect(seen.facts.filter(({ type }) => !type.endsWith('tool_start'))).toEqual([]);
  });

  it('leaves consumer events without a known tool call uncorrelated', () => {
    const agent = build({});
    const seen = observe(agent);
    agent.emit('agentfootprint.permission.check', {
      capability: 'tool_call',
      actor: 'app',
      result: 'allow',
    });
    agent.emit('agentfootprint.credential.failed', {
      service: 'manual',
      reason: 'synthetic failure',
    });
    expect(seen.facts).toHaveLength(2);
    for (const { payload } of seen.facts) {
      expect(payload).not.toHaveProperty('toolCallId');
      expect(payload).not.toHaveProperty('iteration');
    }
  });
});
