/**
 * Unit tests — skillSteps, the procedure grammar (9.18.0).
 *
 * Pattern: Test-as-specification. Locks the defineSkill checkup (every
 * refusal is a teaching refusal), the build-time plan fold, the pointer's
 * re-key rule, and every sentence the model reads — banner, suffixes, skip
 * sentences, the nudge.
 */

import { describe, it, expect } from 'vitest';
import { defineTool } from '../../../src/index.js';
import { defineSkill } from '../../../src/injection-engine.js';
import {
  buildSkipStepTool,
  foldStepPlans,
  nudgeTeachingMessage,
  pointerOf,
  rekeyStepPointer,
  remainingStepsOf,
  skipAdvanceSentence,
  skipHoldSentence,
  stepAdvanceSuffix,
  stepBannerPrefix,
  stepInProgress,
  SKIP_STEP_TOOL_NAME,
  type StepPlan,
  type StepPointer,
} from '../../../src/lib/injection-engine/skillSteps.js';

const tool = (name: string) =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => `${name} ran`,
  });

const procedureSkill = (over: Partial<Parameters<typeof defineSkill>[0]> = {}) =>
  defineSkill({
    id: 'refund',
    description: 'refunds',
    body: 'refund carefully',
    tools: [tool('lookup'), tool('charge'), tool('export')] as never,
    steps: [
      { tool: 'lookup', note: 'find the order first' },
      { tool: 'charge', note: 'refund the charge' },
      { tool: 'export', note: 'file the receipt' },
    ],
    ...over,
  });

// ─────────────────────────────────────────────────────────────────────────
// Functional — validation refusals at defineSkill (teaching refusals)
// ─────────────────────────────────────────────────────────────────────────

describe('functional: defineSkill steps checkup', () => {
  it('a step naming a tool the skill does not carry is refused, naming both', () => {
    expect(() =>
      procedureSkill({
        steps: [{ tool: 'export_csv', note: 'ship it' }],
      }),
    ).toThrow(/step 1 names 'export_csv', which this skill's `tools` does not carry/);
  });

  it('steps: [] is refused — say what you mean and omit', () => {
    expect(() => procedureSkill({ steps: [] })).toThrow(/`steps: \[\]` declares nothing/);
  });

  it('an empty note is refused — the note is the whole point', () => {
    expect(() => procedureSkill({ steps: [{ tool: 'lookup', note: '  ' }] })).toThrow(
      /has no note/,
    );
  });

  it('an empty tool is refused', () => {
    expect(() => procedureSkill({ steps: [{ tool: '', note: 'do it' }] })).toThrow(
      /step 1 names no tool/,
    );
  });

  it('steps on a skill with no tools at all is refused', () => {
    expect(() =>
      defineSkill({
        id: 'toolless',
        description: 'd',
        body: 'b',
        steps: [{ tool: 'lookup', note: 'n' }],
      }),
    ).toThrow(/carries no `tools`/);
  });

  it('onSkip without steps is refused', () => {
    expect(() =>
      defineSkill({
        id: 'no-steps',
        description: 'd',
        body: 'b',
        tools: [tool('lookup')] as never,
        onSkip: 'hold',
      }),
    ).toThrow(/`onSkip` is legal only beside `steps`/);
  });

  it('repeats across steps are legal (look it up again)', () => {
    expect(() =>
      procedureSkill({
        steps: [
          { tool: 'lookup', note: 'before' },
          { tool: 'charge', note: 'act' },
          { tool: 'lookup', note: 'after — verify the change' },
        ],
      }),
    ).not.toThrow();
  });

  it('declared steps ride metadata with the default onSkip; absent steps leave metadata untouched', () => {
    const stepped = procedureSkill();
    const meta = stepped.metadata as { steps?: unknown[]; onSkip?: string };
    expect(meta.steps).toHaveLength(3);
    expect(meta.onSkip).toBe('advance');

    const plain = defineSkill({ id: 'plain', description: 'd', body: 'b' });
    const plainMeta = plain.metadata as Record<string, unknown>;
    expect('steps' in plainMeta).toBe(false);
    expect('onSkip' in plainMeta).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the fold + the pointer
// ─────────────────────────────────────────────────────────────────────────

describe('functional: foldStepPlans + rekeyStepPointer', () => {
  it('folds only stepped skills, with the tool-name set and the declared policy', () => {
    const plans = foldStepPlans([
      procedureSkill({ onSkip: 'hold' }),
      defineSkill({ id: 'plain', description: 'd', body: 'b' }),
    ]);
    expect(plans.size).toBe(1);
    const plan = plans.get('refund')!;
    expect(plan.onSkip).toBe('hold');
    expect([...plan.toolNames].sort()).toEqual(['charge', 'export', 'lookup']);
  });

  const stepPlanFor = (id: string): StepPlan | undefined =>
    foldStepPlans([procedureSkill()]).get(id);

  it('tenant changed onto a stepped skill → a fresh step-1 pointer', () => {
    const fresh = rekeyStepPointer({ prior: undefined, tenant: 'refund', stepPlanFor });
    expect(pointerOf(fresh)).toEqual({ skillId: 'refund', step: 1, total: 3, skipped: [] });
  });

  it('tenant unchanged → pass-through, position and skips preserved', () => {
    const prior: StepPointer = { skillId: 'refund', step: 2, total: 3, skipped: [1] };
    const kept = rekeyStepPointer({ prior: [prior], tenant: 'refund', stepPlanFor });
    expect(pointerOf(kept)).toEqual(prior);
  });

  it('tenant moved to an unstepped skill → cleared; no tenant → cleared', () => {
    const prior: StepPointer = { skillId: 'refund', step: 2, total: 3, skipped: [] };
    expect(rekeyStepPointer({ prior: [prior], tenant: 'plain', stepPlanFor })).toEqual([]);
    expect(rekeyStepPointer({ prior: [prior], tenant: undefined, stepPlanFor })).toEqual([]);
  });

  it('pointerOf reads only a real carrier; stepInProgress ends at total+1', () => {
    expect(pointerOf(undefined)).toBeUndefined();
    expect(pointerOf([])).toBeUndefined();
    expect(pointerOf('nope')).toBeUndefined();
    expect(stepInProgress({ skillId: 's', step: 3, total: 3, skipped: [] })).toBe(true);
    expect(stepInProgress({ skillId: 's', step: 4, total: 3, skipped: [] })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — every sentence the model reads
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the grammar', () => {
  const plan = foldStepPlans([procedureSkill()]).get('refund')!;
  const at = (step: number): StepPointer => ({ skillId: 'refund', step, total: 3, skipped: [] });

  it('the banner leads with position and the note', () => {
    expect(stepBannerPrefix(at(2), plan.steps[1]!)).toBe('[Step 2 of 3 — refund the charge] ');
  });

  it('the advance suffix names what is done and what is next — and the completion', () => {
    expect(stepAdvanceSuffix(at(2), plan)).toBe(
      ' Step 1 of 3 done. Now on step 2 of 3: refund the charge (tool: `charge`).',
    );
    expect(stepAdvanceSuffix(at(4), plan)).toBe(' Step 3 of 3 done. All 3 steps complete.');
  });

  it('the skip sentences carry the reason, on both policies', () => {
    const next: StepPointer = { skillId: 'refund', step: 3, total: 3, skipped: [2] };
    expect(skipAdvanceSentence(2, 'charge already refunded', next, plan)).toContain(
      'Step 2 skipped: charge already refunded. Now on step 3 of 3',
    );
    expect(skipHoldSentence(at(2), 'not yet', plan)).toContain(
      "Step 2 of 3 stays current (declared policy 'hold') — run `charge`",
    );
  });

  it('the nudge lists every remaining step with its note and never orders', () => {
    const msg = nudgeTeachingMessage(at(2), plan);
    expect(msg).toContain("Steps 2–3 of 'refund' have not run");
    expect(msg).toContain('2: refund the charge (`charge`)');
    expect(msg).toContain('3: file the receipt (`export`)');
    expect(msg).toContain('Finish them, or say why you are stopping.');
    expect(remainingStepsOf(at(2), plan).map((s) => s.index)).toEqual([2, 3]);
  });

  it('buildSkipStepTool: reserved name, required reason, honest placeholder', async () => {
    const skip = buildSkipStepTool();
    expect(skip.schema.name).toBe(SKIP_STEP_TOOL_NAME);
    expect((skip.schema.inputSchema as { required?: string[] }).required).toEqual(['reason']);
    const placeholder = await skip.execute({ reason: 'x' }, {
      toolCallId: 't',
      iteration: 1,
    } as never);
    expect(String(placeholder)).toContain('agent loop replaces this result');
  });
});
