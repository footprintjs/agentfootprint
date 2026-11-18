import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { candidateVersion, readFragments } from '../changes.mjs';
import verify from './verify.cjs';

export function verifyStagedCandidate(root, sourceArchive, plannedVersion) {
  const manifestPath = join(root, 'package.json');
  const original = readFileSync(manifestPath);
  const manifest = JSON.parse(original);
  const source = verify.inspectFile(sourceArchive, manifest, manifest.version).report;
  const output = mkdtempSync(join(tmpdir(), 'af-ci-staged-'));
  const stagedName = `agentfootprint-${plannedVersion}.tgz`;
  try {
    try {
      writeFileSync(
        manifestPath,
        JSON.stringify({ ...manifest, version: plannedVersion }, null, 2) + '\n',
      );
      execFileSync(
        'npm',
        ['pack', '--ignore-scripts', '--offline', '--loglevel=error', '--pack-destination', output],
        { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
      );
    } finally {
      writeFileSync(manifestPath, original);
    }
    assert.deepEqual(readdirSync(output), [stagedName], 'expected only the staged package');
    const staged = verify.inspectFile(join(output, stagedName), manifest, plannedVersion).report;
    const payload = ({ files }) =>
      Object.fromEntries(
        files
          .filter(({ path }) => path !== 'package/package.json')
          .map(({ path, ...identity }) => [path, identity]),
      );
    assert.deepEqual(payload(staged), payload(source), 'RC staging changed shipped files');
    return {
      sourceVersion: source.version,
      sourceSha256: source.sha256,
      stagedVersion: staged.version,
      stagedSha256: staged.sha256,
    };
  } finally {
    rmSync(output, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fragments = readFragments();
  if (fragments.length === 0) {
    console.log('There are no change fragments for a release candidate.');
  } else {
    const root = process.cwd();
    const output = resolve(process.argv[2]);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
    const receipt = JSON.parse(readFileSync(join(output, 'candidate.json')));
    const sourceName = `agentfootprint-${manifest.version}.tgz`;
    assert.equal(receipt.archive.filename, sourceName);
    const tags = execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' })
      .trim()
      .split('\n');
    const plannedVersion = candidateVersion(manifest.version, fragments, tags);
    const result = verifyStagedCandidate(root, join(output, sourceName), plannedVersion);
    assert.equal(
      result.sourceSha256,
      receipt.archive.sha256,
      'source pack differs from its CI receipt',
    );
    console.log('Source and staged candidate have the same shipped files', JSON.stringify(result));
  }
}
