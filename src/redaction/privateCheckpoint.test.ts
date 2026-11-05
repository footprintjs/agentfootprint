import { describe, expect, it } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';
import { addPrivateRecordFields, PRIVATE_FIELDS_KEY } from './privateFields.js';
import {
  nonPrivateMarksOf,
  checkpointWithPrivateFields,
  privateFieldsOfCheckpoint,
  privateResumeOf,
  resumePoliciesOf,
} from './privateCheckpoint.js';
import {
  adoptMemberRedaction,
  declarationOf,
  declarePrivateFields,
  declareRedaction,
  privateFieldsDeclaredBy,
} from './declared.js';

import { DECLARED_NONE } from './coverage.js';

const cp = (extra: object = {}) => ({ sharedState: {}, ...extra } as FlowchartCheckpoint);
describe('private checkpoint names do not become caller coverage', () => {
  it('keeps absent-private checkpoint identity and legacy marks unchanged', () => {
    const checkpoint = cp({ redactionMarks: { keys: ['author-secret'] } });
    expect(checkpointWithPrivateFields(checkpoint, undefined)).toBe(checkpoint);
    expect(privateFieldsOfCheckpoint(checkpoint)).toBeUndefined();
    expect(nonPrivateMarksOf(checkpoint)).toBe(checkpoint.redactionMarks);
  });
  it('carries finite names without changing raw computation values', () => {
    const fields = addPrivateRecordFields(undefined, [
      { root: 'argumentAsk', path: 'progress.0.answer' },
    ]);
    const state = { argumentAsk: { progress: [{ answer: 'PRIVATE-fixture' }] } };
    const checkpoint = cp({ sharedState: state });
    const carried = checkpointWithPrivateFields(checkpoint, fields, DECLARED_NONE);
    expect(carried.sharedState.argumentAsk).toBe(state.argumentAsk);
    expect(privateFieldsOfCheckpoint(carried)).toEqual(fields);
    expect(checkpoint.sharedState).not.toHaveProperty(PRIVATE_FIELDS_KEY);
  });
  it('subtracts only positively admitted marks and preserves every unknown selector', () => {
    const fields = addPrivateRecordFields(undefined, [
      { root: 'argumentAsk', path: 'progress.0.answer' },
    ]);
    const checkpoint = checkpointWithPrivateFields(
      cp({
        redactionMarks: {
          keys: [PRIVATE_FIELDS_KEY, 'author-secret'],
          fields: { argumentAsk: ['progress.0.answer', 'progress.1.answer'], foreign: ['value'] },
        },
      }),
      fields,
      DECLARED_NONE,
    );
    expect(nonPrivateMarksOf(checkpoint)).toEqual({
      keys: ['author-secret'],
      fields: {
        argumentAsk: ['progress.1.answer'],
        foreign: ['value'],
      },
    });
  });
  it('refuses malformed/accessor carriers without invoking accessors', () => {
    let reads = 0;
    const sharedState = Object.defineProperty({}, PRIVATE_FIELDS_KEY, {
      get() {
        reads++;
        return {};
      },
    });
    expect(() => privateFieldsOfCheckpoint(cp({ sharedState }))).toThrow();
    expect(reads).toBe(0);
    for (const carrier of [
      { version: 2, keys: [], fields: {} },
      { version: 1, keys: ['history'], fields: {} },
      { version: 1, keys: [], fields: {}, caller: false },
    ])
      expect(() =>
        privateFieldsOfCheckpoint(cp({ sharedState: { [PRIVATE_FIELDS_KEY]: carrier } })),
      ).toThrow();
  });
  it('propagates construction capability independently of caller coverage', () => {
    const child = {},
      parent = {},
      ordinary = {};
    for (const runner of [child, parent, ordinary]) declareRedaction(runner, undefined);
    declarePrivateFields(child);
    adoptMemberRedaction(parent, [child, ordinary]);
    expect(privateFieldsDeclaredBy(parent)).toEqual({ version: 1, keys: [], fields: {} });
    expect(declarationOf(parent)).toEqual({ state: 'declared-none' });
    expect(privateFieldsDeclaredBy(ordinary)).toBeUndefined();
  });
});

it('private resume keeps unknown marks record-only while legacy caller policy unions stay unchanged', () => {
  const raw = cp({ redactionMarks: { keys: ['author-mark'] } });
  const privateCheckpoint = checkpointWithPrivateFields(
    raw,
    addPrivateRecordFields(undefined, []),
    DECLARED_NONE,
  );
  expect(privateResumeOf(raw)).toEqual({});
  expect(privateResumeOf(privateCheckpoint).recordMarks).toEqual({ keys: ['author-mark'] });
  expect(resumePoliciesOf(privateCheckpoint, undefined, undefined)).toEqual({
    caller: undefined,
    serving: { keys: ['author-mark'] },
  });
  expect(resumePoliciesOf(raw, undefined, undefined)).toEqual({
    caller: { keys: ['author-mark'] },
    serving: { keys: ['author-mark'] },
  });
});
