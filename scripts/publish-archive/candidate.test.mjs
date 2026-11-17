import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { archiveBytes } from './archive-fixture.mjs';

const require = createRequire(import.meta.url);
const { retainCandidate } = require('./candidate.cjs');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'af-candidate-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'source');
  const output = path.join(parent, 'artifact');
  mkdirSync(root);
  mkdirSync(output);
  const manifest = { name: 'agentfootprint', version: '15.0.0-rc.0' };
  const manifestText = JSON.stringify(manifest);
  writeFileSync(path.join(root, 'package.json'), manifestText);
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'dist/index.js'), 'exports.fixture = true;\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', 'package.json', 'package-lock.json');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  const head = git('rev-parse', 'HEAD');
  const bytes = archiveBytes(manifest);
  writeFileSync(path.join(output, 'candidate.tgz'), bytes);
  return { root, output, manifest, bytes, git, head };
}

test('retains the original source manifest, lock, archive and every member identity', (t) => {
  const f = fixture(t);
  const record = retainCandidate(f.root, f.output, f.head);
  assert.equal(record.source.head, f.head);
  assert.equal(record.source.tree, f.git('rev-parse', 'HEAD^{tree}'));
  assert.equal(record.tested.head, f.head);
  assert.equal(record.source.manifestSha256, hash(readFileSync(path.join(f.root, 'package.json'))));
  assert.equal(record.source.lockSha256, hash(readFileSync(path.join(f.root, 'package-lock.json'))));
  assert.equal(record.archive.sha256, hash(f.bytes));
  assert.equal(record.archive.integrity, 'sha512-' + createHash('sha512').update(f.bytes).digest('base64'));
  assert.equal(record.archive.files.length, 2);
  assert.equal(readFileSync(path.join(f.output, 'source-package.json'), 'utf8'), JSON.stringify(f.manifest));
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.output, 'candidate.json'))), record);
  assert.deepEqual(readFileSync(path.join(f.output, 'candidate.tgz')), f.bytes);
});

test('retains a source head from a depth-two PR merge checkout with the same tree', (t) => {
  const f = fixture(t);
  const commit = (...args) => f.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args);
  f.git('checkout', '-qb', 'other');
  commit('commit', '--allow-empty', '-qm', 'other');
  f.git('checkout', '-qb', 'ci-merge', f.head);
  commit('commit', '--allow-empty', '-qm', 'source');
  const head = f.git('rev-parse', 'HEAD');
  commit('merge', '--no-ff', '-m', 'PR merge', 'other');
  const checkout = path.join(f.root, '..', 'checkout');
  execFileSync('git', ['clone', '-q', '--depth', '2', '--branch', 'ci-merge', pathToFileURL(f.root).href, checkout]);
  assert.equal(execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: checkout, encoding: 'utf8' }).trim(), 'true');
  mkdirSync(path.join(checkout, 'dist'));
  writeFileSync(path.join(checkout, 'dist/index.js'), 'exports.fixture = true;\n');
  const record = retainCandidate(checkout, f.output, head);
  assert.equal(record.source.head, head);
  assert.equal(record.tested.head, f.git('rev-parse', 'HEAD'));
  assert.notEqual(record.tested.head, record.source.head);
  assert.equal(record.tested.tree, record.source.tree);
});

test('accepts a generator rewriting identical tracked bytes without refreshing the index', (t) => {
  const f = fixture(t);
  const file = path.join(f.root, 'package.json');
  writeFileSync(file, readFileSync(file));
  const later = new Date(Date.now() + 2000);
  utimesSync(file, later, later);
  assert.equal(retainCandidate(f.root, f.output, f.head).source.head, f.head);
});

for (const [name, mutate] of [
  ['changed source manifest', (f) => writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ ...f.manifest, version: '15.0.0-rc.1' }))],
  ['changed tracked lock', (f) => writeFileSync(path.join(f.root, 'package-lock.json'), '{}')],
  ['wrong packed version', (f) => writeFileSync(path.join(f.output, 'candidate.tgz'), archiveBytes({ ...f.manifest, version: '15.0.0-rc.1' }))],
  ['wrong built member', (f) => writeFileSync(path.join(f.root, 'dist/index.js'), 'exports.fixture = null;\n')],
  ['second archive', (f) => writeFileSync(path.join(f.output, 'second.tgz'), f.bytes)],
  ['linked built member', (f) => {
    const target = path.join(f.root, 'dist/target.js');
    writeFileSync(target, readFileSync(path.join(f.root, 'dist/index.js')));
    rmSync(path.join(f.root, 'dist/index.js'));
    symlinkSync(target, path.join(f.root, 'dist/index.js'));
  }],
  ['different tested tree', (f) => { writeFileSync(path.join(f.root, 'other'), 'new source'); f.git('add', 'other'); f.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'other'); }],
]) {
  test('refuses ' + name + ' before retaining a success receipt', (t) => {
    const f = fixture(t);
    mutate(f);
    assert.throws(() => retainCandidate(f.root, f.output, f.head));
    assert.throws(() => readFileSync(path.join(f.output, 'candidate.json')), /ENOENT/);
  });
}
