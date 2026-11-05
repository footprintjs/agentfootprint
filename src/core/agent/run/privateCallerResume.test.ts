import { expect, it } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';
import { carriedRunPolicy } from '../../../redaction/conversation.js';
import { DECLARED_NONE, coverageOfOpenedRun } from '../../../redaction/coverage.js';
import { PRIVATE_CALLER_NONE } from '../../../redaction/privateCaller.js';
import {
  checkpointWithPrivateFields,
  nonPrivateMarksOf,
  privateResumeOf,
} from '../../../redaction/privateCheckpoint.js';
import { addPrivateRecordFields, PRIVATE_FIELDS_KEY } from '../../../redaction/privateFields.js';
import { resumeRedactionOf } from './resumeRedaction.js';

const checkpoint = () =>
  ({
    sharedState: {},
    redactionMarks: { keys: ['author-mark'] },
  } as FlowchartCheckpoint);
const fields = addPrivateRecordFields(undefined, []);

it('requires the explicit declaration even when every native mark is library-private', () => {
  const original = checkpointWithPrivateFields(
    { sharedState: {}, redactionMarks: { keys: [PRIVATE_FIELDS_KEY] } } as FlowchartCheckpoint,
    fields,
    DECLARED_NONE,
  );
  expect(resumeRedactionOf(original, [])).toBeUndefined();
  delete original.sharedState.runRedaction;
  expect(() => resumeRedactionOf(original, [])).toThrowError(
    expect.objectContaining({ reason: 'missing' }),
  );
});

it('preserves unknown native marks record-only with explicit private caller:none', () => {
  const value = checkpointWithPrivateFields(checkpoint(), fields, DECLARED_NONE);
  expect(resumeRedactionOf(value, [])).toBeUndefined();
  expect(nonPrivateMarksOf(value)).toEqual({ keys: ['author-mark'] });
  expect(privateResumeOf(value).recordMarks).toEqual({ keys: ['author-mark'] });
});
it('a private carrier never substitutes for the deleted saved caller policy', () => {
  const policy = { keys: ['history', 'pausedCheckInArgs'] };
  const original = checkpointWithPrivateFields(checkpoint(), fields, coverageOfOpenedRun(policy));
  expect(resumeRedactionOf(original, [policy])).toEqual(policy);
  for (const trusted of [[], [policy]]) {
    const altered = structuredClone(original);
    delete altered.sharedState.runRedaction;
    expect(() => resumeRedactionOf(altered, trusted)).toThrowError(
      expect.objectContaining({ reason: 'missing' }),
    );
  }
  expect(original.sharedState.runRedaction).toEqual(carriedRunPolicy(policy));
});
it('keeps legacy missing-policy refusal and permits an ordinary unmarked legacy checkpoint', () => {
  expect(() => resumeRedactionOf(checkpoint(), [])).toThrowError(
    expect.objectContaining({ reason: 'missing' }),
  );
  expect(resumeRedactionOf({ sharedState: {} } as FlowchartCheckpoint, [])).toBeUndefined();
});
it('requires a valid private carrier to admit caller:none', () => {
  for (const carrier of [undefined, null, { version: 2, keys: [], fields: {} }]) {
    const value = checkpoint();
    value.sharedState.runRedaction = PRIVATE_CALLER_NONE;
    if (carrier !== undefined) value.sharedState[PRIVATE_FIELDS_KEY] = carrier;
    expect(() => resumeRedactionOf(value, [])).toThrowError(
      expect.objectContaining({ reason: 'unreadable' }),
    );
  }
});
it('refuses malformed or mixed none declarations instead of treating them as absent', () => {
  for (const declaration of [
    { caller: 'none' },
    { version: 1, caller: false },
    { version: 1, caller: 'none', keys: ['history'] },
    {},
  ]) {
    const value = checkpointWithPrivateFields(checkpoint(), fields, DECLARED_NONE);
    value.sharedState.runRedaction = declaration;
    expect(() => resumeRedactionOf(value, [])).toThrowError(
      expect.objectContaining({ reason: 'unreadable' }),
    );
  }
});
it('does not execute getters while refusing a caller declaration', () => {
  let reads = 0;
  const value = checkpointWithPrivateFields(checkpoint(), fields, DECLARED_NONE);
  Object.defineProperty(value.sharedState, 'runRedaction', {
    enumerable: true,
    get() {
      reads++;
      return PRIVATE_CALLER_NONE;
    },
  });
  expect(() => resumeRedactionOf(value, [])).toThrowError(
    expect.objectContaining({ reason: 'unreadable' }),
  );
  expect(reads).toBe(0);
});
