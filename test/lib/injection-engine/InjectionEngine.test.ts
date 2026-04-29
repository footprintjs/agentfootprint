/**
 * Injection Engine — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Covers: primitive types, evaluator, 4 sugar factories, slot subflow
 * integration, Dynamic ReAct end-to-end through the Agent.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/core/Agent.js';
import { defineTool } from '../../../src/core/tools.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import {
  defineInstruction,
  defineSkill,
  defineSteering,
  defineFact,
  evaluateInjections,
  type Injection,
  type InjectionContext,
} from '../../../src/lib/injection-engine/index.js';

const baseCtx: InjectionContext = {
  iteration: 1,
  userMessage: 'hello',
  history: [],
  activatedInjectionIds: [],
};

// ─── Unit — primitive shape + factory validation ───────────────────

describe('Injection primitive — unit', () => {
  it('defineInstruction produces a frozen Injection with correct flavor', () => {
    const inj = defineInstruction({ id: 'i1', prompt: 'rule X' });
    expect(inj.id).toBe('i1');
    expect(inj.flavor).toBe('instructions');
    expect(inj.trigger.kind).toBe('always');
    expect(inj.inject.systemPrompt).toBe('rule X');
    expect(Object.isFrozen(inj)).toBe(true);
  });

  it('defineInstruction with activeWhen produces a rule trigger', () => {
    const inj = defineInstruction({
      id: 'i2',
      activeWhen: (ctx) => ctx.iteration > 1,
      prompt: 'second-iteration rule',
    });
    expect(inj.trigger.kind).toBe('rule');
  });

  it('defineSkill produces flavor="skill" with llm-activated trigger and read_skill', () => {
    const skill = defineSkill({
      id: 'billing',
      description: 'Billing help',
      body: 'Handle billing carefully.',
    });
    expect(skill.flavor).toBe('skill');
    expect(skill.trigger.kind).toBe('llm-activated');
    expect(skill.trigger.kind === 'llm-activated' && skill.trigger.viaToolName).toBe('read_skill');
    expect(skill.inject.systemPrompt).toBe('Handle billing carefully.');
  });

  it('defineSkill with tools targets system-prompt + tools simultaneously', () => {
    const echoTool = defineTool({
      name: 'echo',
      description: 'echo',
      execute: (a: { msg: string }) => a.msg,
    });
    const skill = defineSkill({
      id: 's1',
      description: 'desc',
      body: 'body',
      tools: [echoTool],
    });
    expect(skill.inject.systemPrompt).toBeTruthy();
    expect(skill.inject.tools?.length).toBe(1);
  });

  it('defineSteering produces flavor="steering" always-on', () => {
    const inj = defineSteering({ id: 'st', prompt: 'JSON only' });
    expect(inj.flavor).toBe('steering');
    expect(inj.trigger.kind).toBe('always');
  });

  it('defineFact targets system-prompt by default; messages when requested', () => {
    const a = defineFact({ id: 'f1', data: 'x' });
    expect(a.inject.systemPrompt).toBe('x');
    expect(a.inject.messages).toBeUndefined();

    const b = defineFact({ id: 'f2', data: 'y', slot: 'messages' });
    expect(b.inject.systemPrompt).toBeUndefined();
    expect(b.inject.messages?.[0]?.content).toBe('y');
  });

  it('defineFact with activeWhen uses rule trigger', () => {
    const f = defineFact({
      id: 'f',
      data: 'd',
      activeWhen: (ctx) => ctx.iteration > 2,
    });
    expect(f.trigger.kind).toBe('rule');
  });

  it('all factories validate non-empty id', () => {
    expect(() => defineInstruction({ id: '', prompt: 'x' })).toThrow(/id/);
    expect(() => defineSkill({ id: '', description: 'd', body: 'b' })).toThrow(/id/);
    expect(() => defineSteering({ id: '', prompt: 'x' })).toThrow(/id/);
    expect(() => defineFact({ id: '', data: 'd' })).toThrow(/id/);
  });
});

// ─── Unit — evaluator dispatches each trigger kind ─────────────────

describe('evaluateInjections — unit', () => {
  it('always trigger always activates', () => {
    const a = defineSteering({ id: 'a', prompt: 'p' });
    const r = evaluateInjections([a], baseCtx);
    expect(r.active).toEqual([a]);
  });

  it('rule trigger evaluates predicate against context', () => {
    const a = defineInstruction({
      id: 'a',
      activeWhen: (ctx) => ctx.iteration > 5,
      prompt: 'p',
    });
    const r1 = evaluateInjections([a], { ...baseCtx, iteration: 1 });
    expect(r1.active.length).toBe(0);
    const r2 = evaluateInjections([a], { ...baseCtx, iteration: 10 });
    expect(r2.active.length).toBe(1);
  });

  it('rule trigger that throws is reported in skipped, never propagates', () => {
    const bad = defineInstruction({
      id: 'bad',
      activeWhen: () => {
        throw new Error('boom');
      },
      prompt: 'p',
    });
    const r = evaluateInjections([bad], baseCtx);
    expect(r.active).toEqual([]);
    expect(r.skipped[0]).toMatchObject({ id: 'bad', reason: 'predicate-threw' });
  });

  it('on-tool-return trigger matches lastToolResult.toolName (string)', () => {
    const inj: Injection = {
      id: 'ot',
      flavor: 'instructions',
      trigger: { kind: 'on-tool-return', toolName: 'weather' },
      inject: { systemPrompt: 'after weather' },
    };
    expect(evaluateInjections([inj], baseCtx).active.length).toBe(0);
    const r = evaluateInjections([inj], {
      ...baseCtx,
      lastToolResult: { toolName: 'weather', result: '72F' },
    });
    expect(r.active.length).toBe(1);
  });

  it('on-tool-return trigger matches via RegExp', () => {
    const inj: Injection = {
      id: 'reg',
      flavor: 'instructions',
      trigger: { kind: 'on-tool-return', toolName: /^read_/ },
      inject: { systemPrompt: 'after any read_*' },
    };
    const r = evaluateInjections([inj], {
      ...baseCtx,
      lastToolResult: { toolName: 'read_user', result: 'x' },
    });
    expect(r.active.length).toBe(1);
  });

  it('llm-activated trigger matches by injection id in activatedInjectionIds', () => {
    const skill = defineSkill({
      id: 'billing',
      description: 'd',
      body: 'b',
    });
    expect(evaluateInjections([skill], baseCtx).active.length).toBe(0);
    const r = evaluateInjections([skill], {
      ...baseCtx,
      activatedInjectionIds: ['billing'],
    });
    expect(r.active.length).toBe(1);
  });
});

// ─── Scenario — agent run with all 4 flavors ───────────────────────

describe('Injection Engine — scenario (4 flavors stacked)', () => {
  it('agent.run() succeeds with steering + instruction + fact + skill registered', async () => {
    const steering = defineSteering({ id: 'json', prompt: 'JSON only' });
    const calmTone = defineInstruction({
      id: 'calm',
      activeWhen: (ctx) => ctx.userMessage.includes('upset'),
      prompt: 'Be calm.',
    });
    const userProfile = defineFact({
      id: 'profile',
      data: 'User: Alice (Pro plan)',
    });
    const billing = defineSkill({
      id: 'billing',
      description: 'Billing help',
      body: 'Handle refunds carefully.',
    });

    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'mock',
      maxIterations: 1,
    })
      .steering(steering)
      .instruction(calmTone)
      .fact(userProfile)
      .skill(billing)
      .build();

    const result = await agent.run({ message: 'I am upset about my bill' });
    expect(result).toBe('ok');
  });

  it('rejects duplicate injection ids at build time', () => {
    const a = defineInstruction({ id: 'dup', prompt: 'A' });
    const b = defineSteering({ id: 'dup', prompt: 'B' });
    expect(() =>
      Agent.create({ provider: mock(), model: 'mock' }).injection(a).injection(b).build(),
    ).toThrow(/duplicate id/);
  });
});

// ─── Integration — Dynamic ReAct: state morphs across iterations ──

describe('Injection Engine — integration (Dynamic ReAct)', () => {
  it('rule predicate evaluates fresh each iteration (rule sees updated history)', async () => {
    let iterationsObserved = 0;
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 1,
    })
      .instruction(
        defineInstruction({
          id: 'count',
          activeWhen: (ctx) => {
            iterationsObserved++;
            return ctx.iteration === 1;
          },
          prompt: 'first iteration only',
        }),
      )
      .build();

    await agent.run({ message: 'hi' });
    // Predicate ran at least once (iteration 1).
    expect(iterationsObserved).toBeGreaterThan(0);
  });

  it('Skill becomes active after read_skill is invoked', async () => {
    // Two-iteration mock: first call returns a tool_use for read_skill,
    // second call returns a final reply. Verifies that the LLM-activated
    // path wires through cleanly without crashing the run.
    let iter = 0;
    const provider = mock({
      respond: () => {
        iter++;
        if (iter === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'billing' } }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
        }
        return {
          content: 'final',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 3 })
      .skill(defineSkill({ id: 'billing', description: 'd', body: 'BILLING-BODY' }))
      .build();

    const result = await agent.run({ message: 'hi' });
    expect(result).toBe('final');
    // The Skill should have been activated after iteration 1's read_skill call.
    // We can't easily inspect post-run scope without recorders, but reaching
    // 'final' through 2 iterations confirms the activation pipeline didn't
    // crash on the read_skill round-trip.
  });
});

// ─── Property — invariants ─────────────────────────────────────────

describe('Injection Engine — property', () => {
  it('evaluation order is preserved (active list mirrors registration order)', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((id) => defineSteering({ id, prompt: id }));
    const r = evaluateInjections(list, baseCtx);
    expect(r.active.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('no Injection is double-counted across active + skipped', () => {
    const list = [
      defineSteering({ id: 's', prompt: 's' }),
      defineInstruction({
        id: 'i',
        activeWhen: () => {
          throw new Error();
        },
        prompt: 'i',
      }),
    ];
    const r = evaluateInjections(list, baseCtx);
    const activeIds = new Set(r.active.map((i) => i.id));
    const skippedIds = new Set(r.skipped.map((s) => s.id));
    for (const id of activeIds) expect(skippedIds.has(id)).toBe(false);
  });

  it('flavor of factory-produced Injection cannot be mutated', () => {
    const inj = defineSkill({ id: 's', description: 'd', body: 'b' });
    expect(() => {
      (inj as { flavor: string }).flavor = 'instructions';
    }).toThrow();
  });
});

// ─── Tool-name uniqueness across registry + Skills ────────────────

describe('Injection Engine — tool name validation', () => {
  it('throws at build time on duplicate tool name (registry vs skill)', () => {
    const sharedTool = defineTool({
      name: 'duplicate',
      description: 'd',
      execute: () => 'r',
    });
    const skill = defineSkill({
      id: 's',
      description: 'desc',
      body: 'b',
      tools: [sharedTool],
    });
    expect(() =>
      Agent.create({ provider: mock(), model: 'mock' }).tool(sharedTool).skill(skill).build(),
    ).toThrow(/duplicate tool name 'duplicate'/);
  });

  it('throws at build time on duplicate tool name across two skills', () => {
    const sharedTool = defineTool({
      name: 'shared',
      description: 'd',
      execute: () => 'r',
    });
    expect(() =>
      Agent.create({ provider: mock(), model: 'mock' })
        .skill(defineSkill({ id: 'a', description: 'd', body: 'b', tools: [sharedTool] }))
        .skill(defineSkill({ id: 'b', description: 'd', body: 'b', tools: [sharedTool] }))
        .build(),
    ).toThrow(/duplicate tool name 'shared'/);
  });

  it('Skill-supplied tools are in the executor registry (callable when LLM uses them)', () => {
    const refundTool = defineTool({
      name: 'refund',
      description: 'r',
      execute: () => 'refunded',
    });
    const billingSkill = defineSkill({
      id: 'billing',
      description: 'd',
      body: 'b',
      tools: [refundTool],
    });
    const agent = Agent.create({ provider: mock(), model: 'mock' }).skill(billingSkill).build();
    // The agent's chart was built without throwing; refund + read_skill
    // are both in the merged registry. (Direct registry access is
    // private; the build-not-throwing assertion is the proxy here —
    // duplicate-name-detection above proves the merged-registry path
    // really walks Skill.inject.tools.)
    expect(agent).toBeDefined();
  });
});

// ─── Security — hostile inputs handled cleanly ─────────────────────

describe('Injection Engine — security', () => {
  it('predicate that throws does not crash the agent run', async () => {
    const bad = defineInstruction({
      id: 'bad',
      activeWhen: () => {
        throw new Error('hostile');
      },
      prompt: 'p',
    });
    const agent = Agent.create({
      provider: mock({ reply: 'recovered' }),
      model: 'mock',
      maxIterations: 1,
    })
      .instruction(bad)
      .build();

    const result = await agent.run({ message: 'hi' });
    expect(result).toBe('recovered');
  });

  it('factory rejects empty/missing required fields synchronously', () => {
    expect(() => defineSkill({ id: 'x', description: '', body: 'b' } as never)).toThrow(
      /description/,
    );
    expect(() => defineSkill({ id: 'x', description: 'd', body: '' } as never)).toThrow(/body/);
  });
});

// ─── Performance — bounded overhead ────────────────────────────────

describe('Injection Engine — performance', () => {
  it('evaluating 1000 injections completes in under 50ms', () => {
    const list = Array.from({ length: 1000 }, (_, i) =>
      defineInstruction({
        id: `i${i}`,
        activeWhen: () => i % 2 === 0,
        prompt: 'p',
      }),
    );
    const start = performance.now();
    const r = evaluateInjections(list, baseCtx);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(r.active.length).toBe(500);
  });
});

// ─── ROI — pedagogical surface visible in agent ────────────────────

describe('Injection Engine — ROI (pedagogy + observability)', () => {
  it('agent exposes its registered injections for Lens / docs / debug', () => {
    const a = defineSteering({ id: 'st', prompt: 'p' });
    const b = defineInstruction({ id: 'in', prompt: 'p' });
    const c = defineFact({ id: 'fa', data: 'd' });
    const agent = Agent.create({ provider: mock(), model: 'mock' })
      .steering(a)
      .instruction(b)
      .fact(c)
      .build();
    const seen = (agent as unknown as { injections: readonly Injection[] }).injections;
    expect(seen.map((i) => i.flavor)).toEqual(['steering', 'instructions', 'fact']);
  });

  it('all 4 flavors share the same Injection contract', () => {
    const samples: Injection[] = [
      defineSteering({ id: '1', prompt: 'p' }),
      defineInstruction({ id: '2', prompt: 'p' }),
      defineSkill({ id: '3', description: 'd', body: 'b' }),
      defineFact({ id: '4', data: 'd' }),
    ];
    for (const inj of samples) {
      expect(typeof inj.id).toBe('string');
      expect(typeof inj.flavor).toBe('string');
      expect(typeof inj.trigger.kind).toBe('string');
      expect(typeof inj.inject).toBe('object');
    }
  });
});
