import { expectTypeOf, it } from 'vitest';
import type { PrivateRecordFields } from '../redaction/privateFields.js';
import type { RunRedaction } from '../redaction/runRedaction.js';
import type { RunnerCoreValues } from './runnerCoreValues.js';

it('keeps live policy ownership distinct from finite private checkpoint names', () => {
  expectTypeOf<RunnerCoreValues['privateFields']>().toEqualTypeOf<
    PrivateRecordFields | undefined
  >();
  expectTypeOf<RunnerCoreValues['redaction']>().toEqualTypeOf<RunRedaction | undefined>();
  expectTypeOf<PrivateRecordFields>().not.toMatchTypeOf<RunRedaction>();
});
