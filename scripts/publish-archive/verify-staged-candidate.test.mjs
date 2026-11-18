import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { archiveBytes } from './archive-fixture.mjs';
import { verifyStagedCandidate } from './verify-staged-candidate.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'af-test-staged-'));
  t.after(() => rmSync(directory, { recursive: true }));
  const root = join(directory, 'source');
  mkdirSync(join(root, 'dist'), { recursive: true });
  const manifest = { name: 'agentfootprint', version: '14.10.0', files: ['dist'] };
  const manifestPath = join(root, 'package.json');
  const original = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(manifestPath, original);
  const member = join(root, 'dist', 'index.js');
  writeFileSync(member, 'exports.fixture = true;\n');
  const source = join(directory, 'source.tgz');
  writeFileSync(source, archiveBytes(manifest));
  return { root, source, member, manifestPath, original };
}

test('a same-run npm pack can stage just the planned version', (t) => {
  const { root, source, manifestPath, original } = fixture(t);
  const result = verifyStagedCandidate(root, source, '15.0.0-rc.8');
  assert.equal(result.sourceVersion, '14.10.0');
  assert.equal(result.stagedVersion, '15.0.0-rc.8');
  assert.notEqual(result.sourceSha256, result.stagedSha256);
  assert.equal(readFileSync(manifestPath, 'utf8'), original);
});

test('staging refuses a byte change in an otherwise valid shipped member', (t) => {
  const { root, source, member, manifestPath, original } = fixture(t);
  writeFileSync(member, 'exports.fixture = mutated;\n');
  assert.throws(
    () => verifyStagedCandidate(root, source, '15.0.0-rc.8'),
    /RC staging changed shipped files/,
  );
  assert.equal(readFileSync(manifestPath, 'utf8'), original);
});
