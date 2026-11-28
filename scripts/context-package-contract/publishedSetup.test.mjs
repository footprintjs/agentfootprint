import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getPublishedInputs, sourceProductionManifest, consumerProductionManifest } from './publishedSetup.mjs';

function fixture() {
  const manifest = {
    name: 'agentfootprint', version: '15.0.0-rc.0', type: 'commonjs',
    dependencies: { contextfootprint: '0.1.1', foottrace: '^2.3.2', unrelated: '^7.1.0' },
    devDependencies: { footprintjs: '^14.3.0', typescript: '~5.4.5' },
    peerDependencies: { footprintjs: '^14.3.0', 'required-peer': '^4.0.0' },
    peerDependenciesMeta: { 'optional-peer': { optional: true } },
    optionalDependencies: { 'optional-library': '^3.0.0' },
    scripts: { build: 'original build' }, exports: { '.': './dist/index.js' },
  };
  const versions = { footprintjs: '14.6.0', foottrace: '2.3.2', contextfootprint: '0.1.1' };
  const packages = Object.fromEntries(Object.entries(versions).map(([name, version], i) => [
    `node_modules/${name}`,
    { version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
      integrity: `sha512-${Buffer.alloc(64, i + 1).toString('base64')}`,
      ...(name === 'footprintjs' ? { dev: true, peerDependencies: { foottrace: '^2.3.1 || ^3.1.0' } } : {}) },
  ]));
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3,
    packages: { '': structuredClone(manifest), ...packages } };
  return { manifest, lock };
}
const admit = ({ manifest, lock }) => getPublishedInputs(JSON.stringify(manifest), JSON.stringify(lock));
const artifact = () => ({ path: '/tmp/original source#15.tgz', sha256: 'a'.repeat(64), sourceVersion: '15.0.0-rc.0' });

test('refuses the coherent previous engine 13 and Foottrace 2.0 cohort', () => {
  const f = fixture();
  for (const manifest of [f.manifest, f.lock.packages['']]) {
    manifest.dependencies.foottrace = '^2.0.0';
    manifest.peerDependencies.footprintjs = manifest.devDependencies.footprintjs = '^13.0.0';
  }
  for (const [name, version] of [['footprintjs', '13.0.0'], ['foottrace', '2.0.0']]) {
    const row = f.lock.packages[`node_modules/${name}`];
    row.version = version;
    row.resolved = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
  }
  f.lock.packages['node_modules/footprintjs'].peerDependencies.foottrace = '^2.0.0';
  assert.throws(() => admit(f), TypeError);
});

test('refuses the coherent previous engine 14.0 cohort, with its own Foottrace peer ^2.1.0', () => {
  const f = fixture();
  for (const manifest of [f.manifest, f.lock.packages['']]) {
    manifest.peerDependencies.footprintjs = manifest.devDependencies.footprintjs = '^14.0.0';
  }
  const row = f.lock.packages['node_modules/footprintjs'];
  row.version = '14.0.0';
  row.resolved = 'https://registry.npmjs.org/footprintjs/-/footprintjs-14.0.0.tgz';
  row.peerDependencies.foottrace = '^2.1.0';
  assert.throws(() => admit(f), /engine range/);
});

test('refuses earlier Foottrace 2.0 even when its source ranges and engine peer agree', () => {
  const f = fixture();
  f.manifest.dependencies.foottrace = f.lock.packages[''].dependencies.foottrace = '^2.0.0';
  const row = f.lock.packages['node_modules/foottrace'];
  row.version = '2.0.0';
  row.resolved = 'https://registry.npmjs.org/foottrace/-/foottrace-2.0.0.tgz';
  f.lock.packages['node_modules/footprintjs'].peerDependencies.foottrace = '^2.0.0';
  assert.throws(() => admit(f), TypeError);
});

test('refuses earlier prereleases and unselected stable engine archives', () => {
  for (const version of ['13.0.0', '14.0.0', '14.2.0', '14.3.0-rc.0', '14.3.0-rc.1', '14.3.0', '14.3.1', '14.6.0-rc.0', '14.6.1']) {
    const f = fixture(), row = f.lock.packages['node_modules/footprintjs'];
    row.version = version;
    row.resolved = `https://registry.npmjs.org/footprintjs/-/footprintjs-${version}.tgz`;
    assert.throws(() => admit(f), /footprintjs version/);
  }
});

test('the authored source version remains bound to the manifest, lock and original archive', () => {
  for (const version of ['14.10.0', '15.0.0', '15.0.1', '15.1.0-rc.2', '16.0.0']) {
    const f = fixture();
    f.manifest.version = f.lock.version = f.lock.packages[''].version = version;
    const inputs = admit(f);
    assert.equal(sourceProductionManifest(inputs).version, version);
    assert.equal(consumerProductionManifest(inputs, { ...artifact(), sourceVersion: version }).dependencies.agentfootprint, pathToFileURL(artifact().path).href);
    assert.throws(() => consumerProductionManifest(inputs, artifact()), /artifact version/);
  }
});

test('coherent source documents still refuse noncanonical and oversized versions', () => {
  for (const version of ['014.10.0', '14.10.00', '14.10.0\n', '15.0.0-rc.01', '9007199254740992.0.0']) {
    const f = fixture();
    f.manifest.version = f.lock.version = f.lock.packages[''].version = version;
    assert.throws(() => admit(f), /source identity/);
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
  assert.deepEqual(temporary.dependencies, { contextfootprint: '0.1.1', foottrace: '2.3.2', unrelated: '^7.1.0', footprintjs: '14.6.0' });
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
    dependencies: { agentfootprint: pathToFileURL(pack.path).href, footprintjs: '14.6.0', foottrace: '2.3.2' } });
  assert.deepEqual(pack, before);
  assert.equal(Object.hasOwn(consumer, 'overrides'), false);
  assert.equal(Object.hasOwn(consumer, 'devDependencies'), false);
});

for (const [name, mutate] of [
  ['mismatched source version', (f) => { f.manifest.version = '15.0.0'; }],
  ['engine alias', (f) => { f.manifest.peerDependencies.footprintjs = 'npm:other@13.0.0'; }],
  ['broader engine range', (f) => { f.manifest.peerDependencies.footprintjs = '^12 || ^13'; }],
  ['old authored Foottrace range', (f) => {
    f.manifest.dependencies.foottrace = '^2.1.0';
    f.lock.packages[''].dependencies.foottrace = '^2.1.0';
  }],
  ['context range', (f) => { f.manifest.dependencies.contextfootprint = '^0.1.1'; }],
  ['mismatched root lock', (f) => { f.lock.packages[''].dependencies.foottrace = '^1.0.0'; }],
  ['missing selected record', (f) => { delete f.lock.packages['node_modules/footprintjs']; }],
  ['previous selected Foottrace version', (f) => {
    const row = f.lock.packages['node_modules/foottrace'];
    row.version = '2.1.0';
    row.resolved = 'https://registry.npmjs.org/foottrace/-/foottrace-2.1.0.tgz';
  }],
  ['non-registry selected input', (f) => { f.lock.packages['node_modules/foottrace'].resolved = 'file:/tmp/foottrace.tgz'; }],
  ['malformed integrity', (f) => { f.lock.packages['node_modules/contextfootprint'].integrity = 'sha512-YQ=='; }],
  ['linked selected input', (f) => { f.lock.packages['node_modules/foottrace'].link = true; }],
  ['nested duplicate', (f) => { f.lock.packages['node_modules/other/node_modules/foottrace'] = { ...f.lock.packages['node_modules/foottrace'] }; }],
  ['optional selected input', (f) => { f.manifest.optionalDependencies.footprintjs = '14.6.0'; }],
  ['previous published engine peer on the current engine', (f) => {
    f.lock.packages['node_modules/footprintjs'].peerDependencies.foottrace = '^2.3.1';
  }],
  ['optional engine peer', (f) => { f.manifest.peerDependenciesMeta.footprintjs = { optional: true }; }],
  ['override', (f) => { f.manifest.overrides = { foottrace: '2.1.0' }; }],
  ['substituting the source range for the engine peer range', (f) => {
    f.lock.packages['node_modules/footprintjs'].peerDependencies.foottrace = '^2.3.2';
  }],
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
