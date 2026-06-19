/**
 * Skill-body ↔ tool-contract check (Proposal 009 Tier 1).
 *
 * Convention-3 tiers: unit (each check in isolation), functional (a clean skill is
 * silent), integration (via graph.checkup(), incl. the real Neo-style cross-skill
 * handoff), property (clean skills never warn under fuzz), security (no ReDoS).
 */
import { describe, it, expect } from 'vitest';
import {
  defineSkill,
  defineTool,
  skillGraph,
  checkSkillContract,
  checkSkillContracts,
} from '../src/index.js';

const tool = (name: string) =>
  defineTool({
    name,
    description: `do ${name}`,
    inputSchema: { type: 'object' },
    execute: () => 'x',
  });

const skill = (id: string, body: string, tools: ReturnType<typeof tool>[] = []) =>
  defineSkill({ id, description: `use ${id}`, body, tools, autoActivate: 'currentSkill' });

describe('checkSkillContract — unit', () => {
  it('clean skill (body only names its own tools) → no problems', () => {
    const s = skill('triage', 'Call get_status, then get_detail to investigate.', [
      tool('get_status'),
      tool('get_detail'),
    ]);
    expect(checkSkillContract(s)).toEqual([]);
  });

  it('body-unknown-tool: a tool_name(...) reference to a tool that exists nowhere', () => {
    const s = skill('triage', 'Run get_statuz(host) first.', [tool('get_status')]); // typo: get_statuz
    const problems = checkSkillContract(s);
    expect(problems).toHaveLength(1);
    expect(problems[0].code).toBe('body-unknown-tool');
    expect(problems[0].kind).toBe('warning');
    expect(problems[0].message).toContain('get_statuz');
  });

  it('body-foreign-tool: body names a real tool from ANOTHER skill (cross-skill handoff)', () => {
    const esxi = skill('esxi', 'Feed each array_wwn to volume_lookup_by_wwn to resolve it.', [
      tool('rvtools_get_vm_storage'),
    ]);
    const known = new Set(['rvtools_get_vm_storage', 'volume_lookup_by_wwn']);
    const problems = checkSkillContract(esxi, known);
    expect(problems.map((p) => p.code)).toEqual(['body-foreign-tool']);
    expect(problems[0].message).toContain('volume_lookup_by_wwn');
    expect(problems[0].kind).toBe('warning'); // never an error — it's often an intentional handoff
  });

  it('in isolation (no knownTools), a foreign-tool mention is NOT flagged as foreign (only its own tools are "known")', () => {
    const esxi = skill('esxi', 'Then use volume_lookup_by_wwn.', [tool('rvtools_get_vm_storage')]);
    // `volume_lookup_by_wwn(` is not present (no parens) → not unknown-tool; and with no
    // knownTools set it can't be classified foreign → silent. Prose mention only.
    expect(checkSkillContract(esxi)).toEqual([]);
  });
});

describe('checkSkillContracts — integration via graph.checkup()', () => {
  it('a clean graph → checkup ok, no contract warnings', () => {
    const a = skill('a', 'Use get_a.', [tool('get_a')]);
    const b = skill('b', 'Use get_b.', [tool('get_b')]);
    const g = skillGraph().entry(a).route(a, b, { onToolReturn: 'get_a' }).build();
    const c = g.checkup();
    expect(c.problems.filter((p) => p.code.startsWith('body-'))).toEqual([]);
  });

  it('surfaces a cross-skill handoff as a body-foreign-tool WARNING (does not fail ok)', () => {
    // Neo-shaped: esxi's body points at volume-lookup's tool (the real handoff pattern).
    const esxi = skill('esxi-inventory', 'feed each array_wwn to volume_lookup_by_wwn.', [
      tool('rvtools_get_vm_storage'),
    ]);
    const volLookup = skill('volume-lookup', 'Resolve the wwn.', [tool('volume_lookup_by_wwn')]);
    const g = skillGraph()
      .entry(esxi)
      .route(esxi, volLookup, { onToolReturn: 'rvtools_get_vm_storage' })
      .build();
    const c = g.checkup();
    const foreign = c.problems.filter((p) => p.code === 'body-foreign-tool');
    expect(foreign).toHaveLength(1);
    expect(foreign[0].skill).toBe('esxi-inventory');
    expect(foreign[0].message).toContain('volume_lookup_by_wwn');
    expect(c.ok).toBe(true); // warnings never fail the check-up
  });

  it('catches a typo tool call across the whole graph', () => {
    const a = skill('a', 'Call get_aa(x).', [tool('get_a')]); // get_aa does not exist anywhere
    const g = skillGraph().entry(a).build({ check: 'off' });
    const codes = g.checkup().problems.map((p) => p.code);
    expect(codes).toContain('body-unknown-tool');
  });
});

describe('checkSkillContract — property + security', () => {
  it('property: a skill whose body only references its own tools never warns (fuzz)', () => {
    for (let i = 0; i < 100; i++) {
      const names = [`get_x${i % 7}`, `do_y${i % 5}`];
      const body = `First ${names[0]}, then ${names[1]} to finish step ${i}.`;
      const s = skill(`s${i}`, body, names.map(tool));
      expect(checkSkillContract(s, new Set(names))).toEqual([]);
    }
  });

  it('security: a pathological body does not hang the matcher', () => {
    const s = skill('s', '('.repeat(5000) + 'a_b('.repeat(5000), [tool('a_b')]);
    expect(() => checkSkillContract(s, new Set(['a_b']))).not.toThrow();
    expect(checkSkillContracts([s])).toEqual([]); // a_b is known → no unknown-tool
  });
});
