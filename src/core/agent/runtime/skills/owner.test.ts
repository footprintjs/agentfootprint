import { expect, it } from 'vitest';
import { defineSkill } from '../../../../injection-engine/factories/defineSkill.js';
import { AgentConfigurationValues } from '../configuration/values.js';
import { openSkillIds } from './owner.js';

it('keeps independent activated skills open and excludes graph edge targets', () => {
  const configuration = new AgentConfigurationValues();
  configuration.injections = ['graph-target', 'independent'].map((id) =>
    defineSkill({ id, description: id, body: 'Local procedure.' }),
  );
  configuration.skillGraphEdgeTargets = new Set(['graph-target']);
  expect(openSkillIds.call({ configuration })).toEqual(['independent']);
});
