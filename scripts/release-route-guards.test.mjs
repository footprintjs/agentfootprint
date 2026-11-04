import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
function shell(start, end) {
  const block = workflow.slice(
    workflow.indexOf(start),
    end ? workflow.indexOf(end, workflow.indexOf(start)) : undefined,
  );
  const marker = '        run: |\n',
    at = block.lastIndexOf(marker);
  assert(at >= 0, 'existing shell missing');
  return block
    .slice(at + marker.length)
    .split('\n')
    .map((l) => (l.startsWith('          ') ? l.slice(10) : l))
    .join('\n');
}
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git'),
    repo = path.join(root, 'repo'),
    temp = path.join(root, 'temp');
  mkdirSync(repo);
  mkdirSync(temp);
  const env = {
    PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  function run(file, args, cwd = repo, extra = {}) {
    const r = spawnSync(file, args, {
      cwd,
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 512 * 1024,
    });
    assert.equal(r.error, undefined);
    assert.equal(r.signal, null);
    return r;
  }
  function git(args, cwd = repo) {
    const r = run('/usr/bin/git', args, cwd);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  }
  git(['init', '--bare', remote], root);
  git(['-c', 'init.defaultBranch=main', 'init']);
  git(['remote', 'add', 'origin', remote]);
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '13.0.1' }));
  mkdirSync(path.join(repo, '.changes'));
  mkdirSync(path.join(repo, 'scripts'));
  writeFileSync(
    path.join(repo, 'scripts/changes.mjs'),
    readFileSync(path.join(ROOT, 'scripts/changes.mjs')),
  );
  git(['add', '.']);
  git(['commit', '-m', 'source']);
  const sha = git(['rev-parse', 'HEAD']);
  git(['push', 'origin', 'main']);
  return {
    root,
    repo,
    remote,
    temp,
    sha,
    run,
    git,
    bash: (script, extra = {}) =>
      run('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], repo, {
        VERSION: '13.0.1',
        SHA: sha,
        MODE: 'publish',
        RUNNER_TEMP: temp,
        GITHUB_OUTPUT: path.join(temp, 'output'),
        GITHUB_STEP_SUMMARY: path.join(temp, 'summary'),
        EVENT_NAME: 'push',
        RC: 'false',
        BUMP: 'auto',
        ...extra,
      }),
  };
}
test('release guards: RC has a queue separate from main and legacy tags', () => {
  const expression = /group: release-\$\{\{ (.+) \}\}/.exec(workflow)?.[1];
  assert(expression, 'release group expression missing');
  const group = Function('github', 'inputs', 'return (' + expression + ');');
  assert.equal(
    group({ event_name: 'workflow_dispatch', ref: 'refs/heads/main' }, { rc: true }),
    'rc',
  );
  assert.equal(group({ event_name: 'push', ref: 'refs/heads/main' }, {}), 'main');
  assert.equal(
    group({ event_name: 'workflow_dispatch', ref: 'refs/heads/main' }, { rc: false }),
    'main',
  );
  assert.equal(
    group({ event_name: 'release', ref: 'refs/tags/v13.0.1' }, { rc: true }),
    'refs/tags/v13.0.1',
  );
});
test('release guards: a tag with the target ref only as its tail does not suppress publication', (t) => {
  const f = fixture(t);
  f.git(['tag', 'x/refs/tags/v13.0.1']);
  f.git(['push', 'origin', 'refs/tags/x/refs/tags/v13.0.1']);
  const r = f.bash(shell('      - id: plan\n', '  # Did CI'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(path.join(f.temp, 'output'), 'utf8'), /^mode=publish$/m);
});
test('release guards: tag creation ignores a suffix collision and pins the plan SHA', (t) => {
  const f = fixture(t);
  f.git(['tag', 'x/refs/tags/v13.0.1']);
  f.git(['push', 'origin', 'refs/tags/x/refs/tags/v13.0.1']);
  const r = f.bash(shell('      - name: Tag\n', '      # The notes'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.git(['--git-dir', f.remote, 'rev-parse', 'refs/tags/v13.0.1'], f.root), f.sha);
});
test('release guards: an existing RC tag on another source refuses without a push', (t) => {
  const f = fixture(t),
    tag = 'v14.0.0-rc.0';
  const other = f.git([
    'commit-tree',
    f.git(['rev-parse', 'HEAD^{tree}']),
    '-p',
    f.sha,
    '-m',
    'different source',
  ]);
  f.git(['tag', tag, other]);
  f.git(['push', 'origin', 'refs/tags/' + tag]);
  const r = f.bash(shell('      - name: Tag\n', '      # The notes'), {
    VERSION: '14.0.0-rc.0',
    MODE: 'rc',
  });
  assert.notEqual(r.status, 0);
  assert.equal(f.git(['--git-dir', f.remote, 'rev-parse', 'refs/tags/' + tag], f.root), other);
});
test('release guards: an existing RC tag on the plan source is an idempotent no-op', (t) => {
  const f = fixture(t),
    tag = 'v14.0.0-rc.0';
  f.git(['tag', tag]);
  f.git(['push', 'origin', 'refs/tags/' + tag]);
  const r = f.bash(shell('      - name: Tag\n', '      # The notes'), {
    VERSION: '14.0.0-rc.0',
    MODE: 'rc',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.git(['--git-dir', f.remote, 'rev-parse', 'refs/tags/' + tag], f.root), f.sha);
});
test('release guards: stable and RC GitHub releases require an already-pushed exact tag', (t) => {
  const f = fixture(t),
    bin = path.join(f.root, 'bin'),
    calls = path.join(f.temp, 'calls');
  mkdirSync(bin);
  writeFileSync(path.join(f.repo, 'CHANGELOG.md'), '# Changelog\n');
  const gh = path.join(bin, 'gh');
  writeFileSync(
    gh,
    '#!/bin/sh\nif [ "$1" = release ] && [ "$2" = view ]; then exit 1; fi\nprintf "%s\\n" "$@" >> "$CALLS"\n',
  );
  chmodSync(gh, 0o700);
  for (const mode of ['publish', 'rc']) {
    writeFileSync(calls, '');
    const r = f.bash(shell('      - name: GitHub release\n', '  publish:\n'), {
      MODE: mode,
      PATH: bin + ':/usr/bin:/bin',
      CALLS: calls,
    });
    assert.equal(r.status, 0, r.stderr);
    assert(
      readFileSync(calls, 'utf8').split('\n').includes('--verify-tag'),
      'release must never create a missing tag implicitly',
    );
  }
});
test('release guards: candidate CLI reads actual tag rows and leaves fragments intact', (t) => {
  const f = fixture(t),
    fragment =
      '---\ntype: breaking\n---\nSynthetic breaking change.\n\nMigration: use the new contract.\n';
  writeFileSync(path.join(f.repo, '.changes/change.md'), fragment);
  const tags = path.join(f.temp, 'tags');
  writeFileSync(tags, f.sha + '\trefs/tags/v14.0.0-rc.3\n' + f.sha + '\trefs/tags/v15.0.0-rc.90\n');
  const r = f.run(process.execPath, [
    'scripts/changes.mjs',
    'candidate',
    '--tags-file',
    tags,
    '--bump',
    'auto',
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '14.0.0-rc.4');
  assert.equal(readFileSync(path.join(f.repo, '.changes/change.md'), 'utf8'), fragment);
  writeFileSync(tags, 'unreadable tag row\n');
  const bad = f.run(process.execPath, ['scripts/changes.mjs', 'candidate', '--tags-file', tags]);
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout, '');
});
