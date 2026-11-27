import { describe, expect, it } from 'vitest';
import { defineSkill } from '../../../injection-engine/factories/defineSkill.js';
import { buildReadSkillTool } from '../../../injection-engine/skillTools.js';
import { defineTool } from '../../../tools/tools.js';
import { skillReadArgumentIssue } from './readSkillArguments.js';

const entries = ['reports', 'inventory'].map((id) =>
  defineSkill({
    id,
    description: 'A local test skill.',
    body: 'Read the synthetic record.',
  }),
);
const read = buildReadSkillTool(entries)!;
const offered = buildReadSkillTool(entries.slice(0, 1))!.schema;
const allowed = { hiddenSkillIds: ['inventory'] };
const expected = { path: 'id', expected: 'an offered skill id', got: 'string' };

describe('skill selection validation', () => {
  it('allows an offered selection and gives excluded selections one diagnostic', () => {
    expect(skillReadArgumentIssue(read, { id: 'reports' }, allowed, [offered])).toBeUndefined();
    for (const id of ['inventory', 'unregistered']) {
      expect(skillReadArgumentIssue(read, { id }, allowed, [offered])).toEqual(expected);
    }
  });

  it('uses the refreshed view during resume and ignores an outdated offer', () => {
    expect(
      skillReadArgumentIssue(read, { id: 'reports' }, { hiddenSkillIds: ['reports'] }),
    ).toEqual(expected);
    expect(
      skillReadArgumentIssue(read, { id: 'inventory' }, { hiddenSkillIds: ['reports'] }),
    ).toBeUndefined();
  });

  it('requires an available role and a matching offer for model dispatch', () => {
    expect(skillReadArgumentIssue(read, { id: 'reports' }, { hiddenSkillIds: undefined })).toEqual(
      expected,
    );
    expect(skillReadArgumentIssue(read, { id: 'reports' }, allowed, [])).toEqual(expected);
  });

  it('keeps unrestricted calls and an app tool with the same name on normal schema validation', () => {
    const app = defineTool({
      name: 'read_skill',
      description: 'App-owned fixture.',
      inputSchema: { type: 'object' },
      execute: () => 'done',
    });
    expect(skillReadArgumentIssue(read, { id: 'inventory' }, undefined)).toBeUndefined();
    expect(skillReadArgumentIssue(app, {}, allowed)).toBeUndefined();
  });
});
