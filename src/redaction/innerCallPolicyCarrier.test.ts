import type { FlowchartCheckpoint } from 'footprintjs';
import { describe, expect, it, vi } from 'vitest';
import {
  innerCallPolicyFor,
  innerCallPolicyOf,
  innerCallPolicyReferences,
} from './innerCallPolicyCarrier.js';
import { privateFieldsOfCheckpoint } from './privateCheckpoint.js';
import { addPrivateRecordFields } from './privateFields.js';

const REF = '00000000-0000-4000-8000-000000000001';
const OLD_REF = '00000000-0000-4000-8000-000000000002';
const ARGUMENTS = { account: 'fixture-swatch' };
const row = { toolCallId: 'fixture#inner-1', toolName: 'swatch', args: { account: 'REDACTED' } };
const history = (call: object) => [{ role: 'tool', content: 'Done.', calls: [call] }];
const marked = addPrivateRecordFields(undefined, [{ root: 'innerCallPolicyArgs', path: '' }]);

describe('the inner-call policy carrier shape', () => {
  it('copies detached data and keeps only references in the selected checkpoint history', () => {
    const input = { [REF]: { ...ARGUMENTS }, [OLD_REF]: { sample: 'unused' } };
    const saved = innerCallPolicyFor(
      { innerCallPolicyArgs: input },
      history({ ...row, policyArgsRef: REF }),
    );
    input[REF].account = 'later';
    expect(saved).toEqual({ [REF]: ARGUMENTS });
    expect(innerCallPolicyFor({ innerCallPolicyArgs: input }, [])).toBeUndefined();
  });

  it('distinguishes an absent legacy mark from a protected reference', () => {
    expect(innerCallPolicyOf({})).toBeUndefined();
    expect([...innerCallPolicyReferences(history(row))]).toEqual([]);
    expect([...innerCallPolicyReferences(history({ ...row, policyArgsRef: REF }))]).toEqual([REF]);
    expect(() => innerCallPolicyReferences(history({ ...row, policyArgsRef: 1 }))).toThrow(
      'Invalid checkpoint inner-call policy arguments.',
    );
  });

  it('reads only own data and fails with a fixed message', () => {
    const get = vi.fn(() => ARGUMENTS);
    const nonData = Object.defineProperty({}, REF, { get });
    for (const innerCallPolicyArgs of [null, [], nonData, { [REF]: [1] }, { other: ARGUMENTS }]) {
      expect(() => innerCallPolicyOf({ innerCallPolicyArgs })).toThrow(
        'Invalid checkpoint inner-call policy arguments.',
      );
    }
    expect(get).not.toHaveBeenCalled();
  });
});

it('validates private metadata in a native mounted checkpoint state', () => {
  const native = {
    sharedState: {},
    subflowStates: {
      fixture: { privateRecordFields: marked, innerCallPolicyArgs: { [REF]: ARGUMENTS } },
    },
  } as unknown as FlowchartCheckpoint;
  expect(() => privateFieldsOfCheckpoint(native)).not.toThrow();
  const unmarked = {
    ...native,
    subflowStates: { fixture: { innerCallPolicyArgs: { [REF]: ARGUMENTS } } },
  };
  expect(() => privateFieldsOfCheckpoint(unmarked)).toThrow(
    'The native checkpoint must keep inner-call policy arguments private.',
  );
});
