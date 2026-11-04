import { expect, it } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';
import { carriedRunPolicy } from '../../../redaction/conversation.js';
import {
  checkpointWithPrivateFields,
  nonPrivateMarksOf,
} from '../../../redaction/privateCheckpoint.js';
import { addPrivateRecordFields } from '../../../redaction/privateFields.js';
import { resumeRedactionOf } from './resumeRedaction.js';

const checkpoint = () =>
  ({ sharedState: {}, redactionMarks: { keys: ['author-mark'] } } as FlowchartCheckpoint);
it('unknown marks on a private-only checkpoint are not misreported as caller policy', () => {
  const value = checkpointWithPrivateFields(checkpoint(), addPrivateRecordFields(undefined, []));
  expect(resumeRedactionOf(value, [])).toBeUndefined();
  expect(nonPrivateMarksOf(value)).toEqual({ keys: ['author-mark'] });
});
it('a legacy marked checkpoint still requires its saved caller policy', () => {
  expect(() => resumeRedactionOf(checkpoint(), [])).toThrowError(
    expect.objectContaining({ reason: 'missing' }),
  );
});
it('preserves a real caller policy independently of private and unknown marks', () => {
  const policy = { keys: ['caller-secret'] };
  const value = checkpointWithPrivateFields(
    { ...checkpoint(), sharedState: { runRedaction: carriedRunPolicy(policy) } },
    addPrivateRecordFields(undefined, []),
  );
  expect(resumeRedactionOf(value, [policy])).toEqual(policy);
  expect(nonPrivateMarksOf(value)).toEqual({ keys: ['author-mark'] });
});
