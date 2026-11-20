import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePairedInput, validateGuardReceipt } from './protocol.mjs';
import {
  digest,
  refKeys,
  producerKeys,
  sha256,
  source,
  setup,
  probes,
  input,
  boundary,
  guard,
  refuses,
} from './protocol-fixture.mjs';

test('valid guard receipts cover all five commands and cleanup', () => {
  const cases = [
    boundary('source-cjs', 'source-online'),
    boundary('source-pack', null),
    boundary(),
    boundary('packed-esm'),
    boundary('packed-types'),
  ];
  for (const b of cases) {
    const value = guard(b),
      keys = b.caseId === null ? producerKeys : refKeys;
    assert.equal(validateGuardReceipt(value, b, setup(), keys), value);
    const after = { ...b, phase: 'after-command', execution: { exitCode: 1, signal: null } };
    validateGuardReceipt(guard(after), after, setup(), keys);
  }
  const b = { ...boundary(), phase: 'after-cleanup', command: null, execution: null, probes: [] };
  validateGuardReceipt(guard(b), b, setup(), refKeys);
});

for (const [name, change] of [
  [
    'unknown phase',
    (b) => {
      b.phase = 'later';
    },
  ],
  [
    'unknown command',
    (b) => {
      b.command = 'arbitrary';
    },
  ],
  [
    'wrong command family',
    (b) => {
      b.command = 'source-cjs';
    },
  ],
  [
    'execution before command',
    (b) => {
      b.execution = { exitCode: 0, signal: null };
    },
  ],
  [
    'missing execution after command',
    (b) => {
      b.phase = 'after-command';
    },
  ],
  [
    'invented cleanup command',
    (b) => {
      b.phase = 'after-cleanup';
      b.probes = [];
    },
  ],
  [
    'probe outside phase',
    (b) => {
      b.probes = probes();
    },
  ],
  [
    'missing probe',
    (b) => {
      b.probes.pop();
    },
  ],
  [
    'duplicate probe',
    (b) => {
      b.probes[1] = structuredClone(b.probes[0]);
    },
  ],
  [
    'wrong probe path',
    (b) => {
      b.probes[0].relativePath = '../outside';
    },
  ],
  [
    'wrong probe hash',
    (b) => {
      b.probes[0].sha256 = digest;
    },
  ],
  [
    'wrong probe byte size',
    (b) => {
      b.probes[0].size = b.probes[0].body.length;
    },
  ],
  [
    'wrong probe lifetime',
    (b) => {
      b.probes[0].phase = 'types';
    },
  ],
  [
    'unknown probe field',
    (b) => {
      b.probes[0].override = true;
    },
  ],
  [
    'sparse probes',
    (b) => {
      delete b.probes[0];
    },
  ],
]) {
  test(`guard refuses ${name} even when echoed as the expected boundary`, () => {
    const b = boundary();
    change(b);
    refuses(() => validateGuardReceipt(guard(b), b, setup(), refKeys));
  });
}

test('after-command permits cancellation but refuses malformed execution data', () => {
  const b = boundary('packed-cjs', 'consumer-offline', 'after-command');
  b.execution = { exitCode: null, signal: 'SIGTERM' };
  validateGuardReceipt(guard(b), b, setup(), refKeys);
  for (const execution of [
    { exitCode: 0.5, signal: null },
    { exitCode: 0, signal: 1 },
    { exitCode: 0, signal: null, passed: true },
  ]) {
    const invalid = { ...b, execution };
    refuses(() => validateGuardReceipt(guard(invalid), invalid, setup(), refKeys));
  }
});

test('guard must match the actual boundary and setup, not merely have the right shape', () => {
  const b = boundary();
  const wrongCase = guard({ ...b, caseId: 'consumer-offline' });
  refuses(() => validateGuardReceipt(wrongCase, b, setup(), refKeys));
  const changedSetup = guard(b);
  changedSetup.setup.lockSha256 = 'f'.repeat(64);
  refuses(() => validateGuardReceipt(changedSetup, b, setup(), refKeys));
  refuses(() => validateGuardReceipt({ ...guard(b), passed: true }, b, setup(), refKeys));
  refuses(() =>
    validateGuardReceipt(
      guard(boundary('source-pack', null)),
      boundary('source-pack', null),
      setup(),
      refKeys,
    ),
  );
});

test('nested boundary and array accessors never execute', () => {
  let reads = 0;
  const b = boundary(),
    value = guard(b);
  Object.defineProperty(value.boundary.probes[0], 'body', {
    enumerable: true,
    get() {
      reads++;
      return 'bad';
    },
  });
  refuses(() => validateGuardReceipt(value, b, setup(), refKeys));
  const other = guard(b);
  Object.defineProperty(other.boundary.probes, '0', {
    enumerable: true,
    get() {
      reads++;
      return {};
    },
  });
  refuses(() => validateGuardReceipt(other, b, setup(), refKeys));
  assert.equal(reads, 0);
});

test('probe bodies are bounded by UTF8 bytes, including exactly 65536 bytes', () => {
  for (const [body, accepted] of [
    ['x', true],
    ['\u00e9'.repeat(32768), true],
    ['', false],
    ['\u00e9'.repeat(32768) + 'x', false],
  ]) {
    const b = boundary();
    Object.assign(b.probes[0], { body, size: Buffer.byteLength(body), sha256: sha256(body) });
    const run = () => validateGuardReceipt(guard(b), b, setup(), refKeys);
    if (accepted) run();
    else refuses(run);
  }
});

test('Windows exit statuses and unknown spawn outcomes remain representable', () => {
  const b = boundary('packed-cjs', 'consumer-online', 'after-command');
  for (const exitCode of [0, 4294967295, null]) {
    b.execution = { exitCode, signal: null };
    validateGuardReceipt(guard(b), b, setup(), refKeys);
  }
  for (const exitCode of [-1, 4294967296, NaN, Infinity]) {
    b.execution = { exitCode, signal: null };
    refuses(() => validateGuardReceipt(guard(b), b, setup(), refKeys));
  }
  for (const signal of ['', 'sigterm', 'SIG TERM', 'S'.repeat(33)]) {
    b.execution = { exitCode: null, signal };
    refuses(() => validateGuardReceipt(guard(b), b, setup(), refKeys));
  }
  b.execution = { exitCode: null, signal: 'S'.repeat(32) };
  validateGuardReceipt(guard(b), b, setup(), refKeys);
});

test('cleanup has neither command output nor remaining probes nor a producer case', () => {
  const b = { ...boundary(), phase: 'after-cleanup', command: null, execution: null, probes: [] };
  for (const change of [
    { execution: { exitCode: 0, signal: null } },
    { probes: probes().slice(0, 2) },
    { caseId: null },
  ]) {
    const invalid = { ...b, ...change };
    refuses(() => validateGuardReceipt(guard(invalid), invalid, setup(), refKeys));
  }
});

test('probe and function proxies are rejected without running traps or callbacks', () => {
  let calls = 0;
  const b = boundary(),
    value = guard(b);
  value.boundary.probes = new Proxy(value.boundary.probes, {
    get() {
      calls++;
      throw new Error('must not read');
    },
    getPrototypeOf() {
      calls++;
      return Array.prototype;
    },
  });
  refuses(() => validateGuardReceipt(value, b, setup(), refKeys));
  const proxy = new Proxy(
    () => {
      calls++;
    },
    {
      apply() {
        calls++;
      },
    },
  );
  refuses(() => validatePairedInput({ ...input(), verifySource: proxy }));
  const valid = input();
  for (const key of ['installSourceRoot', 'installPackedConsumer', 'verifySource'])
    valid[key] = () => {
      calls++;
    };
  validatePairedInput(valid);
  assert.equal(calls, 0);
});

test('array extras and custom prototypes cannot hide beside the fixed probes', () => {
  for (const change of [
    (p) => {
      p[Symbol('extra')] = true;
    },
    (p) => {
      p.extra = true;
    },
    (p) => {
      Object.setPrototypeOf(p, Object.create(Array.prototype));
    },
  ]) {
    const b = boundary(),
      value = guard(b);
    change(value.boundary.probes);
    refuses(() => validateGuardReceipt(value, b, setup(), refKeys));
  }
});

test('proof key arguments cannot execute coercion or substitute repeated keys', () => {
  let conversions = 0;
  const b = boundary();
  const unsafe = {
    toString() {
      conversions++;
      return 'graph';
    },
  };
  refuses(() =>
    validateGuardReceipt(guard(b), b, setup(), ['source', 'install', 'inputs', unsafe]),
  );
  refuses(() =>
    validateGuardReceipt(guard(b), b, setup(), ['source', 'install', 'inputs', 'inputs']),
  );
  validateGuardReceipt(guard(b), b, setup(), [...refKeys].reverse());
  assert.equal(conversions, 0);
});
