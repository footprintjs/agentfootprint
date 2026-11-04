import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import * as changes from './changes.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
const active = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\r?\n\s*/g, ' ');
function job(name) {
  const start = workflow.indexOf('\n  ' + name + ':\n');
  assert(start >= 0, 'existing native ' + name + ' job missing');
  const after = workflow.slice(start + 1),
    end = after.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return active(end < 0 ? after : after.slice(0, end + 1));
}
function preparation(label, args = []) {
  const parent =
    process.env.R0_PROOF_ROOT ?? path.join(os.tmpdir(), 'af-r0-small-native-preparation');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, label + '-'));
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, '.changes'));
  for (const name of ['changes.mjs', 'release-prepare.mjs'])
    copyFileSync(path.join(ROOT, 'scripts', name), path.join(root, 'scripts', name));
  const fragment =
    '---\ntype: breaking\n---\nA synthetic breaking change.\n\nMigration: use the new synthetic contract.\n';
  writeFileSync(path.join(root, '.changes/change.md'), fragment);
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'agentfootprint', version: '13.2.0' }, null, 2) + '\n',
  );
  writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify(
      {
        name: 'agentfootprint',
        version: '13.2.0',
        lockfileVersion: 3,
        packages: { '': { name: 'agentfootprint', version: '13.2.0' } },
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## [13.2.0] - 2026-11-01\n\nPrevious synthetic release.\n',
  );
  const capabilities =
    '| Capability | Since |\n| --- | --- |\n| Synthetic next feature | unreleased |\n';
  writeFileSync(path.join(root, 'CAPABILITIES.md'), capabilities);
  const output = spawnSync(
    process.execPath,
    ['scripts/release-prepare.mjs', '--bump', 'major', '--date', '2026-11-04', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 512 * 1024,
      env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', TZ: 'UTC' },
    },
  );
  assert.equal(
    output.error,
    undefined,
    'native preparation setup/timeout must not earn a product red',
  );
  assert.equal(output.signal, null);
  assert.equal(output.status, 0, output.stderr);
  return {
    root,
    fragment,
    capabilities,
    output,
    read: (name) => readFileSync(path.join(root, name), 'utf8'),
  };
}
test('R0-small positive: native unprivileged preparation remains separate from the App writer', () => {
  assert(!/create-github-app-token@/.test(job('propose')));
  assert(/create-github-app-token@/.test(job('release-pr')));
  assert(/permission-contents:\s*write/.test(job('release-pr')));
  assert(/permission-pull-requests:\s*write/.test(job('release-pr')));
  assert(!/\bnpm\s+(?:ci|install|run)\b/.test(job('release-pr')));
});
test('R0-small positive: final native release consumes fragments and stamps the stable version', () => {
  const f = preparation('final-control');
  assert.equal(JSON.parse(f.read('package.json')).version, '14.0.0');
  assert.equal(JSON.parse(f.read('package-lock.json')).version, '14.0.0');
  assert.deepEqual(readdirSync(path.join(f.root, '.changes')), []);
  assert(f.read('CAPABILITIES.md').includes('| 14.0.0 |'));
  assert(f.read('CHANGELOG.md').includes('## [14.0.0] - 2026-11-04'));
});
test('R0-small release job refuses every force push spelling and force refspec', () => {
  const commands = job('release-pr');
  assert(
    !/\bgit[^\n]*\bpush[^\n]*(?:--force(?:-with-lease)?(?:[=\s]|$)|\s-f(?:\s|$)|\s\+\S+)/m.test(
      commands,
    ),
    'native release-pr still rewrites a remote ref with force',
  );
});
test('R0-small release job never invokes automatic PR merge', () => {
  assert(
    !/\bgh\s+pr\s+merge\b[^\n]*--auto\b/m.test(job('release-pr')),
    'release PR must wait for its exact-head verdict',
  );
});
function candidate(current, fragments, tags) {
  assert.equal(
    typeof changes.candidateVersion,
    'function',
    'native candidate version function is missing',
  );
  return changes.candidateVersion(current, fragments, tags);
}
const fixed = () =>
  changes.parseFragment('.changes/fix.md', '---\ntype: fixed\n---\nA synthetic correction.\n');
const breaking = () =>
  changes.parseFragment(
    '.changes/break.md',
    '---\ntype: breaking\n---\nA synthetic break. Migration: use the new contract.\n',
  );
test('R0-small dispatch exposes a boolean RC mode in the existing native workflow', () => {
  const dispatch = active(
    workflow.slice(workflow.indexOf('  workflow_dispatch:'), workflow.indexOf('\n  release:\n')),
  );
  assert(/\n      rc:\n/.test(dispatch), 'native dispatch has no RC input');
  assert(/rc:\n[^]*?type: boolean/.test(dispatch), 'RC dispatch must be boolean');
  assert(job('plan').includes('mode=rc'), 'native plan has no separate RC mode');
});
test('R0-small pure candidate version starts at rc.0 without changing source', () => {
  assert.equal(candidate('13.2.0', [fixed()], []), '13.2.1-rc.0');
});
test('R0-small pure candidate version increments only the matching candidate tag cohort', () => {
  assert.equal(
    candidate('13.2.0', [fixed()], ['v13.2.1-rc.0', 'v13.2.1-rc.9', 'v14.0.0-rc.70']),
    '13.2.1-rc.10',
  );
});
test('R0-small pure candidate version preserves the major floor implied by fragments', () => {
  assert.equal(candidate('13.2.0', [fixed(), breaking()], ['v14.0.0-rc.1']), '14.0.0-rc.2');
});
test('R0-small pure candidate version refuses an empty fragment set', () => {
  assert.equal(
    typeof changes.candidateVersion,
    'function',
    'native candidate version function is missing',
  );
  assert.throws(() => changes.candidateVersion('13.2.0', [], []), /no fragments/i);
});
test('R0-small RC never reaches proposal or docs jobs and never invokes the native preparer', () => {
  assert(/needs.plan.outputs.mode == 'propose'/.test(job('propose')));
  assert(
    /needs.plan.outputs.mode == 'propose'/.test(job('release-pr')),
    'RC must never enter the App proposal writer',
  );
  assert(
    /needs.plan.outputs.mode == 'publish'/.test(job('docs')),
    'RC must never deploy docs or re-dispatch',
  );
  assert(!/--rc\b/.test(job('propose')), 'RC must not use the committing native preparer');
  assert(
    /npm version "\$VERSION" --no-git-tag-version --ignore-scripts/.test(job('build')),
    'RC package version must change only after the untouched-source gates',
  );
});
test('R0-small native publish derives an explicit next/latest tag from staged package data', () => {
  const publish = job('publish');
  assert(/--tag\s+["']?\$NPM_TAG/.test(publish), 'npm publication has no explicit native tag');
  assert(publish.includes('NPM_TAG=next'), 'RC artifact has no next classification');
  assert(
    publish.includes('NPM_TAG=latest'),
    'stable artifact has no explicit latest classification',
  );
  assert(
    /jq[^\n]*version[^\n]*package.json/.test(publish),
    'publish must classify the staged package version',
  );
});

test('R0-small pure candidate refuses ambiguous matching native tags', () => {
  assert.throws(
    () => changes.candidateVersion('13.2.0', [fixed()], ['v13.2.1-rc.01']),
    /noncanonical/,
  );
  assert.throws(
    () => changes.candidateVersion('13.2.0', [fixed()], ['v13.2.1-rc.9007199254740992']),
    /noncanonical/,
  );
});
test('R0-small candidate preserves raise-only explicit bump selection', () => {
  assert.equal(changes.candidateVersion('13.2.0', [fixed()], [], 'minor'), '13.3.0-rc.0');
  assert.throws(() => changes.candidateVersion('13.2.0', [breaking()], [], 'patch'), /floor/);
});

function stagedPublish(version) {
  const parent = process.env.R0_PROOF_ROOT ?? path.join(os.tmpdir(), 'af-r0-publish');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'staged-')),
    bin = path.join(root, 'bin'),
    output = path.join(root, 'args');
  mkdirSync(bin);
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'synthetic-package', version }),
  );
  const npm = path.join(bin, 'npm');
  writeFileSync(npm, '#!/bin/sh\nprintf "%s\\n" "$@" > "$NPM_ARGS"\n');
  chmodSync(npm, 0o700);
  const block = job('publish'),
    marker = '        run: |\n',
    at = block.lastIndexOf(marker);
  assert(at >= 0, 'actual native publisher shell missing');
  const script = block
    .slice(at + marker.length)
    .split('\n')
    .map((l) => (l.startsWith('          ') ? l.slice(10) : l))
    .join('\n');
  const r = spawnSync(
    '/bin/bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 512 * 1024,
      env: { PATH: bin + ':/usr/bin:/bin', NPM_ARGS: output },
    },
  );
  assert.equal(r.error, undefined);
  assert.equal(r.signal, null);
  assert(
    !/command not found|SyntaxError/.test(r.stderr),
    'publisher fixture setup failed: ' + r.stderr,
  );
  return { r, args: existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n') : [] };
}
test('R0-small actual publisher shell binds canonical RC package data to npm next', () => {
  const { r, args } = stagedPublish('14.0.0-rc.10');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(args, ['publish', '--provenance', '--access', 'public', '--tag', 'next']);
});
test('R0-small actual publisher shell binds stable package data to explicit npm latest', () => {
  const { r, args } = stagedPublish('13.2.0');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(args, ['publish', '--provenance', '--access', 'public', '--tag', 'latest']);
});
for (const version of ['014.0.0', '14.0.0-rc.01', '14.0.0-beta.1', '14.0.0+build.1', 4]) {
  test('R0-small publisher refuses unsupported package version ' + String(version), () => {
    const { r, args } = stagedPublish(version);
    assert.notEqual(r.status, 0);
    assert.deepEqual(args, []);
  });
}
