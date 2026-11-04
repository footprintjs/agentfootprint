import test from 'node:test';
import assert from 'node:assert/strict';
import { stagedPublish } from './publish-test-fixture.mjs';
for (const [label, key] of [
  ['empty', ''],
  ['NUL', String.fromCharCode(0)],
  ['newline', String.fromCharCode(10)],
])
  for (const version of ['13.2.0', '14.0.0-rc.10'])
    for (const [field, value] of [
      ['tag', 'latest'],
      ['publishConfig', { registry: 'http://127.0.0.1:9/evil/' }],
      ['scripts', { prepublishOnly: 'exit 94' }],
      ['dependencies', { other: '9.0.0' }],
    ])
      test(
        'publisher refuses a lossy ' +
          label +
          ' key before dangerous sibling ' +
          field +
          ' ' +
          version,
        (t) => {
          const { r, args } = stagedPublish(t, version, version, { [key]: true, [field]: value });
          assert.equal(r.status, 1);
          assert.match(r.stdout, /manifest-source:key-[a-f0-9]{12}/);
          assert.deepEqual(args, []);
          assert.equal(r.stderr, '', 'a raw NUL key must never enter shell substitution');
        },
      );
for (const [label, key] of [
  ['empty', ''],
  ['NUL', String.fromCharCode(0)],
  ['newline', String.fromCharCode(10)],
])
  test(
    'publisher equality discriminator supports a matching ' + label + ' key but refuses deletion',
    (t) => {
      const source = { name: 'agentfootprint', version: '13.2.0', [key]: true };
      const same = stagedPublish(t, '14.0.0-rc.10', '14.0.0-rc.10', { [key]: true }, null, source);
      assert.equal(same.r.status, 0, same.r.stderr);
      const missing = stagedPublish(t, '14.0.0-rc.10', '14.0.0-rc.10', {}, null, source);
      assert.equal(missing.r.status, 1);
      assert.match(missing.r.stdout, /manifest-source:key-[a-f0-9]{12}/);
      assert.deepEqual(missing.args, []);
      assert.equal(missing.r.stderr, '');
    },
  );

test('publisher comparison discriminator cannot come from package data', (t) => {
  const bad = stagedPublish(t, '14.0.0-rc.10', '14.0.0-rc.10', {
    equal: true,
    key: '',
    tag: 'latest',
  });
  assert.equal(bad.r.status, 1);
  assert.deepEqual(bad.args, []);
  assert.match(bad.r.stdout, /manifest-source:key-[a-f0-9]{12}/);
});
