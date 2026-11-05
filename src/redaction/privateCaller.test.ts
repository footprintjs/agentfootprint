import { describe, expect, it } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';
import { addPrivateRecordFields, PRIVATE_FIELDS_KEY } from './privateFields.js';
import { PRIVATE_CALLER_NONE, checkpointOwnValue, readPrivateCaller } from './privateCaller.js';
import {
  callerOfCheckpoint,
  checkpointWithPrivateFields,
  privateFieldsOfCheckpoint,
} from './privateCheckpoint.js';
import { DECLARED_NONE, UNKNOWN_COVERAGE, coverageOfOpenedRun } from './coverage.js';
import { carriedRunPolicy } from './conversation.js';

const fields = addPrivateRecordFields(undefined, []);
const cp = (sharedState: object = {}) => ({ sharedState } as FlowchartCheckpoint);

describe('explicit caller-none checkpoint declaration', () => {
  it('does not infer none from absent/null caller state or a private carrier', () => {
    for (const value of [undefined, null])
      expect(readPrivateCaller(value, fields)).toEqual({ state: 'absent' });
    expect(callerOfCheckpoint(cp({ [PRIVATE_FIELDS_KEY]: fields }))).toEqual({ state: 'absent' });
    expect(readPrivateCaller(PRIVATE_CALLER_NONE, fields)).toEqual({ state: 'none' });
    expect(() => readPrivateCaller(PRIVATE_CALLER_NONE, undefined)).toThrow();
  });
  it('refuses every malformed none declaration and a none/policy mixture', () => {
    for (const value of [
      {},
      { caller: 'none' },
      { version: 1 },
      { version: 2, caller: 'none' },
      { version: 1, caller: null },
      { version: 1, caller: false },
      { version: 1, caller: 'NONE' },
      { version: 1, caller: 'none', keys: ['history'] },
      { version: 1, caller: 'none', vocabulary: 'caller-policy' },
    ]) {
      if (Object.keys(value).length === 0)
        expect(readPrivateCaller(value, fields)).toEqual({ state: 'policy', value: {} });
      else expect(() => readPrivateCaller(value, fields)).toThrow();
    }
  });
  it('never executes ordinary accessors on checkpoint, state, declaration, policy or carrier', () => {
    let reads = 0;
    const getter = {
      enumerable: true,
      get() {
        reads++;
        return 'none';
      },
    };
    const declaration = Object.defineProperty({ version: 1 }, 'caller', getter);
    const state = Object.defineProperty({ [PRIVATE_FIELDS_KEY]: fields }, 'runRedaction', getter);
    const checkpoint = Object.defineProperty({}, 'sharedState', getter) as FlowchartCheckpoint;
    const policy = { fields: Object.defineProperty({}, 'history', getter) };
    expect(() => readPrivateCaller(declaration, fields)).toThrow();
    expect(() => callerOfCheckpoint(cp(state))).toThrow();
    expect(() => callerOfCheckpoint(checkpoint)).toThrow();
    expect(() => readPrivateCaller(policy, fields)).toThrow();
    expect(() =>
      privateFieldsOfCheckpoint(cp(Object.defineProperty({}, PRIVATE_FIELDS_KEY, getter))),
    ).toThrow();
    expect(reads).toBe(0);
  });
  it('rejects inherited, non-enumerable, symbolic and explicitly undefined carrier data', () => {
    expect(() => readPrivateCaller(Object.create(PRIVATE_CALLER_NONE), fields)).toThrow();
    expect(() =>
      readPrivateCaller(
        Object.defineProperty({ version: 1 }, 'caller', {
          value: 'none',
          enumerable: false,
        }),
        fields,
      ),
    ).toThrow();
    expect(() =>
      readPrivateCaller({ ...PRIVATE_CALLER_NONE, [Symbol('extra')]: true }, fields),
    ).toThrow();
    expect(() => privateFieldsOfCheckpoint(cp({ [PRIVATE_FIELDS_KEY]: undefined }))).toThrow();
  });
  it('writes none only from positive caller-none coverage and requires known coverage', () => {
    const input = cp();
    expect(() => checkpointWithPrivateFields(input, fields)).toThrow();
    expect(() => checkpointWithPrivateFields(input, fields, UNKNOWN_COVERAGE)).toThrow();
    const privateOnly = checkpointWithPrivateFields(input, fields, DECLARED_NONE);
    expect(privateOnly.sharedState.runRedaction).toEqual(PRIVATE_CALLER_NONE);
    const policy = { keys: ['history', 'pausedCheckInArgs'] };
    const covered = checkpointWithPrivateFields(privateOnly, fields, coverageOfOpenedRun(policy));
    expect(covered.sharedState.runRedaction).toEqual(carriedRunPolicy(policy));
    expect(() => checkpointWithPrivateFields(covered, fields, DECLARED_NONE)).toThrow();
    expect(input.sharedState).toEqual({});
    expect(checkpointWithPrivateFields(input, undefined)).toBe(input);
  });
  it('ignores unrelated data without invoking an unrelated state accessor', () => {
    let reads = 0;
    const state = Object.defineProperty({ runRedaction: PRIVATE_CALLER_NONE }, 'unrelated', {
      enumerable: true,
      get() {
        reads++;
        return 'private-unrelated';
      },
    });
    expect(checkpointOwnValue(state, 'runRedaction')).toEqual(PRIVATE_CALLER_NONE);
    const out = checkpointWithPrivateFields(cp(state), fields, DECLARED_NONE);
    expect(callerOfCheckpoint(out)).toEqual({ state: 'none' });
    expect(reads).toBe(0);
  });
});
