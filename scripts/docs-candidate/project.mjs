/** Apply only the dependency rows npm resolved for this unpublished docs cohort. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (obj) => JSON.stringify(obj, null, 2) + '\n';
const byKey = (object) => Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
const published = { footprintjs: '14.0.0-rc.0', foottrace: '2.1.0' };

export function applyLockDelta(text, delta) {
  assert.equal(hash(text), delta.baseSha256, 'docs lock base changed');
  const lock = JSON.parse(text);
  for (const row of delta.remove) {
    assert(Object.hasOwn(lock.packages, row), 'unknown dependency row ' + row);
    delete lock.packages[row];
  }
  Object.assign(lock.packages, delta.set);
  lock.packages = byKey(lock.packages);
  const result = json(lock);
  assert.equal(hash(result), delta.resultSha256, 'projected lock differs from npm output');
  return result;
}

export function project(root, inputDir, inputs, delta) {
  const docs = join(root, 'docs-next');
  const manifestPath = join(docs, 'package.json');
  const lockPath = join(docs, 'package-lock.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const originalLock = readFileSync(lockPath, 'utf8');
  const lockText = applyLockDelta(originalLock, delta);
  assert.deepEqual(manifest.dependencies, JSON.parse(originalLock).packages[''].dependencies);
  const dependencies = { ...manifest.dependencies, ...published };
  const vendor = join(docs, 'vendor/native-candidate');
  assert(!existsSync(vendor), 'candidate vendor directory already exists');
  mkdirSync(vendor);
  for (const selected of inputs) {
    const from = join(inputDir, selected.filename);
    assert.equal(realpathSync(from), from);
    assert.equal(hash(readFileSync(from)), selected.tar.sha256, selected.filename);
    copyFileSync(from, join(vendor, selected.filename), constants.COPYFILE_EXCL);
    dependencies[selected.name] = 'file:vendor/native-candidate/' + selected.filename;
  }
  manifest.dependencies = byKey(dependencies);
  assert.deepEqual(manifest.dependencies, JSON.parse(lockText).packages[''].dependencies);
  writeFileSync(manifestPath, json(manifest));
  writeFileSync(lockPath, lockText);
  console.log('Installed-input lock prepared', delta.resultSha256, manifest.dependencies);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { DOCS_INPUTS } = await import('./inputs.mjs');
  if (process.argv[2] === '--compare-pack') {
    const selected = DOCS_INPUTS.find((input) => input.name === 'agentfootprint');
    const tar = readFileSync(join(process.argv[3], 'agentfootprint-' + selected.version + '.tgz'));
    assert.equal(hash(tar), selected.tar.sha256, 'current AF source package differs from admitted docs input');
    console.log('Current AF pack matches admitted source', selected.source.head, hash(tar));
  } else {
    const dir = realpathSync(process.argv[2]);
    const state = JSON.parse(readFileSync(join(dir, 'original.json'), 'utf8'));
    assert.equal(realpathSync(process.cwd()), realpathSync(join(dir, 'checkout')));
    assert.equal(state.root, realpathSync(process.env.GITHUB_WORKSPACE));
    project(process.cwd(), join(dir, 'inputs'), DOCS_INPUTS,
      JSON.parse(readFileSync(new URL('./lock-delta.json', import.meta.url), 'utf8')));
  }
}
