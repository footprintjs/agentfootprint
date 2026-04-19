/**
 * autoActivate — 5-pattern tests.
 *
 * Verifies the SkillRegistry.autoActivate feature landing in 1.17.0:
 *   1. read_skill(id) returns decisionUpdate when autoActivate configured
 *   2. Skill.activeWhen is auto-filled from the state field
 *   3. The tool-execution stage applies decisionUpdate into decision scope
 *   4. End-to-end: skill-gated tools become visible on activation
 *
 * Tiers:
 *   - unit:     constructor accepts autoActivate; getter exposes it;
 *               toTools.readSkill returns decisionUpdate
 *   - boundary: no autoActivate → no decisionUpdate; unknown id with
 *               onUnknownSkill:'clear' vs 'leave'
 *   - scenario: end-to-end with Agent — read_skill flips currentSkill,
 *               skill's tools become advertised next turn
 *   - property: skill with own activeWhen is NOT overwritten; auto-fill
 *               applies only to skills missing activeWhen
 *   - security: malformed args (no id, wrong type) never poison decision
 */
import { describe, expect, it, vi } from 'vitest';
import { defineSkill, SkillRegistry, type AutoActivateOptions } from '../../../src/lib/skills';
import { Agent } from '../../../src/test-barrel';
import type { LLMResponse, Message, ToolCall } from '../../../src/test-barrel';

interface D extends Record<string, unknown> {
  currentSkill?: string;
}

function mockProvider(responses: LLMResponse[]) {
  const calls: Message[][] = [];
  let i = 0;
  return {
    chat: vi.fn(async (messages: Message[]) => {
      calls.push([...messages]);
      const r = responses[i] ?? responses[responses.length - 1];
      i++;
      return r;
    }),
    calls,
  };
}

// ── Unit ────────────────────────────────────────────────────

describe('autoActivate — unit', () => {
  it('constructor accepts autoActivate and exposes it via getter', () => {
    const opts: AutoActivateOptions = { stateField: 'currentSkill' };
    const r = new SkillRegistry<D>({ autoActivate: opts });
    expect(r.hasAutoActivate).toBe(true);
    expect(r.autoActivate).toEqual(opts);
  });

  it('without autoActivate, hasAutoActivate is false', () => {
    const r = new SkillRegistry<D>();
    expect(r.hasAutoActivate).toBe(false);
    expect(r.autoActivate).toBeUndefined();
  });

  it('read_skill returns decisionUpdate with {stateField: id} when configured', async () => {
    const r = new SkillRegistry<D>({ autoActivate: { stateField: 'currentSkill' } });
    r.register(
      defineSkill<D>({
        id: 'port-error-triage',
        version: '1.0.0',
        title: 'Port Error Triage',
        description: 'Triage port errors',
      }),
    );
    const { readSkill } = r.toTools();
    const result = await readSkill.handler({ id: 'port-error-triage' });
    const asAny = result as { decisionUpdate?: Record<string, unknown> };
    expect(asAny.decisionUpdate).toEqual({ currentSkill: 'port-error-triage' });
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('autoActivate — boundary', () => {
  it('without autoActivate, read_skill returns no decisionUpdate', async () => {
    const r = new SkillRegistry<D>();
    r.register(defineSkill<D>({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    const { readSkill } = r.toTools();
    const result = await readSkill.handler({ id: 'x' });
    expect((result as { decisionUpdate?: unknown }).decisionUpdate).toBeUndefined();
  });

  it("onUnknownSkill:'clear' returns decisionUpdate setting field to undefined", async () => {
    const r = new SkillRegistry<D>({
      autoActivate: { stateField: 'currentSkill', onUnknownSkill: 'clear' },
    });
    r.register(defineSkill<D>({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    const { readSkill } = r.toTools();
    const result = await readSkill.handler({ id: 'does-not-exist' });
    const asAny = result as { isError?: boolean; decisionUpdate?: Record<string, unknown> };
    expect(asAny.isError).toBe(true);
    expect(asAny.decisionUpdate).toEqual({ currentSkill: undefined });
  });

  it("onUnknownSkill:'leave' (default) returns isError with NO decisionUpdate", async () => {
    const r = new SkillRegistry<D>({ autoActivate: { stateField: 'currentSkill' } });
    r.register(defineSkill<D>({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    const { readSkill } = r.toTools();
    const result = await readSkill.handler({ id: 'does-not-exist' });
    const asAny = result as { isError?: boolean; decisionUpdate?: unknown };
    expect(asAny.isError).toBe(true);
    expect(asAny.decisionUpdate).toBeUndefined();
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('autoActivate — scenario', () => {
  it('end-to-end: read_skill writes currentSkill into decision scope', async () => {
    const r = new SkillRegistry<D>({
      autoActivate: { stateField: 'currentSkill' },
    });
    r.register(defineSkill<D>({ id: 'a', version: '1.0.0', title: 'A', description: 'Skill A' }));

    const readCall: ToolCall = {
      id: 'tc-1',
      name: 'read_skill',
      arguments: { id: 'a' },
    };
    const provider = mockProvider([
      { content: '', toolCalls: [readCall] },
      { content: 'Acknowledged.' },
    ]);

    const agent = Agent.create({ provider }).decision<D>({}).skills(r).build();
    await agent.run('go');

    // The invariant: after read_skill('a') ran, the agent's decision
    // scope has `currentSkill: 'a'`. That decision flow is what enables
    // skill-gated tool visibility in Dynamic mode (verified separately).
    const snapshot = agent.getSnapshot();
    const finalDecision = (snapshot?.sharedState as { decision?: D })?.decision;
    expect(finalDecision?.currentSkill).toBe('a');
  });
});

// ── Property ────────────────────────────────────────────────

describe('autoActivate — property', () => {
  it('skill with its own activeWhen is NOT overwritten by auto-fill', () => {
    const customActiveWhen = (d: D) => d.currentSkill === 'x' || d.currentSkill === 'y';
    const r = new SkillRegistry<D>({ autoActivate: { stateField: 'currentSkill' } });
    r.register(
      defineSkill<D>({
        id: 'x',
        version: '1.0.0',
        title: 'X',
        description: 'X',
        activeWhen: customActiveWhen,
      }),
    );
    const [instr] = r.toInstructions();
    expect(instr.activeWhen).toBe(customActiveWhen);
  });

  it('auto-filled activeWhen fires for exactly one id', () => {
    const r = new SkillRegistry<D>({ autoActivate: { stateField: 'currentSkill' } });
    r.register(defineSkill<D>({ id: 'foo', version: '1.0.0', title: 'Foo', description: 'Foo' }));
    r.register(defineSkill<D>({ id: 'bar', version: '1.0.0', title: 'Bar', description: 'Bar' }));
    const [fooInstr, barInstr] = r.toInstructions();
    expect(fooInstr.activeWhen!({ currentSkill: 'foo' })).toBe(true);
    expect(fooInstr.activeWhen!({ currentSkill: 'bar' })).toBe(false);
    expect(fooInstr.activeWhen!({})).toBe(false);
    expect(barInstr.activeWhen!({ currentSkill: 'bar' })).toBe(true);
    expect(barInstr.activeWhen!({ currentSkill: 'foo' })).toBe(false);
  });

  it('without autoActivate, toInstructions passes skills through unchanged', () => {
    const r = new SkillRegistry<D>();
    const s = defineSkill<D>({ id: 'x', version: '1.0.0', title: 'X', description: 'X' });
    r.register(s);
    const [instr] = r.toInstructions();
    expect(instr.activeWhen).toBeUndefined();
  });
});

// ── Security ────────────────────────────────────────────────

describe('autoActivate — security', () => {
  it('read_skill with empty id returns isError and NEVER a decisionUpdate', async () => {
    const r = new SkillRegistry<D>({ autoActivate: { stateField: 'currentSkill' } });
    r.register(defineSkill<D>({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    const { readSkill } = r.toTools();
    const result = await readSkill.handler({ id: '' });
    const asAny = result as { isError?: boolean; decisionUpdate?: unknown };
    expect(asAny.isError).toBe(true);
    expect(asAny.decisionUpdate).toBeUndefined();
  });

  it('read_skill with non-string id returns isError, no decisionUpdate', async () => {
    const r = new SkillRegistry<D>({ autoActivate: { stateField: 'currentSkill' } });
    r.register(defineSkill<D>({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    const { readSkill } = r.toTools();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readSkill.handler({ id: 42 as any });
    const asAny = result as { isError?: boolean; decisionUpdate?: unknown };
    expect(asAny.isError).toBe(true);
    expect(asAny.decisionUpdate).toBeUndefined();
  });

  it('decisionUpdate only touches the configured stateField (not other keys)', async () => {
    const r = new SkillRegistry<D>({ autoActivate: { stateField: 'currentSkill' } });
    r.register(defineSkill<D>({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));
    const { readSkill } = r.toTools();
    const result = await readSkill.handler({ id: 'x' });
    const upd = (result as { decisionUpdate?: Record<string, unknown> }).decisionUpdate!;
    expect(Object.keys(upd)).toEqual(['currentSkill']);
  });
});
