/**
 * An instruction can finally SAY the fact it was already allowed to gate on —
 * `promptTemplate` (9.57.0).
 *
 * ## The gap
 *
 * `InjectionTrigger.rule` takes a predicate, so an instruction could switch on
 * at action 22. `Injection.inject` is static data, so the same instruction
 * could never render *"you have used 23 of your 30 actions"*. The framework hit
 * this three times itself — `defineStepsHint`, `defineMenuHint` and
 * `defineRelevanceHint` each carry a STATIC body and push their DATA through a
 * tool description, because `inject` cannot render. A consumer reported the
 * same thing from outside: they had to ride the count on their own tool
 * results, which only works for an app that owns its tools.
 *
 * ## Why named slots and not a function
 *
 * Absence. Given `inject: (ctx) => …`, an author writes `${ctx.maxIterations}`
 * and ships "23 of undefined", or writes `?? 0` and ships a fabricated
 * denominator nothing can tell from a real zero. With a closed vocabulary the
 * LIBRARY owns absence and applies one rule: if any named fact is unavailable,
 * the whole instruction is skipped, by name, on the record.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/index.js';
import { defineInstruction } from '../../../src/lib/injection-engine/factories/defineInstruction.js';
import { evaluateInjections } from '../../../src/lib/injection-engine/evaluator.js';
import {
  projectActiveInjection,
  type InjectionContext,
} from '../../../src/lib/injection-engine/types.js';
import { scopeToolsToActiveSkill } from '../../../src/core/agent/toolsFromActiveSkill.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { defineTool } from '../../../src/core/tools.js';

const BUDGET_LINE =
  'You are on action {{action}} of {{actionBudget}}; {{actionsRemaining}} remain. ' +
  'Finish what you have rather than start something new.';

const looker = defineTool({
  name: 'look',
  description: 'look one thing up',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'a log line',
} as never);

function ctxAt(iteration: number, maxIterations?: number): InjectionContext {
  return {
    iteration,
    ...(maxIterations !== undefined && {
      maxIterations,
      iterationsRemaining: Math.max(0, maxIterations - iteration),
    }),
    userMessage: 'go',
    history: [],
    activatedInjectionIds: [],
  };
}

/** A provider that loops on the tool and records every request verbatim. */
function recordingLoop(rounds: number): { provider: LLMProvider; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  let call = 0;
  return {
    requests,
    provider: {
      name: 'mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        call++;
        const wantsTool = call <= rounds;
        return {
          content: wantsTool ? '' : 'done',
          toolCalls: wantsTool ? [{ id: `c${call}`, name: 'look', args: {} }] : [],
          usage: { input: 100, output: 5 },
          stopReason: 'end_turn',
        };
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Define time — everything that can be refused, is
// ─────────────────────────────────────────────────────────────────

describe('define time', () => {
  it('a name outside the vocabulary is refused, and the error lists the three', () => {
    expect(() => defineInstruction({ id: 'x', promptTemplate: 'on {{actionsLeft}}' })).toThrow(
      /\{\{actionsLeft\}\}/,
    );
    expect(() => defineInstruction({ id: 'x', promptTemplate: 'on {{actionsLeft}}' })).toThrow(
      /\{\{action\}\}, \{\{actionBudget\}\}, \{\{actionsRemaining\}\}/,
    );
  });

  it('prompt and promptTemplate together is refused', () => {
    expect(() =>
      defineInstruction({
        id: 'x',
        prompt: 'a',
        promptTemplate: 'b {{action}}',
      } as never),
    ).toThrow(/not both/);
  });

  it('neither is refused, and the error names both doors', () => {
    expect(() => defineInstruction({ id: 'x' } as never)).toThrow(/promptTemplate/);
  });

  it("slot: 'messages' + a template is refused, naming the delivery ledger", () => {
    expect(() =>
      defineInstruction({
        id: 'x',
        slot: 'messages',
        role: 'assistant',
        promptTemplate: 'on {{action}}',
      } as never),
    ).toThrow(/delivers each piece ONCE per run/);
  });

  it('a cacheable template is refused; a deliberate never is accepted', () => {
    expect(() =>
      defineInstruction({ id: 'x', promptTemplate: 'on {{action}}', cache: 'always' } as never),
    ).toThrow(/STABLE PREFIX/);
    expect(() =>
      defineInstruction({ id: 'x', promptTemplate: 'on {{action}}', cache: 'never' } as never),
    ).not.toThrow();
  });

  it('a promptTemplate with no placeholders is an ordinary instruction', () => {
    const inj = defineInstruction({ id: 'plain', promptTemplate: 'just words' });
    expect(inj.templated).toBeUndefined();
    expect(inj.inject.systemPrompt).toBe('just words');
  });

  it('the marker is TOP-LEVEL, so it survives the spread that rebuilds metadata', () => {
    const inj = defineInstruction({ id: 'budget', promptTemplate: BUDGET_LINE });
    expect(inj.templated).toBe(true);
    // `scopeToolsToActiveSkill` rebuilds `metadata` wholesale — a marker
    // living there could be lost, and then `{{actionsRemaining}}` would reach
    // the model.
    const [rebuilt] = scopeToolsToActiveSkill([inj], undefined);
    expect(rebuilt!.templated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// Render — the number, and the absence
// ─────────────────────────────────────────────────────────────────

describe('rendering', () => {
  const budget = defineInstruction({ id: 'budget', promptTemplate: BUDGET_LINE });

  it('renders the real numbers at the projection seam', () => {
    const projected = projectActiveInjection(budget, ctxAt(25, 30));
    expect(projected.inject.systemPrompt).toContain('action 25 of 30');
    expect(projected.inject.systemPrompt).toContain('5 remain');
  });

  it('floors at zero — the wrap-up call runs at maxIterations + 1', () => {
    const projected = projectActiveInjection(budget, ctxAt(31, 30));
    expect(projected.inject.systemPrompt).toContain('0 remain');
    expect(projected.inject.systemPrompt).not.toContain('-1');
  });

  it('LEAK INVARIANT: no placeholder survives a projection, on any path', () => {
    for (const iteration of [1, 2, 15, 30, 31]) {
      const projected = projectActiveInjection(budget, ctxAt(iteration, 30));
      expect(projected.inject.systemPrompt ?? '').not.toMatch(/\{\{[A-Za-z0-9_]+\}\}/);
    }
    // Even projected with no ctx at all, the literal never crosses: the piece
    // is ABSENT instead.
    expect(projectActiveInjection(budget).inject.systemPrompt).toBeUndefined();
    // …and the same through the skill-scoping path.
    const [scoped] = scopeToolsToActiveSkill([budget], undefined);
    expect(projectActiveInjection(scoped!, ctxAt(3, 9)).inject.systemPrompt).not.toMatch(/\{\{/);
  });

  it('ABSENCE: no budget → the whole instruction is skipped, by name', () => {
    const out = evaluateInjections([budget], ctxAt(4));
    expect(out.active).toEqual([]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]!.reason).toBe('unknown-fact');
    // Both unfillable facts are named — `{{action}}` is always fillable.
    expect(out.skipped[0]!.error).toContain('{{actionBudget}}');
    expect(out.skipped[0]!.error).toContain('{{actionsRemaining}}');
  });

  it('absence is never a zero, an undefined, or a gap', () => {
    const out = evaluateInjections([budget], ctxAt(4));
    const rendered = out.active.map((i) => projectActiveInjection(i, ctxAt(4)));
    const all = rendered.map((r) => r.inject.systemPrompt ?? '').join(' ');
    expect(all).not.toContain('of 0');
    expect(all).not.toContain('undefined');
    expect(all).toBe('');
  });

  it('a static instruction is returned by REFERENCE — the renderer touches nothing', () => {
    const plain = defineInstruction({ id: 'plain', prompt: 'stay calm' });
    const withCtx = projectActiveInjection(plain, ctxAt(3, 9));
    const withoutCtx = projectActiveInjection(plain);
    expect(withCtx.inject.systemPrompt).toBe(plain.inject.systemPrompt);
    expect(withoutCtx.inject.systemPrompt).toBe(plain.inject.systemPrompt);
  });
});

// ─────────────────────────────────────────────────────────────────
// Integration — the request the model actually read
// ─────────────────────────────────────────────────────────────────

describe('a real run', () => {
  it('the SYSTEM PROMPT on the captured request carries the live count', async () => {
    const { provider, requests } = recordingLoop(6);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 30 })
      .tool(looker as never)
      .instruction(defineInstruction({ id: 'budget', promptTemplate: BUDGET_LINE }))
      .build();
    await agent.run({ message: 'go' });

    expect(requests.length).toBeGreaterThanOrEqual(4);
    // Asserted against the REQUEST, not the injection object: what the model
    // read is the only thing that counts.
    requests.forEach((req, i) => {
      const action = i + 1;
      expect(req.systemPrompt ?? '').toContain(`action ${action} of 30`);
      expect(req.systemPrompt ?? '').toContain(`${30 - action} remain`);
      expect(req.systemPrompt ?? '').not.toMatch(/\{\{/);
    });
  });

  it('a different rendering per action, and one context.injected each', async () => {
    const { provider, requests } = recordingLoop(4);
    const injected: string[] = [];
    const agent = Agent.create({ provider, model: 'm', maxIterations: 12 })
      .tool(looker as never)
      .instruction(defineInstruction({ id: 'budget', promptTemplate: BUDGET_LINE }))
      .build();
    agent.on('agentfootprint.context.injected', (e) => {
      const payload = e.payload as { sourceId?: string; rawContent?: string };
      if (payload.sourceId === 'budget') injected.push(payload.rawContent ?? '');
    });
    await agent.run({ message: 'go' });

    const prompts = requests.map((r) => r.systemPrompt ?? '');
    expect(new Set(prompts).size).toBe(prompts.length);
    // A static instruction is recorded once per run (the recorder dedups by
    // content hash); a templated one is recorded on every action, because its
    // content really is different every action. More truth, not less.
    expect(injected.length).toBe(requests.length);
    expect(new Set(injected).size).toBe(injected.length);
  });

  it('an agent using only `prompt` is unchanged', async () => {
    const a = recordingLoop(3);
    const b = recordingLoop(3);
    const build = (p: LLMProvider): Agent =>
      Agent.create({ provider: p, model: 'm', maxIterations: 12 })
        .tool(looker as never)
        .instruction(defineInstruction({ id: 'calm', prompt: 'Stay calm and be brief.' }))
        .build();
    await build(a.provider).run({ message: 'go' });
    await build(b.provider).run({ message: 'go' });
    expect(a.requests.map((r) => r.systemPrompt)).toEqual(b.requests.map((r) => r.systemPrompt));
    // Every action reads the SAME bytes — a static instruction did not become
    // per-action work.
    expect(new Set(a.requests.map((r) => r.systemPrompt)).size).toBe(1);
  });

  it('each turn counts from its own start', async () => {
    const first = recordingLoop(1);
    const second = recordingLoop(1);
    for (const script of [first, second]) {
      const agent = Agent.create({ provider: script.provider, model: 'm', maxIterations: 30 })
        .tool(looker as never)
        .instruction(defineInstruction({ id: 'budget', promptTemplate: BUDGET_LINE }))
        .build();
      await agent.run({ message: 'go' });
      expect(script.requests[0]!.systemPrompt ?? '').toContain('action 1 of 30');
    }
  });
});
