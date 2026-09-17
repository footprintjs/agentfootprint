/**
 * Unit — the serving decision (9.105.0, `toolChoice/pick.ts · narrowServed`).
 *
 * Pinned: top-N plus the doors in the wire's order; the four skips —
 * `unavailable` (a failed pick, or fewer scored names than N), `too-few`
 * (fewer than N + 1 candidates), `after-miss` (the previous outcome carried a
 * miss), `wrap-up` — each serving the FULL wire with the reason; an advisory
 * agent (`top` undefined) serves the full wire with no reason; the doors are
 * the framework's four plus the app's own; and the four literals in
 * `ALWAYS_SERVED_TOOLS` are the owners' constants.
 */

import { describe, expect, it } from 'vitest';
import {
  alwaysServedNames,
  narrowServed,
  type Pick,
} from '../../../../src/core/agent/toolChoice/pick.js';
import { ALWAYS_SERVED_TOOLS } from '../../../../src/core/agent/toolChoice/types.js';
import { SKIP_STEP_TOOL_NAME } from '../../../../src/lib/injection-engine/skillSteps.js';
import { PRESENT_TOOL_NAME } from '../../../../src/artifacts/present.js';
import {
  buildListSkillsTool,
  buildReadSkillTool,
} from '../../../../src/lib/injection-engine/skillTools.js';
import { defineSkill } from '../../../../src/injection-engine.js';

const WIRE = ['read_skill', 'lookup', 'charge', 'ship', 'invoice', 'skip_step'];
const DOORS = alwaysServedNames(undefined);

const ranked = (...names: string[]): Pick => ({
  ok: true,
  classifier: { name: 'mock', model: 'm' },
  ranked: names.map((name, i) => ({ name, score: 1 - i * 0.1 })),
  chosen: names[0],
  confidence: 0.8,
  latencyMs: 1,
});
const failed: Pick = { ok: false, classifier: { name: 'mock' }, message: 'down', latencyMs: 1 };

const decide = (
  pick: Pick,
  top: number | undefined,
  extra: Partial<Parameters<typeof narrowServed>[0]> = {},
) =>
  narrowServed({
    wire: WIRE,
    doors: DOORS,
    pick,
    top,
    iteration: 2,
    prior: [],
    wrapUpAsked: false,
    ...extra,
  });

describe('narrowServed', () => {
  it('serves the top-N plus the doors, in the wire’s order', () => {
    expect(decide(ranked('ship', 'charge', 'lookup', 'invoice'), 2)).toEqual({
      served: ['read_skill', 'charge', 'ship', 'skip_step'],
      narrowed: true,
    });
  });

  it('an advisory agent serves the full wire with no reason — nothing was asked', () => {
    expect(decide(ranked('ship'), undefined)).toEqual({ served: WIRE, narrowed: false });
  });

  it('unavailable: a failed pick serves the full wire', () => {
    expect(decide(failed, 2)).toEqual({
      served: WIRE,
      narrowed: false,
      narrowedSkipped: 'unavailable',
    });
  });

  it('unavailable: fewer scored names than N is not a ranking to narrow by', () => {
    expect(decide(ranked('ship'), 2).narrowedSkipped).toBe('unavailable');
  });

  it('too-few: fewer than N + 1 candidates beyond the doors leaves nothing out', () => {
    const r = narrowServed({
      wire: ['read_skill', 'lookup', 'charge'],
      doors: DOORS,
      pick: ranked('lookup', 'charge'),
      top: 2,
      iteration: 2,
      prior: [],
      wrapUpAsked: false,
    });
    expect(r).toEqual({
      served: ['read_skill', 'lookup', 'charge'],
      narrowed: false,
      narrowedSkipped: 'too-few',
    });
  });

  it('after-miss: the call after a miss serves the full wire', () => {
    const r = decide(ranked('ship', 'charge', 'lookup'), 2, {
      prior: [
        { kind: 'outcome', iteration: 1, called: ['invoice'], miss: { wanted: ['invoice'] } },
      ],
    });
    expect(r.narrowedSkipped).toBe('after-miss');
    expect(r.served).toEqual(WIRE);
  });

  it('after-miss reads iteration - 1 only — an older miss with no row for the intervening iteration does not hold', () => {
    const r = decide(ranked('ship', 'charge', 'lookup'), 2, {
      iteration: 3,
      prior: [
        { kind: 'outcome', iteration: 1, called: ['invoice'], miss: { wanted: ['invoice'] } },
        // no row at all for iteration 2 — that call filed no pick, so it filed no outcome.
      ],
    });
    expect(r.narrowed).toBe(true);
    expect(r.narrowedSkipped).toBeUndefined();
  });

  it('after-miss: a miss at exactly iteration - 1 does hold', () => {
    const r = decide(ranked('ship', 'charge', 'lookup'), 2, {
      iteration: 3,
      prior: [
        { kind: 'outcome', iteration: 2, called: ['invoice'], miss: { wanted: ['invoice'] } },
      ],
    });
    expect(r.narrowedSkipped).toBe('after-miss');
    expect(r.served).toEqual(WIRE);
  });

  it('wrap-up: the out-of-budget call never narrows', () => {
    expect(
      decide(ranked('ship', 'charge', 'lookup'), 2, { wrapUpAsked: true }).narrowedSkipped,
    ).toBe('wrap-up');
  });

  it('the app’s own doors are served whatever the ranking says', () => {
    const r = narrowServed({
      wire: WIRE,
      doors: alwaysServedNames(['invoice']),
      pick: ranked('ship', 'charge', 'lookup'),
      top: 2,
      iteration: 2,
      prior: [],
      wrapUpAsked: false,
    });
    expect(r.served).toEqual(['read_skill', 'charge', 'ship', 'invoice', 'skip_step']);
  });
});

describe('the doors', () => {
  it('ALWAYS_SERVED_TOOLS names the owners’ constants — read_skill, list_skills, skip_step, present', () => {
    const skills = [defineSkill({ id: 'a', description: 'a', body: 'A' })];
    const readSkill = buildReadSkillTool(skills)!.schema.name;
    const listSkills = buildListSkillsTool(skills)!.schema.name;
    expect(ALWAYS_SERVED_TOOLS).toEqual([
      readSkill,
      listSkills,
      SKIP_STEP_TOOL_NAME,
      PRESENT_TOOL_NAME,
    ]);
    expect(Object.isFrozen(ALWAYS_SERVED_TOOLS)).toBe(true);
  });
});
