import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { archiveBytes } from './archive-fixture.mjs';
import { stagedPublish } from '../publish-test-fixture.mjs';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const workflow = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
const begin = workflow.indexOf('      - name: Stage published package'),
  end = workflow.indexOf('      - uses: actions/upload-artifact@', begin);
const block = workflow.slice(begin, end),
  at = block.indexOf('        run: |\n');
assert(begin > 0 && end > begin && at > 0);
const script = block
  .slice(at + '        run: |\n'.length)
  .split('\n')
  .map((l) => (l.startsWith('          ') ? l.slice(10) : l))
  .join('\n');
for (const [version, config] of [
  ['13.2.0', undefined],
  ['14.0.0-rc.10', undefined],
  ['14.0.0-rc.10', { tag: 'latest' }],
])
  test(
    'actual native build packs and inspects the fixed upload ' +
      version +
      ' ' +
      (config ? 'config' : 'clean'),
    (t) => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'archive-build-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const bin = path.join(root, 'bin'),
        run = path.join(root, 'runner'),
        archive = path.join(run, 'archive');
      for (const folder of [bin, run, path.join(root, 'scripts/publish-archive')])
        mkdirSync(folder, { recursive: true });
      for (const name of ['archive.cjs', 'verify.cjs'])
        copyFileSync(
          path.join(ROOT, 'scripts/publish-archive', name),
          path.join(root, 'scripts/publish-archive', name),
        );
      const source = {
        name: 'agentfootprint',
        version: '13.2.0',
        scripts: { prepublishOnly: 'exit 91' },
      };
      writeFileSync(path.join(root, 'package.json'), JSON.stringify(source));
      const env = {
        PATH: bin + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      };
      const git = (args) =>
        spawnSync('/usr/bin/git', args, { cwd: root, env, encoding: 'utf8', timeout: 10000 });
      for (const args of [
        ['init', '-q'],
        ['add', 'package.json'],
        ['commit', '-qm', 'fixture'],
      ])
        assert.equal(git(args).status, 0);
      const sha = git(['rev-parse', 'HEAD']).stdout.trim();
      assert.match(sha, /^[0-9a-f]{40}$/);
      const manifest = { ...source, version, ...(config ? { publishConfig: config } : {}) },
        bytes = archiveBytes(manifest);
      const input = path.join(root, 'fixture.tgz');
      writeFileSync(input, bytes);
      writeFileSync(
        path.join(bin, 'npm'),
        '#!/bin/sh\n[ "$1" = pack ] && [ "$2" = --ignore-scripts ] && [ "$3" = --json ] && [ "$4" = --pack-destination ] || exit 95\n/bin/cp "$FIXTURE_ARCHIVE" "$5/agentfootprint-$PLANNED_VERSION.tgz"\nprintf \'[{"filename":"agentfootprint-%s.tgz"}]\\n\' "$PLANNED_VERSION"\n',
      );
      chmodSync(path.join(bin, 'npm'), 0o700);
      const result = spawnSync(
        '/bin/bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
        {
          cwd: root,
          env: {
            ...env,
            FIXTURE_ARCHIVE: input,
            PLANNED_VERSION: version,
            SOURCE_SHA: sha,
            ARCHIVE_DIR: archive,
            RUNNER_TEMP: run,
          },
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, config ? 1 : 0, result.stdout + result.stderr);
      if (config) {
        assert.match(result.stdout, /manifest-source:publishConfig/);
        return;
      }
      assert.deepEqual(readdirSync(archive), ['package.tgz']);
      assert.deepEqual(readFileSync(path.join(archive, 'package.tgz')), bytes);
      const published = stagedPublish(t, version, version, {}, null, source, {
        archiveBytes: readFileSync(path.join(archive, 'package.tgz')),
      });
      assert.equal(published.r.status, 0, published.r.stdout + published.r.stderr);
      assert.equal(published.args[1], './package.tgz');
    },
  );
test('workflow binds trusted verifier, incoming archive and empty npm cwd independently', () => {
  const start = workflow.indexOf('\n  publish:\n'),
    publish = workflow.slice(start, workflow.indexOf('\n  docs:', start));
  assert(
    publish.indexOf('cp scripts/publish-archive/') < publish.indexOf('actions/download-artifact@'),
  );
  assert(
    publish.indexOf('name: Read the pinned source manifest') <
      publish.indexOf('actions/download-artifact@'),
  );
  assert(publish.includes('ref: ${{ needs.plan.outputs.sha }}'));
  assert(publish.includes('path: ${{ runner.temp }}/af-incoming-'));
  assert(publish.includes('working-directory: ${{ runner.temp }}/af-publish-'));
  assert(publish.includes('VERIFY_DIR: ${{ runner.temp }}/af-verify-'));
  assert(!/tar\s.*-x|npm (ci|run)|npx |require\(.\/package/.test(publish));
  assert(publish.includes('npm@11.19.0 --registry=https://registry.npmjs.org'));
  assert(block.includes('npm pack --ignore-scripts --json --pack-destination "$ARCHIVE_DIR"'));
  assert(workflow.slice(end, end + 500).includes('/package.tgz'));
});

test('trusted npm setup precedes dispatch-source checkout in the native build', () => {
  const start = workflow.indexOf('\n  build:\n'),
    end = workflow.indexOf('\n  release:\n', start),
    build = workflow.slice(start, end);
  assert(
    build.indexOf('npm install -g npm@11.19.0') < build.indexOf('actions/checkout@'),
    'source configuration must not influence the trusted npm installation',
  );
  assert(build.includes('npm@11.19.0 --registry=https://registry.npmjs.org --ignore-scripts'));
});

test('publish installs the trusted toolchain before any candidate source', () => {
  const start = workflow.indexOf('\n  publish:\n'),
    end = workflow.indexOf('\n  docs:\n', start),
    publish = workflow.slice(start, end);
  assert(
    publish.indexOf('npm install -g npm@11.19.0') < publish.indexOf('actions/checkout@'),
    'publish must mirror build: trusted tools before source',
  );
  assert(
    publish.includes(
      'npm install -g npm@11.19.0 --registry=https://registry.npmjs.org --ignore-scripts',
    ),
  );
});

test('actual publish directory setup enforces mode0700 even under umask000', (t) => {
  const start = workflow.indexOf(
      '      - name: Prepare separate verifier, incoming and publish directories',
    ),
    end = workflow.indexOf('      - run: npm install -g ', start),
    block = workflow.slice(start, end),
    marker = '        run: |\n',
    at = block.indexOf(marker);
  assert(start > 0 && end > start && at > 0);
  const script = block
    .slice(at + marker.length)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
  const root = mkdtempSync(path.join(os.tmpdir(), 'native-private-dirs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directories = {
    VERIFY_DIR: path.join(root, 'verify'),
    INCOMING_DIR: path.join(root, 'incoming'),
    PUBLISH_DIR: path.join(root, 'publish'),
  };
  const result = spawnSync(
    '/bin/bash',
    ['--noprofile', '--norc', '-e', '-c', 'umask 000\n' + script],
    {
      cwd: root,
      env: { PATH: '/usr/bin:/bin', ...directories },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const directory of Object.values(directories))
    assert.equal(statSync(directory).mode & 0o777, 0o700);
});
