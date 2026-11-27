import { expect, it, vi } from 'vitest';
import { Agent, ask, checkInApproved, defineTool, isAskPause } from '../../src/index.js';
import { pausedRequest } from '../helpers/pausedRequest.js';
import { defineSkill } from '../../src/injection-engine.js';
import { mock } from '../../src/providers.js';
import { recordRun } from '../../src/observe.js';
import type { PermissionChecker } from '../../src/provider-contract/types.js';
import { skillScopedTools } from '../../src/tools/skillScopedTools.js';

const SKILL = 'reports';
const BODY = 'Read a local report.';
const schema = { type: 'object', properties: {} } as const;
const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  toolCalls: [{ id, name, args }],
});

const reportsSkill = (tools: ReturnType<typeof defineTool>[] = []) =>
  defineSkill({ id: SKILL, description: 'Local reporting.', body: BODY, tools });

function skillRole(allowed: () => boolean): PermissionChecker {
  return {
    name: 'report-skill-role',
    governs: ['skill_read'],
    check: ({ capability, target }) => ({
      result:
        capability !== 'skill_read' || target !== `skill:${SKILL}` || allowed() ? 'allow' : 'deny',
    }),
  };
}

it.each(['declared', 'listed'] as const)(
  '%s applies the same skill admission to an ordinary composed call',
  async (skillContext) => {
    const entered = vi.fn(() => 'report ready');
    const prepare = defineTool({
      name: 'prepare_report',
      description: 'Prepare a test report.',
      inputSchema: schema,
      execute: entered,
    });
    const rejected = vi.fn();
    const relay = defineTool({
      name: 'report_summary',
      description: 'Summarize the report when available.',
      inputSchema: schema,
      execute: async (_args, context) => {
        try {
          await context.tools!.call('prepare_report', {});
        } catch (error) {
          rejected(error);
        }
        return 'summary complete';
      },
    });
    const agent = Agent.create({
      provider: mock({ replies: [call('relay', 'report_summary'), { content: 'done' }] }),
      model: 'mock',
      skillContext,
      permissionChecker: skillRole(() => false),
    })
      .skill(reportsSkill([prepare]))
      .tool(relay)
      .build();

    await expect(agent.run({ message: 'Summarize my report.' })).resolves.toBe('done');
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(entered).not.toHaveBeenCalled();
  },
);

it('stops a skill-scoped provider from offering a report after its grant is withdrawn', async () => {
  let allowed = true;
  const entered = vi.fn(() => 'report ready');
  const report = defineTool({
    name: 'prepare_report',
    description: 'Prepare a test report.',
    inputSchema: schema,
    execute: entered,
  });
  const revoke = defineTool({
    name: 'finish_setup',
    description: 'Complete setup.',
    inputSchema: schema,
    execute: () => {
      allowed = false;
      return 'setup complete';
    },
  });
  const offers: string[][] = [];
  const provider = mock({
    respond: ({ tools }) => {
      offers.push((tools ?? []).map(({ name }) => name));
      if (offers.length === 1) return call('load', 'read_skill', { id: SKILL });
      if (offers.length === 2) return call('setup', 'finish_setup');
      return offers[2]?.includes('prepare_report')
        ? call('report', 'prepare_report')
        : { content: 'done' };
    },
  });
  const agent = Agent.create({
    provider,
    model: 'mock',
    skillContext: 'declared',
    permissionChecker: skillRole(() => allowed),
  })
    .skill(reportsSkill())
    .tool(revoke)
    .toolProvider(skillScopedTools(SKILL, [report]))
    .build();

  await expect(agent.run({ message: 'Prepare reporting.' })).resolves.toBe('done');
  expect(offers).toHaveLength(3);
  expect(offers[1]).toContain('prepare_report');
  expect(offers[2]).not.toContain('prepare_report');
  expect(entered).not.toHaveBeenCalled();
});

it('classic dispatch respects the current role while keeping the original tool offer', async () => {
  let allowed = true;
  const entered = vi.fn(() => 'report ready');
  const report = defineTool({
    name: 'prepare_report',
    description: 'Prepare a test report.',
    inputSchema: schema,
    execute: entered,
  });
  const setup = defineTool({
    name: 'finish_setup',
    description: 'Complete setup.',
    inputSchema: schema,
    execute: () => {
      allowed = false;
      return 'setup complete';
    },
  });
  const offers: string[][] = [];
  const provider = mock({
    respond: ({ tools }) => {
      offers.push((tools ?? []).map(({ name }) => name));
      switch (offers.length) {
        case 1:
          return call('setup', 'finish_setup');
        case 2:
          return call('prepare', 'prepare_report');
        default:
          return { content: 'done' };
      }
    },
  });
  const agent = Agent.create({
    provider,
    model: 'mock',
    reactMode: 'classic',
    skillContext: 'declared',
    permissionChecker: skillRole(() => allowed),
  })
    .skill(reportsSkill([report]))
    .tool(setup)
    .build();

  await expect(agent.run({ message: 'Prepare the report.' })).resolves.toContain(
    'a call was refused',
  );
  expect(offers).toHaveLength(3);
  expect(offers[0]).toContain('prepare_report');
  expect(offers[1]).toEqual(offers[0]);
  expect(entered).not.toHaveBeenCalled();
});

it.each(['declared', 'listed'] as const)(
  '%s refreshes the skill view between ordinary turns and files the same served issue',
  async (skillContext) => {
    let allowed = true;
    const offered: boolean[] = [];
    const replies = [
      { content: 'first turn' },
      call('selection', 'read_skill', { id: SKILL }),
      { content: 'second turn' },
    ];
    const provider = mock({
      respond: ({ tools }) => {
        offered.push((tools ?? []).some((schema) => schema.name === 'read_skill'));
        return replies[offered.length - 1]!;
      },
    });
    const agent = Agent.create({
      provider,
      model: 'mock',
      skillContext,
      permissionChecker: skillRole(() => allowed),
    })
      .skill(reportsSkill())
      .build();
    const recorder = recordRun(agent);
    try {
      await agent.run({ message: 'Prepare.' });
      allowed = false;
      await agent.followUp('Continue.');
      expect(offered).toEqual([true, false, false]);
      const history = agent.checkpoint()?.history;
      expect(
        history?.find((m) => m.role === 'tool' && m.toolCallId === 'selection')?.content,
      ).toContain('an offered skill id');
      const event = recorder
        .toRecording()
        .events.find((row) => row.type === 'agentfootprint.validation.args_invalid');
      expect(event?.payload).toMatchObject({
        toolCallId: 'selection',
        issues: [{ path: 'id', expected: 'an offered skill id', got: 'string' }],
      });
    } finally {
      recorder.stop();
      await agent.shutdown();
    }
  },
);

it('keeps unavailable skill results and diagnostics identical at dispatch', async () => {
  async function servedSelection(id: string) {
    const agent = Agent.create({
      provider: mock({
        replies: [call('selection', 'read_skill', { id }), { content: 'done' }],
      }),
      model: 'mock',
      permissionChecker: skillRole(() => false),
    })
      .skill(reportsSkill())
      .skill(defineSkill({ id: 'summary', description: 'Prepare a summary.', body: 'Summarize.' }))
      .build();
    const recorder = recordRun(agent);
    try {
      await agent.run({ message: 'Prepare a summary.' });
      const result = agent
        .checkpoint()
        ?.history.find((message) => message.role === 'tool')?.content;
      const event = recorder
        .toRecording()
        .events.find((row) => row.type === 'agentfootprint.validation.args_invalid');
      const diagnostic =
        event === undefined
          ? undefined
          : {
              issues: event.payload.issues,
              enforced: event.payload.enforced,
            };
      return { result, diagnostic };
    } finally {
      recorder.stop();
      await agent.shutdown();
    }
  }

  const hidden = await servedSelection(SKILL);
  const unknown = await servedSelection('draft');
  expect(hidden.result).toContain('an offered skill id');
  expect(hidden.diagnostic).toMatchObject({
    enforced: true,
    issues: [{ path: 'id', expected: 'an offered skill id', got: 'string' }],
  });
  expect(JSON.stringify(unknown)).toBe(JSON.stringify(hidden));
});

it('a synthetic policy failure withholds the selection and the diagnostic stays generic', async () => {
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      replies: [call('selection', 'read_skill', { id: SKILL }), { content: 'done' }],
    }),
    permissionChecker: {
      name: 'test-policy',
      governs: ['skill_read'],
      check: ({ capability }) => {
        if (capability === 'skill_read') throw new Error('Fixture policy unavailable.');
        return { result: 'allow' };
      },
    },
  })
    .skill(reportsSkill())
    .build();
  await agent.run({ message: 'Try to prepare.' });
  const result = agent.checkpoint()?.history.find((m) => m.role === 'tool')?.content;
  expect(result).toContain('an offered skill id');
  expect(result).not.toContain('Fixture policy unavailable');
});

it.each([true, false])(
  'revalidates an approved body-only skill after a pause (allowed=%s)',
  async (allowedAfterPause) => {
    let allowed = true;
    const agent = Agent.create({
      provider: mock({
        replies: [call('selection', 'read_skill', { id: SKILL }), { content: 'done' }],
      }),
      model: 'mock',
      permissionChecker: skillRole(() => allowed),
    })
      .skill(reportsSkill())
      .toolMiddleware({
        name: 'confirm-selection',
        onToolCall: () => ask({ question: 'Confirm selection?' }),
      })
      .build();
    const recorder = recordRun(agent);
    try {
      const pause = await agent.run({ message: 'Prepare a report.' });
      if (!isAskPause(pause)) throw new Error('Expected the selection to pause.');
      const checkpoint = JSON.parse(JSON.stringify(pause.checkpoint)) as typeof pause.checkpoint;
      allowed = allowedAfterPause;
      await agent.resume(
        checkpoint,
        checkInApproved({ request: pausedRequest(pause), by: 'reader' }),
      );
      const selection = agent.checkpoint()?.history.find((m) => m.role === 'tool')?.content;
      if (allowedAfterPause) {
        expect(selection).toContain("Skill 'reports' activated");
        return;
      }
      expect(selection).toContain('an offered skill id');
      expect(selection).not.toContain(BODY);
      const validation = recorder
        .toRecording()
        .events.find((row) => row.type === 'agentfootprint.validation.args_invalid');
      expect(validation?.payload).toMatchObject({ toolCallId: 'selection', enforced: true });
      const audit = recorder
        .toRecording()
        .events.find(
          (row) =>
            row.type === 'agentfootprint.permission.check' &&
            row.payload.capability === 'skill_read' &&
            row.payload.phase === 'resume',
        );
      expect(audit?.payload).toMatchObject({
        toolCallId: 'selection',
        target: `skill:${SKILL}`,
        result: 'deny',
      });
    } finally {
      recorder.stop();
      await agent.shutdown();
    }
  },
);

it('a composing tool gets the same role boundary before a skill result can be recorded', async () => {
  const relay = defineTool({
    name: 'report_summary',
    description: 'Summarize a local sample.',
    inputSchema: schema,
    execute: async (_args, context) => {
      if (!context.tools) throw new Error('Expected composed tools.');
      try {
        return await context.tools.call('read_skill', { id: SKILL });
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });
  const agent = Agent.create({
    provider: mock({ replies: [call('relay', 'report_summary'), { content: 'done' }] }),
    model: 'mock',
    permissionChecker: skillRole(() => false),
  })
    .skill(reportsSkill())
    .tool(relay)
    .build();
  await agent.run({ message: 'Summarize the report.' });
  const result = agent.checkpoint()?.history.find((m) => m.role === 'tool')?.content;
  expect(result).toContain('an offered skill id');
  expect(result).not.toContain(BODY);
});
