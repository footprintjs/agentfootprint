import { expect, it, vi } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { defineSkill } from '../../src/injection-engine.js';
import { mock } from '../../src/providers.js';
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
