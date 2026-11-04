import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { stagedPublish } from '../publish-test-fixture.mjs';
import { archiveBytes } from './archive-fixture.mjs';
const base = [
  'publish',
  './package.tgz',
  '--ignore-scripts',
  '--provenance',
  '--access',
  'public',
  '--registry=https://registry.npmjs.org',
];
for (const version of ['13.2.0', '14.0.0-rc.10'])
  test('native publisher sends the inspected bytes with canonical argv ' + version, (t) => {
    const { r, args, bytes, publishedSha256, publish, workingDirectory } = stagedPublish(
      t,
      version,
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(workingDirectory, publish);
    assert.deepEqual(args, version.includes('-rc.') ? [...base, '--tag', 'next'] : base);
    assert.equal(publishedSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(readdirSync(publish), ['package.tgz']);
    assert.deepEqual(readFileSync(publish + '/package.tgz'), bytes);
  });
for (const name of ['.npmrc', 'binding.gyp', 'server.js', 'verify.cjs', 'archive.cjs'])
  test('incoming sibling ' + name + ' cannot become publish config or executable helper', (t) => {
    const { r, args, publishedSha256, publish } = stagedPublish(
      t,
      '13.2.0',
      '13.2.0',
      {},
      null,
      null,
      {
        artifactSiblings: {
          [name]:
            'tag=next\nregistry=http://127.0.0.1:9/evil/\nthrow new Error("sibling executed")',
        },
      },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(args, base);
    assert(publishedSha256);
    assert.deepEqual(readdirSync(publish), ['package.tgz']);
  });
for (const name of ['.npmrc', 'binding.gyp', 'server.js'])
  test('archive root ' + name + ' fails before malformed manifest and before npm', (t) => {
    const { r, args } = stagedPublish(t, '13.2.0', '13.2.0', {}, null, null, {
      archiveBytes: archiveBytes(
        {},
        { manifestBytes: '{invalid', extra: [['package/' + name, 'inert']] },
      ),
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::archive-path/);
    assert.deepEqual(args, []);
  });
for (const version of [undefined, null, 4, {}, '14.0.0-rc.01', '14.0.0\n'])
  test('missing or malformed archive version has a named refusal ' + String(version), (t) => {
    const manifest = { name: 'agentfootprint', ...(version === undefined ? {} : { version }) };
    const { r, args } = stagedPublish(t, '13.2.0', '13.2.0', {}, JSON.stringify(manifest));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::manifest-version/);
    assert.deepEqual(args, []);
  });
test('nonempty publish cwd is refused before npm receives an archive', (t) => {
  const { r, args } = stagedPublish(t, '13.2.0', '13.2.0', {}, null, null, {
    publishSiblings: { '.npmrc': 'tag=next' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error::archive-directory/);
  assert.deepEqual(args, []);
});
test('wrong npm reader version refuses without a publication attempt', (t) => {
  const { r, args } = stagedPublish(t, '13.2.0', '13.2.0', {}, null, null, {
    npmVersion: '11.20.0',
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error::npm-version/);
  assert.deepEqual(args, []);
});
