import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { archiveBytes } from '../publish-archive/archive-fixture.mjs';
import { verifyDocsInstall, verifyResolutions } from './installed.mjs';

const sources = ['agentfootprint', 'agentfootprint-lens', 'footprint-explainable-ui'];
const native = ['footprintjs', 'foottrace'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sri = (bytes) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'docs-install-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const docs = join(root, 'docs');
  const source = {}, published = {}, packages = {}, dependencies = {};
  for (const name of [...sources, ...native]) {
    const version = '1.0.0';
    // The public entries throw if executed. Resolution alone must suffice.
    const manifest = { name, version, exports: { '.': { import: './dist/esm/entry.mjs', require: './dist/cjs/entry.cjs' } } };
    const files = { 'package.json': JSON.stringify(manifest), 'dist/index.js': 'exports.fixture = true;\n',
      'dist/esm/entry.mjs': 'throw Error("ESM executed")', 'dist/cjs/entry.cjs': 'throw Error("CJS executed")' };
    for (const [file, body] of Object.entries(files)) write(join(docs, 'node_modules', name, file), body);
    const archive = archiveBytes(manifest, { extra: Object.entries(files).slice(2).map(([p, body]) => ['package/' + p, body]) });
    const integrity = sri(archive);
    let resolved;
    if (sources.includes(name)) {
      const path = 'vendor/native-candidate/' + name + '.tgz';
      write(join(docs, path), archive);
      source[name] = { version, sha256: sha(archive), integrity };
      dependencies[name] = resolved = 'file:' + path;
    } else {
      const rows = Object.entries(files).map(([path, body]) => ({ path, size: Buffer.byteLength(body), sha256: sha(body) }))
        .sort((a, b) => a.path.localeCompare(b.path));
      published[name] = { version, integrity, membersSha256: sha(JSON.stringify(rows)) };
      dependencies[name] = version;
      resolved = 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz';
    }
    packages['node_modules/' + name] = { version, resolved, integrity };
  }
  const lock = { lockfileVersion: 3, packages: { '': { dependencies }, ...packages } };
  write(join(docs, 'package.json'), { name: 'fixture-docs', dependencies });
  write(join(docs, 'package-lock.json'), lock);
  write(join(docs, 'node_modules/.package-lock.json'), { lockfileVersion: 3, packages });
  return { docs, source, published, lock, verify: () => verifyDocsInstall(docs, source, published) };
}

test('checks original package bytes and resolves both conditions from every installed consumer', (t) => {
  const f = fixture(t);
  const { resolutions } = f.verify();
  for (const issuer of ['docs', ...sources, 'footprintjs']) {
    for (const name of native) {
      assert.equal(resolutions.require[issuer][name], join(f.docs, 'node_modules', name, 'dist/cjs/entry.cjs'));
      assert.equal(resolutions.import[issuer][name], join(f.docs, 'node_modules', name, 'dist/esm/entry.mjs'));
    }
  }
});

for (const [label, mutate, reason] of [
  ['different vendored bytes', (f) => write(join(f.docs, 'vendor/native-candidate/agentfootprint.tgz'), 'other'), /archive SHA256/],
  ['lifecycle editor in source', (f) => write(join(f.docs, 'node_modules/footprint-explainable-ui/dist/index.js'), 'changed'), /installed members/],
  ['lifecycle file added to engine', (f) => write(join(f.docs, 'node_modules/footprintjs/added'), 'added'), /installed members/],
  ['ordinary lock redirect', (f) => { f.lock.packages['node_modules/foottrace'].resolved = 'https://example.org/copy'; write(join(f.docs, 'package-lock.json'), f.lock); }, /locked locator/],
  ['hidden lock SRI mismatch', (f) => { f.lock.packages['node_modules/agentfootprint-lens'].integrity = 'different'; write(join(f.docs, 'node_modules/.package-lock.json'), f.lock); }, /locked integrity/],
  ['locked nested alias', (f) => { f.lock.packages['node_modules/unrelated/node_modules/copy'] = { name: 'footprintjs' }; write(join(f.docs, 'package-lock.json'), f.lock); }, /locked owner/],
  ['unlocked scoped alias in a nested distribution', (f) => write(join(f.docs, 'node_modules/other/dist/node_modules/@scope/alias/package.json'), { name: 'foottrace' }), /physical owner/],
]) {
  test('refuses ' + label, (t) => { const f = fixture(t); mutate(f); assert.throws(f.verify, reason); });
}

for (const [condition, folder] of [['require', 'cjs'], ['import', 'esm']]) {
  test('detects a private reader at the actual Lens ' + condition + ' entry', (t) => {
    const f = fixture(t);
    const nested = join(f.docs, 'node_modules/agentfootprint-lens/dist', folder, 'node_modules/foottrace');
    write(join(nested, 'package.json'), { name: 'foottrace', exports: './private.js' });
    write(join(nested, 'private.js'), 'throw Error("must not execute")');
    assert.throws(() => verifyResolutions(f.docs), /divergent foottrace entry/);
  });
}

test('refuses a docs import that falls back to an identical parent package', (t) => {
  const f = fixture(t);
  const parentModules = join(dirname(f.docs), 'node_modules');
  mkdirSync(parentModules);
  renameSync(join(f.docs, 'node_modules/foottrace'), join(parentModules, 'foottrace'));
  assert.throws(() => verifyResolutions(f.docs), /external public entry: foottrace/);
});
