import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getPublishedInputs, sourceProductionManifest, consumerProductionManifest } from './publishedSetup.mjs';

function fixture() {
  const manifest = {
    name: 'agentfootprint', version: '15.0.0-rc.0', type: 'commonjs',
    dependencies: { contextfootprint: '0.1.1', foottrace: '^2.0.0', unrelated: '^7.1.0' },
    devDependencies: { footprintjs: '^13.0.0', typescript: '~5.4.5' },
    peerDependencies: { footprintjs: '^13.0.0', 'required-peer': '^4.0.0' },
    peerDependenciesMeta: { 'optional-peer': { optional: true } },
    optionalDependencies: { 'optional-library': '^3.0.0' },
    scripts: { build: 'original build' }, exports: { '.': './dist/index.js' },
  };
  const versions = { footprintjs: '13.0.0', foottrace: '2.0.0', contextfootprint: '0.1.1' };
  const packages = Object.fromEntries(Object.entries(versions).map(([name, version], i) => [
    `node_modules/${name}`,
    { version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
      integrity: `sha512-${Buffer.alloc(64, i + 1).toString('base64')}`,
      ...(name === 'footprintjs' ? { dev: true, peerDependencies: { foottrace: '^2.0.0' } } : {}) },
  ]));
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3,
    packages: { '': structuredClone(manifest), ...packages } };
  return { manifest, lock };
}
const admit = ({ manifest, lock }) => getPublishedInputs(JSON.stringify(manifest), JSON.stringify(lock));
const artifact = () => ({ path: '/tmp/original source#15.tgz', sha256: 'a'.repeat(64), sourceVersion: '15.0.0-rc.0' });

test('a later authored cohort release keeps its own original version rather than being staged back to the pilot label', () => {
  for (const version of ['15.0.0', '15.0.1', '15.1.0-rc.2']) {
    const f = fixture();
    f.manifest.version = f.lock.version = f.lock.packages[''].version = version;
    const inputs = admit(f);
    assert.equal(sourceProductionManifest(inputs).version, version);
    assert.equal(consumerProductionManifest(inputs, { ...artifact(), sourceVersion: version }).dependencies.agentfootprint, pathToFileURL(artifact().path).href);
  }
});

test('keeps selected published records and original document identities, including the dev-only engine fact', () => {
  const f = fixture(), manifestText = JSON.stringify(f.manifest), lockText = JSON.stringify(f.lock);
  const held = getPublishedInputs(manifestText, lockText);
  assert.deepEqual(held.selected.footprintjs, f.lock.packages['node_modules/footprintjs']);
  assert.equal(held.selected.footprintjs.dev, true);
  assert.equal(held.source.manifestSha256, createHash('sha256').update(manifestText).digest('hex'));
  assert.equal(held.source.lockSha256, createHash('sha256').update(lockText).digest('hex'));
  assert.equal(held.policy.sourceDocuments, 'immutable-oracle');
  assert(Object.isFrozen(held.selected.foottrace));
});

test('promotes the required engine peer into a detached exact production setup without losing unrelated constraints', () => {
  const f = fixture(), before = JSON.stringify(f), held = admit(f);
  const temporary = sourceProductionManifest(held);
  assert.deepEqual(temporary.dependencies, { contextfootprint: '0.1.1', foottrace: '2.0.0', unrelated: '^7.1.0', footprintjs: '13.0.0' });
  assert.equal(Object.hasOwn(temporary, 'devDependencies'), false);
  assert.deepEqual(temporary.peerDependencies, f.manifest.peerDependencies);
  assert.deepEqual(temporary.optionalDependencies, f.manifest.optionalDependencies);
  assert.deepEqual(temporary.peerDependenciesMeta, f.manifest.peerDependenciesMeta);
  assert.deepEqual(temporary.exports, f.manifest.exports);
  assert.deepEqual(temporary.scripts, f.manifest.scripts);
  assert.equal(temporary.version, f.manifest.version);
  temporary.peerDependencies['required-peer'] = 'changed';
  assert.equal(held.manifest.peerDependencies['required-peer'], '^4.0.0');
  assert.equal(JSON.stringify(f), before);
});

test('uses a neutral consumer and original archive URL without relabel, alias, override or source self-reference', () => {
  const held = admit(fixture()), pack = artifact(), before = structuredClone(pack);
  const consumer = consumerProductionManifest(held, pack);
  assert.deepEqual(consumer, { name: 'agentfootprint-context-package-consumer', private: true, type: 'module',
    dependencies: { agentfootprint: pathToFileURL(pack.path).href, footprintjs: '13.0.0', foottrace: '2.0.0' } });
  assert.deepEqual(pack, before);
  assert.equal(Object.hasOwn(consumer, 'overrides'), false);
  assert.equal(Object.hasOwn(consumer, 'devDependencies'), false);
});

for (const [name, mutate] of [
  ['mismatched source version', (f) => { f.manifest.version = '15.0.0'; }],
  ['engine alias', (f) => { f.manifest.peerDependencies.footprintjs = 'npm:other@13.0.0'; }],
  ['broader engine range', (f) => { f.manifest.peerDependencies.footprintjs = '^12 || ^13'; }],
  ['old foottrace range', (f) => { f.manifest.dependencies.foottrace = '^1.11.1'; }],
  ['context range', (f) => { f.manifest.dependencies.contextfootprint = '^0.1.1'; }],
  ['mismatched root lock', (f) => { f.lock.packages[''].dependencies.foottrace = '^1.0.0'; }],
  ['missing selected record', (f) => { delete f.lock.packages['node_modules/footprintjs']; }],
  ['wrong selected version', (f) => { f.lock.packages['node_modules/foottrace'].version = '2.0.1'; }],
  ['non-registry selected input', (f) => { f.lock.packages['node_modules/foottrace'].resolved = 'file:/tmp/foottrace.tgz'; }],
  ['malformed integrity', (f) => { f.lock.packages['node_modules/contextfootprint'].integrity = 'sha512-YQ=='; }],
  ['linked selected input', (f) => { f.lock.packages['node_modules/foottrace'].link = true; }],
  ['nested duplicate', (f) => { f.lock.packages['node_modules/other/node_modules/foottrace'] = { ...f.lock.packages['node_modules/foottrace'] }; }],
  ['optional selected input', (f) => { f.manifest.optionalDependencies.footprintjs = '13.0.0'; }],
  ['optional engine peer', (f) => { f.manifest.peerDependenciesMeta.footprintjs = { optional: true }; }],
  ['override', (f) => { f.manifest.overrides = { foottrace: '2.0.0' }; }],
  ['mismatched engine peer record', (f) => { f.lock.packages['node_modules/footprintjs'].peerDependencies.foottrace = '^1.0.0'; }],
]) {
  test(`refuses ${name} rather than manufacture a supported input`, () => {
    const f = fixture(); mutate(f);
    assert.throws(() => admit(f), TypeError);
  });
}

test('refuses malformed document roots and absent source shapes', () => {
  const f = fixture();
  for (const bad of [null, Buffer.from('{}'), 'null', '[]', '{', '{}']) {
    assert.throws(() => getPublishedInputs(bad, JSON.stringify(f.lock)), TypeError);
    assert.throws(() => getPublishedInputs(JSON.stringify(f.manifest), bad), TypeError);
  }
});

test('preserves own JSON keys without changing output prototypes', () => {
  const f = fixture();
  f.manifest.extra = JSON.parse('{"__proto__":{"kept":true},"constructor":"own"}');
  const temporary = sourceProductionManifest(admit(f));
  assert.equal(Object.getPrototypeOf(temporary), Object.prototype);
  assert.equal(Object.hasOwn(temporary.extra, '__proto__'), true);
  assert.deepEqual(temporary.extra.__proto__, { kept: true });
  assert.equal(temporary.extra.constructor, 'own');
});

test('refuses wrong archive identity, malformed paths/digest and accessor data before calling getters', () => {
  const held = admit(fixture());
  for (const patch of [
    { sourceVersion: '14.9.2' }, { sha256: 'short' }, { path: 'relative.tgz' },
    { path: 'file:///tmp/source.tgz' }, { path: '/tmp/source\0.tgz' }, { path: '/tmp/source.zip' },
  ]) assert.throws(() => consumerProductionManifest(held, { ...artifact(), ...patch }), TypeError);
  let reads = 0;
  const hostile = { ...artifact(), get sourceVersion() { reads++; throw new Error('unread'); } };
  assert.throws(() => consumerProductionManifest(held, hostile), TypeError);
  assert.equal(reads, 0);
});
