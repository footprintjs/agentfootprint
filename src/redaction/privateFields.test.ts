import { expect, it } from 'vitest';
import { RedactionRule } from 'footprintjs/advanced';
import { jsonBytes } from '../lib/boundedJson.js';
import { unionRedactionPolicies } from './policy.js';
import {
  addPrivateRecordFields,
  PRIVATE_FIELD_LIMITS,
  PRIVATE_FIELD_ROOTS,
  mergePrivateRecordFields,
  privateRecordPolicy,
  readPrivateRecordFields,
} from './privateFields.js';

const selected = () =>
  addPrivateRecordFields(undefined, [
    { root: 'argumentAsk', path: 'progress.0.answer' },
    { root: 'argumentAnswersKept', path: '1.value' },
    { root: 'argumentResolutions', path: '2.fills.1.value' },
    { root: 'pausedCheckInArgs', path: 'account' },
  ]);
const serialized = () => JSON.parse(JSON.stringify(selected()));
const invalid = 'Invalid private record field carrier.';

it('roundtrips exact private fields while retaining neighbouring public values', () => {
  const fields = readPrivateRecordFields(serialized());
  const rule = new RedactionRule(privateRecordPolicy(fields));
  expect(
    rule.retainBoundary({
      argumentAsk: { progress: [{ rounds: 1, answer: 'secret' }], question: 'Public question' },
      argumentAnswersKept: [{ value: 'public' }, { value: 'secret', toolName: 'lookup' }],
      argumentResolutions: [{}, {}, { fills: [{ value: 'public' }, { value: 'secret' }] }],
      pausedCheckInArgs: { account: 'secret', region: 'eu' },
      history: ['public'],
    }),
  ).toEqual({
    argumentAsk: { progress: [{ rounds: 1, answer: '[REDACTED]' }], question: 'Public question' },
    argumentAnswersKept: [{ value: 'public' }, { value: '[REDACTED]', toolName: 'lookup' }],
    argumentResolutions: [{}, {}, { fills: [{ value: 'public' }, { value: '[REDACTED]' }] }],
    pausedCheckInArgs: { account: '[REDACTED]', region: 'eu' },
    history: ['public'],
  });
});

it('an empty private carrier names no policy or caller-coverage state', () => {
  const empty = addPrivateRecordFields(undefined, []);
  expect(empty).toEqual({ version: 1, keys: [], fields: {} });
  expect(privateRecordPolicy(empty)).toBeUndefined();
});

const corruptions: [string, (value: ReturnType<typeof serialized>) => void][] = [
  [
    'version',
    (value: ReturnType<typeof serialized>) => {
      value.version = 2;
    },
  ],
  [
    'missing version',
    (value: ReturnType<typeof serialized>) => {
      delete value.version;
    },
  ],
  [
    'unknown root',
    (value: ReturnType<typeof serialized>) => {
      value.fields.history = ['0.content'];
    },
  ],
  [
    'unknown path',
    (value: ReturnType<typeof serialized>) => {
      value.fields.argumentAsk = ['waiting.requestId'];
    },
  ],
  [
    'duplicate path',
    (value: ReturnType<typeof serialized>) => {
      value.fields.argumentAsk.push('progress.0.answer');
    },
  ],
  [
    'index alias',
    (value: ReturnType<typeof serialized>) => {
      value.fields.argumentAsk = ['progress.00.answer'];
    },
  ],
  [
    'root and field',
    (value: ReturnType<typeof serialized>) => {
      value.keys.push('argumentAsk');
    },
  ],
  [
    'duplicate root',
    (value: ReturnType<typeof serialized>) => {
      value.keys = ['argumentAsk', 'argumentAsk'];
      delete value.fields.argumentAsk;
    },
  ],
  [
    'empty field list',
    (value: ReturnType<typeof serialized>) => {
      value.fields.argumentAsk = [];
    },
  ],
  [
    'oversized path',
    (value: ReturnType<typeof serialized>) => {
      value.fields.pausedCheckInArgs = ['x'.repeat(65536)];
    },
  ],
  [
    'caller flag',
    (value: ReturnType<typeof serialized>) => {
      value.caller = null;
    },
  ],
  [
    'mode flag',
    (value: ReturnType<typeof serialized>) => {
      value.privateOnly = true;
    },
  ],
  [
    'unknown selector',
    (value: ReturnType<typeof serialized>) => {
      value.patterns = [];
    },
  ],
];
it.each(corruptions)(
  'refuses %s provenance without projecting or extending it',
  (_name, change) => {
    const value = serialized();
    change(value);
    expect(() => readPrivateRecordFields(value)).toThrowError(new TypeError(invalid));
    expect(() => privateRecordPolicy(value)).toThrowError(new TypeError(invalid));
    expect(() => addPrivateRecordFields(value, [])).toThrowError(new TypeError(invalid));
  },
);

it.each([undefined, null, [], new Map(), Object.create({ version: 1 }), 'carrier'])(
  'refuses a missing or non-own-data carrier: %j',
  (value) => {
    expect(() => readPrivateRecordFields(value)).toThrowError(new TypeError(invalid));
  },
);

it('refuses accessor provenance without invoking getters or conversion hooks', () => {
  let reads = 0;
  const value = {
    version: 1,
    keys: [],
    get fields() {
      reads++;
      return {};
    },
    toJSON: () => {
      reads++;
      return { version: 1, keys: [], fields: {} };
    },
  };
  expect(() => readPrivateRecordFields(value)).toThrowError(new TypeError(invalid));
  expect(reads).toBe(0);
});

it('refuses sparse or accessor lists without consuming their entries', () => {
  let reads = 0;
  const sparse = serialized();
  sparse.fields.argumentAsk = Array(1);
  expect(() => readPrivateRecordFields(sparse)).toThrowError(new TypeError(invalid));
  const accessor = serialized();
  Object.defineProperty(accessor.fields.argumentAsk, '0', {
    enumerable: true,
    get: () => {
      reads++;
      return 'progress.0.answer';
    },
  });
  expect(() => readPrivateRecordFields(accessor)).toThrowError(new TypeError(invalid));
  expect(reads).toBe(0);
});

it('detaches admitted selectors and every native projection from mutable caller objects', () => {
  const raw = serialized();
  const admitted = readPrivateRecordFields(raw);
  raw.fields.argumentAsk[0] = 'waiting.requestId';
  raw.keys.push('history');
  const first = privateRecordPolicy(admitted);
  if (first?.fields?.argumentAsk === undefined) throw new Error('Expected private field policy');
  first.fields.argumentAsk[0] = 'waiting.requestId';
  first.keys = ['history'];
  expect(privateRecordPolicy(admitted)).toEqual(privateRecordPolicy(selected()));
  expect(admitted.keys).toEqual([]);
  expect(admitted.fields.argumentAsk).toEqual(['progress.0.answer']);
});

it('deduplicates writes and never removes a previously selected field', () => {
  const first = selected();
  const next = addPrivateRecordFields(first, [
    { root: 'argumentAsk', path: 'progress.0.answer' },
    { root: 'argumentAsk', path: 'progress.1.fills' },
  ]);
  expect(next.fields.argumentAsk).toEqual(['progress.0.answer', 'progress.1.fills']);
  expect(next.fields.argumentAnswersKept).toEqual(['1.value']);
  expect(first.fields.argumentAsk).toEqual(['progress.0.answer']);
});

it('promotes the selected fixed carrier when the path-count bound is reached', () => {
  const many = addPrivateRecordFields(
    undefined,
    Array.from({ length: PRIVATE_FIELD_LIMITS.paths + 1 }, (_, index) => ({
      root: 'argumentAsk' as const,
      path: `progress.${index}.answer`,
    })),
  );
  expect(many.keys).toEqual(['argumentAsk']);
  expect(many.fields.argumentAsk).toBeUndefined();
  expect(readPrivateRecordFields(many)).toEqual(many);
  const next = addPrivateRecordFields(many, [{ root: 'argumentAsk', path: 'progress.0.answer' }]);
  expect(next).toEqual(many);
  expect(
    new RedactionRule(privateRecordPolicy(next)).retainBoundary({
      history: ['public'],
      argumentAsk: { progress: [{ answer: 'private' }] },
    }),
  ).toEqual({ history: ['public'], argumentAsk: '[REDACTED]' });
});

it('promotes a carrier at its UTF-8 byte bound without losing the final selection', () => {
  const many = addPrivateRecordFields(
    undefined,
    Array.from({ length: 100 }, (_, index) => ({
      root: 'pausedCheckInArgs' as const,
      path: `${index}-${'界'.repeat(250)}`,
    })),
  );
  expect(many.keys).toEqual(['pausedCheckInArgs']);
  expect(many.fields.pausedCheckInArgs).toBeUndefined();
  expect(jsonBytes(many)).toBeLessThanOrEqual(PRIVATE_FIELD_LIMITS.bytes);
  expect(readPrivateRecordFields(many)).toEqual(many);
});

it('a whole-root fallback cannot overflow a previously full carrier', () => {
  const paths: string[] = [];
  const raw = { version: 1, keys: [], fields: { pausedCheckInArgs: paths } };
  for (let index = 0; index < PRIVATE_FIELD_LIMITS.paths; index++) {
    paths.push(`${index}-` + 'x'.repeat(196));
    if (jsonBytes(raw) > PRIVATE_FIELD_LIMITS.bytes) {
      paths.pop();
      break;
    }
  }
  const remaining = PRIVATE_FIELD_LIMITS.bytes - jsonBytes(raw);
  if (remaining >= 7) paths.push('z'.repeat(remaining - 3));
  else {
    const last = paths.at(-1);
    if (last === undefined) throw new Error('Expected a near-full field list');
    paths[paths.length - 1] = last + 'z'.repeat(remaining);
  }
  expect(jsonBytes(raw)).toBe(PRIVATE_FIELD_LIMITS.bytes);
  const prior = readPrivateRecordFields(raw);
  const next = addPrivateRecordFields(prior, [{ root: 'argumentAsk', path: 'unrepresentable' }]);
  expect(next.keys).toEqual(PRIVATE_FIELD_ROOTS);
  expect(next.fields).toEqual({});
  expect(jsonBytes(next)).toBeLessThanOrEqual(PRIVATE_FIELD_LIMITS.bytes);
  expect(readPrivateRecordFields(next)).toEqual(next);
});

it.each([
  'account.number',
  '*',
  'a/b',
  'a:b',
  'a\\b',
  '[0]',
  '__proto__',
  'constructor',
  'prototype',
  '\u007f',
  'x'.repeat(513),
])('unrepresentable private argument %j promotes only its closed carrier', (path) => {
  const value = addPrivateRecordFields(undefined, [{ root: 'pausedCheckInArgs', path }]);
  expect(value).toEqual({ version: 1, keys: ['pausedCheckInArgs'], fields: {} });
  expect(
    new RedactionRule(privateRecordPolicy(value)).retainBoundary({
      history: ['public'],
      pausedCheckInArgs: { [path]: 'private', region: 'eu' },
    }),
  ).toEqual({ history: ['public'], pausedCheckInArgs: '[REDACTED]' });
});

it('unread selections conservatively promote only the fixed working carriers', () => {
  let reads = 0;
  const selections = Array.from({ length: PRIVATE_FIELD_LIMITS.paths + 2 }, () => ({
    root: 'argumentAsk' as const,
    path: 'progress.0.answer',
  }));
  Object.defineProperty(selections, String(PRIVATE_FIELD_LIMITS.paths + 1), {
    get: () => {
      reads++;
      throw new Error('Unread tail must not run');
    },
  });
  const value = addPrivateRecordFields(undefined, selections);
  expect(value.keys).toEqual(PRIVATE_FIELD_ROOTS);
  expect(value.fields).toEqual({});
  expect(reads).toBe(0);
  expect(readPrivateRecordFields(value)).toEqual(value);
  expect(
    new RedactionRule(privateRecordPolicy(value)).retainBoundary({
      history: ['public'],
      argumentAsk: { progress: [{ answer: 'private' }] },
    }),
  ).toEqual({ history: ['public'], argumentAsk: '[REDACTED]' });
});

it('rejects writer selector injection and accessors without invoking them', () => {
  let reads = 0;
  expect(() =>
    addPrivateRecordFields(undefined, [{ root: 'history', path: '0.content' }] as never),
  ).toThrowError(new TypeError(invalid));
  expect(() =>
    addPrivateRecordFields(undefined, [
      { root: 'argumentAsk', path: 'progress.0.answer', caller: null },
    ] as never),
  ).toThrowError(new TypeError(invalid));
  const value = {
    root: 'argumentAsk' as const,
    get path() {
      reads++;
      return 'progress.0.answer';
    },
  };
  expect(() => addPrivateRecordFields(undefined, [value])).toThrowError(new TypeError(invalid));
  expect(reads).toBe(0);
});

it('a caller policy still masks its own selectors even where private selectors overlap', () => {
  const caller = {
    keys: ['history'],
    fields: { argumentAsk: ['waiting.requestId'], pausedCheckInArgs: ['account', 'region'] },
  };
  const policy = unionRedactionPolicies(caller, privateRecordPolicy(selected()));
  expect(
    new RedactionRule(policy).retainBoundary({
      history: ['caller selected'],
      argumentAsk: { waiting: { requestId: 'caller selected' }, progress: [{ answer: 'private' }] },
      pausedCheckInArgs: { account: 'both selected', region: 'caller selected' },
    }),
  ).toEqual({
    history: '[REDACTED]',
    argumentAsk: { waiting: { requestId: '[REDACTED]' }, progress: [{ answer: '[REDACTED]' }] },
    pausedCheckInArgs: { account: '[REDACTED]', region: '[REDACTED]' },
  });
});

it('shared components union private names without losing prior selectors or whole roots', () => {
  const left = selected();
  const right = addPrivateRecordFields(undefined, [
    { root: 'argumentAsk', path: 'progress.1.fills' },
    { root: 'pausedCheckInArgs', path: 'account.number' },
  ]);
  const joined = mergePrivateRecordFields(left, right);
  expect(joined.keys).toEqual(['pausedCheckInArgs']);
  expect(joined.fields.argumentAsk).toEqual(['progress.0.answer', 'progress.1.fills']);
  expect(joined.fields.argumentAnswersKept).toEqual(['1.value']);
  expect(joined.fields.pausedCheckInArgs).toBeUndefined();
  expect(readPrivateRecordFields(joined)).toEqual(joined);
  expect(left.fields.pausedCheckInArgs).toEqual(['account']);
});

it('a merged carrier that exceeds the combined bound promotes only fixed working roots', () => {
  const part = (offset: number) =>
    addPrivateRecordFields(
      undefined,
      Array.from({ length: 600 }, (_, index) => ({
        root: 'argumentAsk' as const,
        path: `progress.${offset + index}.answer`,
      })),
    );
  const joined = mergePrivateRecordFields(part(0), part(600));
  expect(joined.keys).toEqual(PRIVATE_FIELD_ROOTS);
  expect(joined.fields).toEqual({});
  expect(jsonBytes(joined)).toBeLessThanOrEqual(PRIVATE_FIELD_LIMITS.bytes);
  expect(readPrivateRecordFields(joined)).toEqual(joined);
});
