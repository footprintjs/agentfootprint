/** The owned read_skill schema admits only its declared id before activation. */
import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/index.js';
import { defineSkill, skillGraph } from '../../../src/doors/context.js';
import { readSkillDescriptor } from '../../../src/doors/skill-graph.js';
import { mock } from '../../../src/providers.js';
import type { LLMRequest } from '../../../src/adapters/types.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import { validateToolArgs } from '../../../src/core/agent/toolArgsValidation.js';
import { splitFindings, withFindingsArgument } from '../../../src/core/agent/findings/reserved.js';

const BODY = 'BILLING_BODY_DELIVERY_CANARY';
const CALL_ID = 'read-skill-schema-call';
const EXTRA_VALUE = 'private-extra-canary';
const skill = (id: string, body = `${id.toUpperCase()}_BODY`) =>
  defineSkill({ id, description: `The ${id} procedure`, body, surfaceMode: 'both' });
const catalog = () => [skill('alpha'), skill('billing', BODY), skill('delta')];

type RunOptions = {
  mode?: 'enforce' | 'warn' | 'off';
  findings?: boolean;
  graph?: boolean;
};

async function runReadSkill(args: Record<string, unknown>, options: RunOptions = {}) {
  const wire: LLMRequest[] = [];
  const events: AgentfootprintEvent[] = [];
  const provider = mock({
    respond: (request) => {
      wire.push(request);
      return wire.length === 1
        ? { toolCalls: [{ id: CALL_ID, name: 'read_skill', args }] }
        : { content: 'done' };
    },
  });
  const builder = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 3,
    ...(options.mode !== undefined && { toolArgValidation: options.mode }),
  }).system('Follow the selected procedure.');
  if (options.graph) {
    const [alpha, billing, delta] = catalog();
    builder.skillGraph(
      skillGraph()
        .entry(alpha!, { when: () => true })
        .route(alpha!, billing!)
        .route(billing!, delta!)
        .build({ check: 'off' }),
    );
  } else {
    builder.skill(skill('billing', BODY));
  }
  if (options.findings) builder.findings();
  const agent = builder.build();
  agent.on('*', (event) => events.push(event));
  expect(await agent.run({ message: 'Read the billing procedure.' })).toBe('done');
  expect(wire).toHaveLength(2);
  const result =
    wire[1]?.messages.find((message) => message.role === 'tool' && message.toolCallId === CALL_ID)
      ?.content ?? '';
  const served = wire[0]?.tools?.find((tool) => tool.name === 'read_skill');
  const invalid = events.filter((event) => event.type === 'agentfootprint.validation.args_invalid');
  const activated = events.some(
    (event) =>
      event.type === 'agentfootprint.context.evaluated' &&
      event.payload.activeIds.includes('billing'),
  );
  return { agent, args, wire, events, result, served, invalid, activated };
}

describe('public readSkillDescriptor — owned argument closure', () => {
  it.each([
    ['plain', undefined],
    ['scoped offer', { grantable: ['billing'], cursorId: 'alpha' }],
    ['hidden skill', { grantable: ['billing'], hiddenIds: ['delta'] }],
  ] as const)('%s closes arguments while retaining the complete id catalog', (_label, offer) => {
    const descriptor = readSkillDescriptor(catalog(), offer)!;
    expect(descriptor.name).toBe('read_skill');
    expect(descriptor.inputSchema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string', enum: ['alpha', 'billing', 'delta'] } },
      required: ['id'],
      additionalProperties: false,
    });
    expect(Object.keys(descriptor.inputSchema.properties as object)).toEqual(['id']);
  });

  it.each(['extra', 'constructor', '__proto__'])('refuses an undeclared own %s argument', (key) => {
    const descriptor = readSkillDescriptor(catalog())!;
    const args = JSON.parse(`{"id":"billing","${key}":"${EXTRA_VALUE}"}`);
    expect(validateToolArgs(args, descriptor.inputSchema)).toEqual({
      ok: false,
      issues: [{ path: key, expected: 'no additional properties', got: 'string' }],
    });
    expect(args[key]).toBe(EXTRA_VALUE);
    expect(Object.hasOwn(args, key)).toBe(true);
  });

  it('keeps valid ids, required and string/enum checks, body delivery, and the empty catalog', () => {
    const descriptor = readSkillDescriptor(catalog())!;
    expect(validateToolArgs({ id: 'billing' }, descriptor.inputSchema).ok).toBe(true);
    expect(validateToolArgs({}, descriptor.inputSchema).issues).toContainEqual({
      path: 'id',
      expected: 'required',
      got: 'missing',
    });
    expect(validateToolArgs({ id: 7 }, descriptor.inputSchema).issues).toContainEqual({
      path: 'id',
      expected: 'string',
      got: 'number',
    });
    expect(validateToolArgs({ id: 'unknown' }, descriptor.inputSchema).ok).toBe(false);
    expect(descriptor.execute({ id: 'billing' })).toBe(BODY);
    expect(readSkillDescriptor([])).toBeUndefined();
  });

  it('keeps findings decoration closed and peels the reserved field before registry validation', () => {
    const descriptor = readSkillDescriptor(catalog())!;
    const raw = { id: 'billing', _findings: { basis: 'direct' } };
    const served = withFindingsArgument(descriptor).inputSchema;
    const { args, findings } = splitFindings(raw);
    expect(served.additionalProperties).toBe(false);
    expect(served.required).toEqual(['id']);
    expect(validateToolArgs(raw, served).ok).toBe(true);
    expect(validateToolArgs({ ...raw, extra: true }, served).issues).toContainEqual({
      path: 'extra',
      expected: 'no additional properties',
      got: 'boolean',
    });
    expect(validateToolArgs(raw, descriptor.inputSchema).issues).toContainEqual({
      path: '_findings',
      expected: 'no additional properties',
      got: 'object',
    });
    expect(args).toEqual({ id: 'billing' });
    expect(findings).toEqual({ basis: 'direct' });
    expect(validateToolArgs(args, descriptor.inputSchema)).toEqual({ ok: true, issues: [] });
    expect(Object.keys(descriptor.inputSchema.properties as object)).toEqual(['id']);
    expect(raw).toEqual({ id: 'billing', _findings: { basis: 'direct' } });
  });
});

describe('real Agent read_skill — schema admission precedes activation', () => {
  it.each(['extra', 'constructor', '__proto__'])(
    'refuses %s without activating or delivering the body',
    async (key) => {
      const args = JSON.parse(`{"id":"billing","${key}":"${EXTRA_VALUE}"}`);
      const state = await runReadSkill(args);
      expect(state.result).toContain("Invalid arguments for tool 'read_skill'");
      expect(state.result).toContain(`'${key}': expected no additional properties`);
      expect(state.result).not.toContain(EXTRA_VALUE);
      expect(state.result).not.toContain(BODY);
      expect(state.activated).toBe(false);
      expect(state.wire.every((request) => !request.systemPrompt?.includes(BODY))).toBe(true);
      expect(state.invalid).toMatchObject([
        {
          payload: {
            toolName: 'read_skill',
            toolCallId: CALL_ID,
            enforced: true,
            issues: [{ path: key, expected: 'no additional properties', got: 'string' }],
          },
        },
      ]);
      expect(state.events.some((event) => event.type === 'agentfootprint.skill.rejected')).toBe(
        false,
      );
      expect(args[key]).toBe(EXTRA_VALUE);
    },
  );

  it('accepts a valid pick and delivers its body through the existing channels', async () => {
    const state = await runReadSkill({ id: 'billing' });
    expect(state.result).toContain(BODY);
    expect(state.activated).toBe(true);
    expect(state.wire[0]?.systemPrompt).not.toContain(BODY);
    expect(state.wire[1]?.systemPrompt).toContain(BODY);
    expect(state.invalid).toEqual([]);
  });

  it.each(['warn', 'off'] as const)(
    '%s keeps activation and body delivery for otherwise-valid extras',
    async (mode) => {
      const state = await runReadSkill({ id: 'billing', extra: EXTRA_VALUE }, { mode });
      expect(state.result).toContain(BODY);
      expect(state.activated).toBe(true);
      if (mode === 'warn') {
        expect(state.invalid).toMatchObject([
          {
            payload: {
              toolName: 'read_skill',
              toolCallId: CALL_ID,
              enforced: false,
              issues: [{ path: 'extra', expected: 'no additional properties', got: 'string' }],
            },
          },
        ]);
      } else {
        expect(state.invalid).toEqual([]);
      }
    },
  );

  it('retains the full catalog so an unreachable id receives the graph teaching refusal', async () => {
    const state = await runReadSkill({ id: 'delta' }, { graph: true });
    expect(state.served?.inputSchema).toMatchObject({
      properties: { id: { enum: ['alpha', 'billing', 'delta'] } },
    });
    expect(state.result).toContain(
      "read_skill(\"delta\") was not granted on that call: 'delta' was not reachable from 'alpha'",
    );
    expect(state.result).not.toContain('Invalid arguments');
    expect(state.invalid).toEqual([]);
    expect(state.events.some((event) => event.type === 'agentfootprint.skill.rejected')).toBe(true);
    expect(state.wire.every((request) => !request.systemPrompt?.includes('DELTA_BODY'))).toBe(true);
  });

  it('findings decoration still admits a valid pick after peeling the reserved field', async () => {
    const state = await runReadSkill(
      { id: 'billing', _findings: { basis: 'direct' } },
      { findings: true },
    );
    expect(state.served?.inputSchema).toMatchObject({
      required: ['id'],
      additionalProperties: false,
      properties: { _findings: { type: 'object' } },
    });
    expect(state.invalid).toEqual([]);
    expect(state.result).toContain(BODY);
    expect(state.activated).toBe(true);
    const findings = state.agent.findings();
    if (findings === undefined)
      throw new Error('Expected the armed findings ledger to be available');
    expect(findings.some((row) => row.kind === 'basis' && row.basis === 'direct')).toBe(true);
  });

  it('findings peeling does not hide a genuine extra argument', async () => {
    const state = await runReadSkill(
      { id: 'billing', extra: EXTRA_VALUE, _findings: { basis: 'direct' } },
      { findings: true },
    );
    expect(state.result).toContain("'extra': expected no additional properties");
    expect(state.result).not.toContain("'_findings': expected no additional properties");
    expect(state.activated).toBe(false);
    expect(state.invalid).toMatchObject([
      {
        payload: {
          issues: [{ path: 'extra', expected: 'no additional properties', got: 'string' }],
        },
      },
    ]);
  });
});
