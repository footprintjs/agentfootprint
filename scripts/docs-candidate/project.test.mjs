import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyLockDelta } from './project.mjs';
import { closeWorkspace, openWorkspace } from './workspace.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const stringify = (obj) => JSON.stringify(obj, null, 2) + '\n';

test('reconstructs the exact npm lock, preserving unrelated rows and the package order', () => {
  const other = { version: '3.0.0', integrity: 'retained' };
  const before = stringify({ packages: { '': {}, '..': {}, 'node_modules/other': other } });
  const set = { '': { name: 'docs' }, 'node_modules/cohort': { version: '1.0.0' } };
  const after = stringify({ packages: { ...set, 'node_modules/other': other } });
  const delta = { baseSha256: hash(before), resultSha256: hash(after), remove: ['..'], set };
  assert.equal(applyLockDelta(before, delta), after);
  assert.throws(() => applyLockDelta(before + ' ', delta), /base changed/);
  assert.throws(() => applyLockDelta(before, { ...delta, remove: [] }), /differs from npm/);
});

test('discards generated output after a failed candidate build while preserving source bytes', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'test-docs-checkout-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, 'source');
  const docs = join(source, 'docs-next');
  mkdirSync(join(docs, 'vendor/storydeck'), { recursive: true });
  writeFileSync(join(docs, 'package.json'), '{}\n');
  writeFileSync(join(docs, 'package-lock.json'), '{}\n');
  writeFileSync(join(docs, 'vendor/storydeck/storydeck-0.2.0.tgz'), 'original bytes');
  const git = (...args) => execFileSync('git', args, { cwd: source }).toString().trim();
  git('init', '-q');
  git('add', 'docs-next');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-qm', 'fixture');
  const head = git('rev-parse', 'HEAD');
  assert.throws(() => openWorkspace(source, temp, 'wrong'), /wrong CI checkout/);
  const isolated = openWorkspace(source, temp, head);
  writeFileSync(join(isolated.root, 'docs-next/package.json'), 'failed build');
  mkdirSync(join(isolated.root, 'docs-next/out'));
  assert.equal(readFileSync(join(docs, 'package.json'), 'utf8'), '{}\n');
  closeWorkspace(source, temp, isolated.dir);
  assert.equal(existsSync(isolated.dir), false);
  assert.equal(git('status', '--porcelain'), '');
});

test('the npm-generated delta changes only the candidate cohort and its context dependency', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const before = read('../../docs-next/package-lock.json');
  const delta = JSON.parse(read('./lock-delta.json'));
  const after = JSON.parse(applyLockDelta(before, delta)).packages;
  assert.deepEqual(delta.remove, ['..']);
  assert.deepEqual(Object.keys(delta.set).sort(), ['', ...[
    'agentfootprint', 'agentfootprint-lens', 'contextfootprint', 'footprint-explainable-ui',
    'footprintjs', 'foottrace',
  ].map((name) => 'node_modules/' + name)].sort());
  const original = JSON.parse(before).packages;
  assert.deepEqual(after['node_modules/storydeck'], original['node_modules/storydeck']);
  for (const { name, filename, version, tar } of JSON.parse(read('./pins.json'))) {
    assert.equal(after[''].dependencies[name], 'file:vendor/native-candidate/' + filename);
    const row = after['node_modules/' + name];
    assert.equal(row.version, version);
    assert.equal(row.integrity, tar.integrity);
    assert.equal(row.resolved, after[''].dependencies[name]);
  }
});
