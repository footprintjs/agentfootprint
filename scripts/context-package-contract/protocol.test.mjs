import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROTOCOL,
  CASES,
  COMMANDS,
  assertRecord,
  validatePairedInput,
  validateSource,
  validateProofRefs,
} from './protocol.mjs';
import {
  digest,
  refKeys,
  sha256,
  source,
  refs,
  input,
  boundary,
  refuses,
} from './protocol-fixture.mjs';

test('the protocol and closed case/command lists are immutable', () => {
  assert.equal(PROTOCOL, 'agentfootprint.context-package-contract.v1');
  assert.deepEqual(CASES, [
    'source-online',
    'source-offline',
    'consumer-online',
    'consumer-offline',
  ]);
  assert.deepEqual(COMMANDS, [
    'source-cjs',
    'source-pack',
    'packed-cjs',
    'packed-esm',
    'packed-types',
  ]);
  assert.equal(Object.isFrozen(CASES), true);
  assert.equal(Object.isFrozen(COMMANDS), true);
});

test('accepts ordinary records, including frozen own data', () => {
  const value = Object.freeze({ a: 1 });
  assertRecord(value, ['a'], 'fixture');
});

for (const [name, make] of [
  ['null', () => null],
  ['array', () => []],
  ['null prototype', () => Object.assign(Object.create(null), { a: 1 })],
  ['custom prototype', () => Object.assign(Object.create({ inherited: true }), { a: 1 })],
  ['unknown key', () => ({ a: 1, passed: true })],
  ['missing key', () => ({})],
  ['symbol key', () => ({ a: 1, [Symbol('extra')]: true })],
  ['non-enumerable data', () => Object.defineProperty({}, 'a', { value: 1 })],
]) {
  test(`record refuses ${name}`, () => refuses(() => assertRecord(make(), ['a'], 'fixture')));
}

test('record accessor is rejected without invoking its getter', () => {
  let reads = 0;
  const value = {
    get a() {
      reads++;
      return 1;
    },
  };
  refuses(() => assertRecord(value, ['a'], 'fixture'));
  assert.equal(reads, 0);
});

test('proxies are refused without invoking reflection traps', () => {
  let traps = 0;
  const value = new Proxy(
    { a: 1 },
    {
      ownKeys() {
        traps++;
        return ['a'];
      },
      getPrototypeOf() {
        traps++;
        return Object.prototype;
      },
    },
  );
  refuses(() => assertRecord(value, ['a'], 'fixture'));
  assert.equal(traps, 0);
});

test('revoked proxies refuse as protocol data', () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  refuses(() => assertRecord(proxy, [], 'fixture'));
});

test('source accepts full lowercase IDs and digests', () => validateSource(source()));
for (const [key, value] of [
  ['head', 'b'.repeat(39)],
  ['tree', 'C'.repeat(40)],
  ['manifestSha256', 'A'.repeat(64)],
  ['lockSha256', 'sha256-' + digest],
]) {
  test(`source refuses invalid ${key}`, () =>
    refuses(() => validateSource({ ...source(), [key]: value })));
}

test('proof references require their exact fixed keys and own valid data', () => {
  validateProofRefs(refs(), refKeys);
  for (const change of [
    (r) => {
      r.extra = { id: 'extra', sha256: digest };
    },
    (r) => {
      delete r.graph;
    },
    (r) => {
      r.graph.sha256 = 'no';
    },
    (r) => {
      r.graph.id = '';
    },
    (r) => {
      r.graph.id = 'x'.repeat(10000);
    },
    (r) => {
      r.graph.passed = true;
    },
  ]) {
    const value = refs();
    change(value);
    refuses(() => validateProofRefs(value, refKeys));
  }
});

test('nested proof getter never executes', () => {
  let reads = 0;
  const value = refs();
  Object.defineProperty(value.graph, 'sha256', {
    enumerable: true,
    get() {
      reads++;
      return digest;
    },
  });
  refuses(() => validateProofRefs(value, refKeys));
  assert.equal(reads, 0);
});

test('paired input requires all three callable ports and no registry fallback', () => {
  validatePairedInput(input());
  for (const key of ['installSourceRoot', 'installPackedConsumer', 'verifySource']) {
    const value = input();
    delete value[key];
    refuses(() => validatePairedInput(value));
    refuses(() => validatePairedInput({ ...input(), [key]: 'function' }));
  }
  refuses(() => validatePairedInput({ ...input(), command: 'npm install' }));
  refuses(() => validatePairedInput({ ...input(), expectedContext: '0.1.1' }));
  refuses(() => validatePairedInput({ ...input(), sourceRoot: 'x'.repeat(10000) }));
});

test('paired input rejects a port getter without calling it', () => {
  let reads = 0;
  const value = input();
  Object.defineProperty(value, 'verifySource', {
    enumerable: true,
    get() {
      reads++;
      return async () => {};
    },
  });
  refuses(() => validatePairedInput(value));
  assert.equal(reads, 0);
});

test('path and proof identifier limits accept the boundary and refuse one beyond', () => {
  validatePairedInput({ ...input(), sourceRoot: 'x'.repeat(4096) });
  refuses(() => validatePairedInput({ ...input(), sourceRoot: 'x'.repeat(4097) }));
  refuses(() => validatePairedInput({ ...input(), ownedWorkRoot: '' }));
  const value = refs();
  value.graph.id = 'x'.repeat(128);
  validateProofRefs(value, refKeys);
  for (const id of ['x'.repeat(129), 'https://example.test/proof', '../proof', 'a b', '_proof']) {
    refuses(() => validateProofRefs({ ...value, graph: { id, sha256: digest } }, refKeys));
  }
});
