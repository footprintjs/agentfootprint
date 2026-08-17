/**
 * A contract checker must not die without naming the contract.
 *
 * Reported from the field: adding a twentieth skill made `checkSkillContract`
 * throw `Cannot read properties of undefined (reading 'replace')` from inside a
 * regex helper — naming neither the skill under check nor the missing tool. The
 * hole was in the tool list handed to the checker, not in any skill's own tools,
 * so every "check your skills" instinct led away from it.
 */
import { describe, expect, it } from 'vitest';
import { checkSkillContract } from '../../../src/lib/injection-engine/skillContract.js';

const skill = {
  id: 'zone_triage',
  inject: { systemPrompt: 'Call check_zone() first.', tools: [{ schema: { name: 'check_zone' } }] },
} as never;

describe('checkSkillContract with a hole in knownTools', () => {
  it('reports instead of throwing, and names the skill', () => {
    const problems = checkSkillContract(
      skill,
      new Set(['check_zone', undefined as never, 'other_tool']),
    );
    const hole = problems.find((p) => p.code === 'unusable-tool-name');
    expect(hole, 'a hole in knownTools produced no problem').toBeDefined();
    expect(hole!.skill).toBe('zone_triage');
    expect(hole!.message).toContain('zone_triage');
  });

  it('still checks the rest of the contract rather than bailing at the hole', () => {
    const problems = checkSkillContract(skill, new Set([undefined as never, 'other_tool']));
    expect(problems.length).toBeGreaterThanOrEqual(1);
  });
});
