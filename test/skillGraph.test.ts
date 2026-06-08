/**
 * skillGraph (proposal 002) — declarative skill-dependency graph.
 *
 * Covers: edge → trigger compilation (unit), activation through the REAL engine
 * evaluator (integration), the `toMermaid()` drawing, and guardrails.
 */

import { describe, it, expect } from 'vitest';
import { skillGraph, defineSkill, defineInstruction } from '../src/index.js';
import { evaluateInjections } from '../src/lib/injection-engine/index.js';
import type { InjectionContext } from '../src/lib/injection-engine/types.js';

const skill = (id: string, body = `${id} body`) =>
  defineSkill({ id, description: `use ${id}`, body });

const ctx = (over: Partial<InjectionContext>): InjectionContext => ({
  iteration: 1,
  userMessage: 'q',
  history: [],
  activatedInjectionIds: [],
  ...over,
});

describe('skillGraph — edge → trigger compilation', () => {
  it('entry (no when) → always; entry (when) → rule', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .entry(a)
      .entry(b, { when: (c) => c.iteration === 1 })
      .build();
    expect(g.skills.find((s) => s.id === 'a')!.trigger.kind).toBe('always');
    expect(g.skills.find((s) => s.id === 'b')!.trigger.kind).toBe('rule');
  });

  it('route onToolReturn → on-tool-return trigger; route when → rule over lastToolResult', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'lookup' })
      .route(a, c, { when: (r) => r.toolName === 'probe' && r.result.includes('hit') })
      .build();

    const tb = g.skills.find((s) => s.id === 'b')!.trigger;
    expect(tb.kind).toBe('on-tool-return');
    expect((tb as { toolName: string }).toolName).toBe('lookup');

    const tc = g.skills.find((s) => s.id === 'c')!.trigger;
    expect(tc.kind).toBe('rule');
    const fire = (tc as { activeWhen: (c: InjectionContext) => boolean }).activeWhen;
    expect(fire(ctx({ lastToolResult: { toolName: 'probe', result: 'a hit' } }))).toBe(true);
    expect(fire(ctx({ lastToolResult: { toolName: 'probe', result: 'miss' } }))).toBe(false);
    expect(fire(ctx({}))).toBe(false); // no tool result yet
  });

  it('a skill with no deterministic incoming edge keeps its default llm-activated trigger', () => {
    const a = skill('a');
    const c = skill('c');
    const g = skillGraph().entry(a).route(a, c).build(); // bare route = model-reachable
    expect(g.skills.find((s) => s.id === 'c')!.trigger.kind).toBe('llm-activated');
  });

  it('guards: route with both when+onToolReturn throws; non-skill throws', () => {
    const a = skill('a');
    const b = skill('b');
    expect(() => skillGraph().route(a, b, { when: () => true, onToolReturn: 'x' })).toThrow();
    const instr = defineInstruction({ id: 'i', prompt: 'p', activeWhen: () => true });
    expect(() => skillGraph().entry(instr as never)).toThrow(/not a skill/);
  });
});

describe('skillGraph — activation through the real evaluator', () => {
  it('entry active at start; routed skill activates only when its predicate fires', () => {
    const triage = skill('triage');
    const sfp = skill('sfp', 'SFP DEEP DIVE');
    const g = skillGraph()
      .entry(triage)
      .route(triage, sfp, { when: (r) => r.toolName === 'probe' && JSON.parse(r.result).crc > 0 })
      .build();

    // iteration 1, no tool result → only the entry is active
    const e1 = evaluateInjections(g.skills, ctx({ iteration: 1 }));
    expect(e1.active.map((i) => i.id)).toEqual(['triage']);

    // after probe returns crc>0 → entry (always) + sfp (rule fired)
    const e2 = evaluateInjections(
      g.skills,
      ctx({ iteration: 2, lastToolResult: { toolName: 'probe', result: '{"crc":5}' } }),
    );
    expect(e2.active.map((i) => i.id).sort()).toEqual(['sfp', 'triage']);
    // the activated skill carries its body into the slot
    expect(e2.active.find((i) => i.id === 'sfp')!.inject.systemPrompt).toContain('SFP DEEP DIVE');

    // crc==0 → sfp stays dormant (token-efficient: not loaded)
    const e3 = evaluateInjections(
      g.skills,
      ctx({ iteration: 2, lastToolResult: { toolName: 'probe', result: '{"crc":0}' } }),
    );
    expect(e3.active.map((i) => i.id)).toEqual(['triage']);
  });
});

describe('skillGraph — toMermaid (declared === drawn)', () => {
  it('renders nodes, a start, solid deterministic edges and dashed model edges', () => {
    const a = skill('mds-interface-issues');
    const b = skill('sfp');
    const c = skill('io-profile');
    const m = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'get_counters', label: 'CRC>0' })
      .route(a, c) // model edge
      .build()
      .toMermaid();

    expect(m).toContain('flowchart TD');
    expect(m).toContain('__start__');
    expect(m).toContain('["mds-interface-issues"]'); // original id as label
    expect(m).toContain('|CRC>0|'); // edge caption
    expect(m).toContain('-->'); // deterministic edge solid
    expect(m).toContain('-.->'); // model edge dashed
  });
});
