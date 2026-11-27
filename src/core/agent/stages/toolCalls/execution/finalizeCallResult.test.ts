import { describe, expect, it } from 'vitest';
import { defineSkill } from '../../../../../injection-engine/factories/defineSkill.js';
import { buildReadSkillTool } from '../../../../../injection-engine/skillTools.js';
import { skillActivationConfirmation } from '../../../../../injection-engine/skillBodyEvidence.js';
import { finalizeCallResult } from './finalizeCallResult.js';

const SKILL_ID = 'reports';
const BODY = 'Read the weekly report.';
const tool = buildReadSkillTool([
  defineSkill({
    id: SKILL_ID,
    description: 'Reporting procedure.',
    body: BODY,
    surfaceMode: 'both',
  }),
]);
type FinalizeParameters = Parameters<typeof finalizeCallResult>;

function finalize(result: string, flags: { error?: boolean; denied?: boolean } = {}) {
  const operations = {
    afterMoment: async () => undefined,
    placeResults: async (_scope: unknown, _call: unknown, results: unknown) => results,
    noticeEmptyLookup: () => undefined,
    capResults: (_toolName: string, results: unknown) => results,
  } as FinalizeParameters[1];

  const frame = {
    tool,
    tc: { id: 'call-1', name: 'read_skill', callOccurrenceKey: [1, 2, 3, 4, 0] },
    batch: { newHistory: [], env: {}, iteration: 1 },
    callArguments: { callArgs: { id: SKILL_ID } },
    execution: {
      executed: true,
      toolResultExecution: flags.error ? 'threw' : 'returned',
      denied: flags.denied ?? false,
    },
    outcome: { result, error: flags.error ?? false },
    skillRejected: false,
    sourceEvidenceArmed: false,
    libraryBody: true,
  } as FinalizeParameters[2];
  return finalizeCallResult({} as FinalizeParameters[0], operations, frame);
}

describe('read_skill result provenance at delivery', () => {
  it('records the returned definition and its exact served span', async () => {
    expect((await finalize(BODY)).toolSkillBody).toMatchObject({
      skillId: SKILL_ID,
      span: { start: 0, length: BODY.length },
    });
  });

  it('does not give an activation confirmation a body record', async () => {
    const confirmation = skillActivationConfirmation(SKILL_ID);
    const result = await finalize(confirmation);
    expect(result.modelResult).toBe(confirmation);
    expect(result.toolSkillBody).toBeUndefined();
  });

  it('does not give refused or failed results a body record', async () => {
    expect((await finalize('Denied.', { denied: true })).toolSkillBody).toBeUndefined();
    expect((await finalize('Failed.', { error: true })).toolSkillBody).toBeUndefined();
  });
});
