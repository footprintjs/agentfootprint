import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { archiveBytes } from './archive-fixture.mjs';
import dependency from './publishedDependency.cjs';
import canonical from './archive.cjs';
import strictJson from './strictJson.cjs';

const { inspectPublishedDependency } = dependency;
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const versions = { footprintjs: '14.0.0-rc.0', foottrace: '2.1.0', contextfootprint: '0.1.1' };
const manifest = (name) => ({ name, version: versions[name] });
const expected = (name, bytes) => ({ name, version: versions[name], integrity: 'sha512-' + hash(bytes, 'sha512', 'base64') });
const code = (run, refusal) => assert.throws(run, (error) => canonical.archiveRefusalCode(error) === refusal);

for (const name of Object.keys(versions)) {
  test(`admits inert ${name} data with full manifest and member identities`, () => {
    const metadata = manifest(name), bytes = archiveBytes(metadata);
    const result = inspectPublishedDependency(bytes, expected(name, bytes));
    assert.deepEqual(result.manifest, metadata);
    assert.equal(result.package, name);
    assert.equal(result.sha256, hash(bytes));
    assert.equal(result.shasum, hash(bytes, 'sha1'));
    assert.equal(result.integrity, expected(name, bytes).integrity);
    assert.equal(result.bytes, bytes.length);
    assert.deepEqual(result.files.map(({ path }) => path), ['package/package.json', 'package/dist/index.js']);
    assert.equal(result.files[1].sha256, hash(Buffer.from('exports.fixture = true;\n')));
    assert.equal(result.files[1].size, Buffer.byteLength('exports.fixture = true;\n'));
    assert(Object.isFrozen(result.manifest) && Object.isFrozen(result.files[0]));
  });
}

// This is a closed cohort, not a semver range or an npm tag lookup.
for (const [name, version] of [
  ['footprintjs', '13.0.0'], ['footprintjs', '14.0.0'],
  ['footprintjs', '14.0.0-rc.1'], ['footprintjs', '14.0.0-rc.00'],
  ['foottrace', '2.0.0'], ['foottrace', '2.1.1'],
]) test(`refuses unselected ${name}@${version} even with matching archive identity and SRI`, () => {
  const bytes = archiveBytes({ name, version });
  code(() => inspectPublishedDependency(bytes, { ...expected(name, bytes), version }), 'dependency-input');
});

for (const [name, version] of [['footprintjs', '13.0.0'], ['foottrace', '2.0.0']])
  test(`refuses old ${name} archive bytes presented as the selected cohort`, () => {
    const bytes = archiveBytes({ name, version });
    code(() => inspectPublishedDependency(bytes, expected(name, bytes)), 'dependency-identity');
  });

test('Context extras and public publishConfig are inert SRI-bound data, never AF policy', () => {
  const metadata = { ...manifest('contextfootprint'), publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' } };
  const bytes = archiveBytes(metadata, { extra: [
    ['package/CHANGELOG.md', 'changes'], ['package/NOTICE', 'notice'], ['package/examples/demo.js', 'not executed'],
  ] });
  const result = inspectPublishedDependency(bytes, expected('contextfootprint', bytes));
  assert.deepEqual(result.manifest.publishConfig, metadata.publishConfig);
  assert.equal(result.files.length, 5);
  code(() => canonical.inspectArchive(bytes, { package: metadata.name, version: metadata.version }), 'archive-path');
  const af = { name: 'agentfootprint', version: '15.0.0-rc.0', publishConfig: { access: 'public' } };
  code(() => canonical.inspectArchive(archiveBytes(af), { package: af.name, version: af.version }), 'invalid-archive');
});

test('selected SHA512 is checked before even attempting gzip admission', () => {
  const bytes = Buffer.from('not a gzip stream');
  const other = archiveBytes(manifest('foottrace'));
  code(() => inspectPublishedDependency(bytes, expected('foottrace', other)), 'dependency-integrity');
  code(() => inspectPublishedDependency(bytes, expected('foottrace', bytes)), 'invalid-archive');
});

test('the AF default refuses Context-only members even without publishConfig', () => {
  const af = { name: 'agentfootprint', version: '15.0.0-rc.0' };
  for (const path of ['package/CHANGELOG.md', 'package/NOTICE', 'package/examples/demo.js']) {
    const bytes = archiveBytes(af, { extra: [[path, 'inert']] });
    code(() => canonical.inspectArchive(bytes, { package: af.name, version: af.version }), 'archive-path');
  }
});

test('the AF facade retains original digest timing after source-manifest comparison', () => {
  const af = { name: 'agentfootprint', version: '15.0.0-rc.0' };
  const bytes = archiveBytes(af);
  let reads = 0;
  const result = canonical.inspectArchive(bytes, {
    package: af.name, version: af.version,
    get sourceManifest() { reads++; bytes[9] ^= 1; return af; },
  });
  assert.equal(reads, 1);
  assert.equal(result.sha256, hash(bytes));
  assert.equal(result.shasum, hash(bytes, 'sha1'));
  assert.equal(result.integrity, 'sha512-' + hash(bytes, 'sha512', 'base64'));
});

test('Context publishConfig accepts only the observed public registry shape', () => {
  for (const config of [
    { access: 'public' }, { access: 'private', registry: 'https://registry.npmjs.org/' },
    { access: 'public', registry: 'https://other.invalid/' },
    { access: 'public', registry: 'https://registry.npmjs.org/', tag: 'other' },
  ]) {
    const bytes = archiveBytes({ ...manifest('contextfootprint'), publishConfig: config });
    code(() => inspectPublishedDependency(bytes, expected('contextfootprint', bytes)), 'dependency-manifest');
  }
});

test('refuses unsupported package/version and all caller policy overrides', () => {
  const bytes = archiveBytes(manifest('foottrace')), selected = expected('foottrace', bytes);
  for (const patch of [
    { name: 'other' }, { version: '2.1.1' }, { integrity: 'sha512-YQ==' },
    { maxFiles: 1 }, { roots: ['package/'] }, { profile: 'contextfootprint' },
  ]) code(() => inspectPublishedDependency(bytes, { ...selected, ...patch }), 'dependency-input');
  let reads = 0;
  const accessor = { ...selected, get name() { reads++; throw new Error('unread'); } };
  code(() => inspectPublishedDependency(bytes, accessor), 'dependency-input');
  assert.equal(reads, 0);
  const proxy = new Proxy(selected, { ownKeys() { throw new Error('unread'); } });
  code(() => inspectPublishedDependency(bytes, proxy), 'dependency-input');
});

for (const [label, metadata] of [
  ['name', { name: 'other', version: '2.1.0' }],
  ['version', { name: 'foottrace', version: '2.1.1' }],
]) test(`checks decoded manifest ${label} against the selected identity`, () => {
  const bytes = archiveBytes(metadata);
  code(() => inspectPublishedDependency(bytes, expected('foottrace', bytes)), 'dependency-identity');
});

for (const [label, extra] of [
  ['foreign root', [['package/docs/guide.md', 'inert']]],
  ['root npm config', [['package/.npmrc', 'inert']]],
  ['nested npm config', [['package/examples/.npmrc', 'inert']]],
  ['bundled module', [['package/dist/node_modules/other/index.js', 'inert']]],
  ['duplicate', [['package/dist/index.js', 'other']]],
  ['case collision', [['package/dist/A.js', 'one'], ['package/dist/a.js', 'two']]],
  ['directory case collision', [['package/dist/A/one.js', 'one'], ['package/dist/a/two.js', 'two']]],
  ['file-directory collision', [['package/dist/leaf', 'one'], ['package/dist/leaf/more.js', 'two']]],
  ['traversal', [['package/dist/../escape.js', 'inert']]],
]) test(`refuses ${label} in a correctly SRI-bound dependency`, () => {
  const bytes = archiveBytes(manifest('contextfootprint'), { extra });
  assert.throws(() => inspectPublishedDependency(bytes, expected('contextfootprint', bytes)),
    (error) => typeof canonical.archiveRefusalCode(error) === 'string');
});

test('Context roots and publishConfig never widen the native dependency profiles', () => {
  for (const name of ['footprintjs', 'foottrace']) {
    const extra = archiveBytes(manifest(name), { extra: [['package/CHANGELOG.md', 'inert']] });
    code(() => inspectPublishedDependency(extra, expected(name, extra)), 'archive-path');
    const config = archiveBytes({ ...manifest(name), publishConfig: { access: 'public' } });
    code(() => inspectPublishedDependency(config, expected(name, config)), 'dependency-manifest');
  }
});

for (const [label, bytes] of [
  ['decoded duplicate key', Buffer.from('{"name":"foottrace","na\\u006de":"foottrace","version":"2.1.0"}')],
  ['nested duplicate key', Buffer.from('{"name":"foottrace","version":"2.1.0","extra":{"a":1,"\\u0061":2}}')],
  ['malformed UTF8', Buffer.from([0xff])],
  ['excessive depth', Buffer.from('{"extra":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}')],
  ['excessive values', Buffer.from('{"extra":[' + '0,'.repeat(100000) + '0]}')],
]) test(`strict dependency JSON refuses ${label}`, () => {
  const archive = archiveBytes(manifest('foottrace'), { manifestBytes: bytes });
  assert.throws(() => inspectPublishedDependency(archive, expected('foottrace', archive)),
    (error) => canonical.archiveRefusalCode(error)?.startsWith('manifest-json'));
});

test('strict JSON keeps its one-MiB admission ceiling', () => {
  const at = Buffer.from('{"a":"' + 'x'.repeat(1024 * 1024 - 8) + '"}');
  assert.equal(at.length, 1024 * 1024);
  assert.equal(strictJson.parseManifest(at).a.length, 1024 * 1024 - 8);
  code(() => strictJson.parseManifest(Buffer.concat([at, Buffer.from(' ')])), 'manifest-json');
});

test('links, PAX/GNU, second gzip and trailing bytes stay refused', () => {
  const bytes = archiveBytes(manifest('foottrace'));
  for (const type of [49, 50, 53, 120, 103, 76, 75]) {
    const tar = gunzipSync(bytes);
    tar[156] = type;
    tar.fill(32, 148, 156);
    let sum = 0; for (const value of tar.subarray(0, 512)) sum += value;
    tar.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    const changed = gzipSync(tar);
    assert.throws(() => inspectPublishedDependency(changed, expected('foottrace', changed)),
      (error) => typeof canonical.archiveRefusalCode(error) === 'string');
  }
  for (const changed of [Buffer.concat([bytes, bytes]), Buffer.concat([bytes, Buffer.from([0])])])
    code(() => inspectPublishedDependency(changed, expected('foottrace', changed)), 'invalid-archive');
});
