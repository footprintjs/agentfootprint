import { expect, it } from 'vitest';
import { refuseExport } from './index.js';
import { ContextRecordingError } from '../types.js';

it('raises the prepared named refusal without an inline fallback', () => {
  const failure = new ContextRecordingError('value-omitted');
  expect(refuseExport({ failure })).toThrow(failure);
});
