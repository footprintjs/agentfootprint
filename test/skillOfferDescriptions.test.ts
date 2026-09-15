import { describe, expect, it } from 'vitest';
import { buildReadSkillTool, defineMenuHint, defineSkill } from '../src/injection-engine.js';

const skill = (id: string, description = `${id} unique description`) =>
  defineSkill({ id, description, body: `${id} body` });
const skills = [skill('alpha'), skill('beta'), skill('gamma')];
const occurrences = (text: string, phrase: string) => text.split(phrase).length - 1;

describe('read_skill describes each visible skill once per offer', () => {
  it('keeps candidate order, scores and off-menu choices without repeating descriptions', () => {
    const tool = buildReadSkillTool(skills, {
      grantable: ['alpha', 'beta', 'gamma'],
      menu: {
        candidates: [
          { id: 'beta', relevance: 0.6 },
          { id: 'alpha', relevance: 0.4 },
        ],
      },
    })!;
    const d = tool.schema.description;
    for (const s of skills) expect(occurrences(d, s.description!)).toBe(1);
    expect(d.indexOf('beta unique description')).toBeLessThan(
      d.indexOf('alpha unique description'),
    );
    expect(d).toContain('relevance ~60%');
    expect(d).toContain('relevance ~40%');
    const reachable = d.split('Reachable from here:')[1]!;
    for (const s of skills) expect(reachable).toContain(s.id);
    expect(reachable).toContain('  - beta\n');
    expect(d).not.toContain('Nothing is reachable');
    expect(tool.schema.inputSchema).toEqual(buildReadSkillTool(skills)!.schema.inputSchema);
  });

  it('keeps equal descriptions on different skill IDs', () => {
    const same = [skill('alpha', 'same description'), skill('beta', 'same description')];
    const d = buildReadSkillTool(same, {
      grantable: ['alpha', 'beta'],
      menu: { candidates: [{ id: 'alpha' }, { id: 'beta' }] },
    })!.schema.description;
    expect(occurrences(d, 'same description')).toBe(2);
    expect(d).toContain('alpha: same description');
    expect(d).toContain('beta: same description');
  });

  it('does not claim a scorer ran for a caller-supplied menu', () => {
    const d = buildReadSkillTool(skills, {
      menu: { candidates: [{ id: 'alpha' }] },
    })!.schema.description;
    expect(d).not.toMatch(
      /closest|offline scorer ranked|no declared rule or intent decisively matched/i,
    );
    expect(d).not.toContain('relevance');
    for (const s of skills) expect(occurrences(d, s.description!)).toBe(1);
    expect(defineMenuHint().inject.systemPrompt).not.toMatch(
      /closest|scorer left|cannot see the conversation/i,
    );
  });

  it('retains a menu cursor description and stay instruction, without calling it unreachable', () => {
    const d = buildReadSkillTool(skills, {
      cursorId: 'alpha',
      grantable: ['beta', 'gamma'],
      menu: { candidates: [{ id: 'alpha' }, { id: 'beta' }], stay: true },
    })!.schema.description;
    expect(d).toContain("You are in 'alpha'.");
    expect(d).toContain("stay in 'alpha'");
    for (const s of skills) expect(occurrences(d, s.description!)).toBe(1);
    expect(d).not.toContain('Not reachable from here');
  });

  it('keeps refusal membership even when the candidate was already described', () => {
    const d = buildReadSkillTool(skills, {
      grantable: ['beta'],
      menu: { candidates: [{ id: 'alpha' }] },
    })!.schema.description;
    for (const s of skills) expect(occurrences(d, s.description!)).toBe(1);
    const refused = d.split('Not reachable from here')[1]!;
    expect(refused).toContain('alpha');
    expect(refused).toContain('gamma');
    expect(refused).not.toContain('beta');
  });

  it('filters hidden and unknown menu rows before rendering references', () => {
    const d = buildReadSkillTool(skills, {
      cursorId: 'alpha',
      hiddenIds: ['alpha', 'beta'],
      grantable: ['beta'],
      menu: { candidates: [{ id: 'alpha' }, { id: 'beta' }, { id: 'unknown' }], stay: true },
    })!.schema.description;
    expect(d).not.toMatch(/alpha|beta|unknown|described above|Nothing is reachable/);
    expect(occurrences(d, 'gamma unique description')).toBe(1);
  });

  it('keeps the open tree skill visible when also in a menu', () => {
    const d = buildReadSkillTool(skills, {
      treeRouted: true,
      grantable: ['gamma'],
      menu: { candidates: [{ id: 'gamma' }] },
    })!.schema.description;
    expect(occurrences(d, 'gamma unique description')).toBe(1);
    expect(d.split('What a pick CAN open')[1]).toContain('gamma');
    expect(d).toContain('decision TREE');
  });

  it('describes repeated candidate IDs once while retaining their supplied scores', () => {
    const d = buildReadSkillTool(skills, {
      menu: {
        candidates: [
          { id: 'alpha', relevance: 0.8 },
          { id: 'alpha', relevance: 0.2 },
        ],
      },
    })!.schema.description;
    expect(occurrences(d, 'alpha unique description')).toBe(1);
    expect(d).toContain('relevance ~80%');
    expect(d).toContain('relevance ~20%');
  });

  it('does not retain described IDs between requests or alter the no-menu offer', () => {
    const plain = buildReadSkillTool(skills)!.schema.description;
    const offer = { grantable: ['alpha', 'beta', 'gamma'] };
    const before = buildReadSkillTool(skills, offer)!.schema.description;
    const menu = { ...offer, menu: { candidates: [{ id: 'alpha' }] } };
    expect(buildReadSkillTool(skills, menu)!.schema.description).toBe(
      buildReadSkillTool(skills, menu)!.schema.description,
    );
    expect(buildReadSkillTool(skills, offer)!.schema.description).toBe(before);
    expect(buildReadSkillTool(skills)!.schema.description).toBe(plain);
    for (const s of skills) expect(occurrences(before, s.description!)).toBe(1);
  });
});
