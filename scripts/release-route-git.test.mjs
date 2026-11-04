import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
const start = workflow.indexOf('\n  release-pr:\n');
const block = workflow.slice(start);
const at = block.lastIndexOf('        run: |\n');
assert(at >= 0, 'native writer shell missing');
const SCRIPT = block
  .slice(at + '        run: |\n'.length)
  .split('\n')
  .map((l) => (l.startsWith('          ') ? l.slice(10) : l))
  .join('\n');
assert(!SCRIPT.includes('${{'), 'native shell must not interpolate workflow expressions');
const GIT = '/usr/bin/git';

function fixture({ prior = true, race = false, badBundle = false, uncertainCreate = false } = {}) {
  const parent = process.env.R0_PROOF_ROOT ?? path.join(os.tmpdir(), 'af-r0-small-git');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'native-'));
  const remote = path.join(root, 'remote.git'),
    producer = path.join(root, 'producer'),
    writer = path.join(root, 'writer'),
    temp = path.join(root, 'temp'),
    bin = path.join(root, 'bin'),
    calls = path.join(root, 'calls');
  mkdirSync(producer);
  mkdirSync(temp);
  mkdirSync(path.join(temp, 'release-pr'));
  mkdirSync(bin);
  writeFileSync(calls, '');
  const env = {
    PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  function git(args, cwd = producer) {
    const r = spawnSync(GIT, args, {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 512 * 1024,
    });
    assert.equal(r.error, undefined);
    assert.equal(r.signal, null);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  }
  git(['init', '--bare', remote], root);
  git(['-c', 'init.defaultBranch=main', 'init']);
  git(['remote', 'add', 'origin', remote]);
  writeFileSync(path.join(producer, 'source'), 'old\n');
  git(['add', '.']);
  git(['commit', '-m', 'initial']);
  const initial = git(['rev-parse', 'HEAD']);
  let previous = '';
  if (prior) {
    git(['checkout', '-b', 'release/next']);
    writeFileSync(path.join(producer, 'notes'), 'old proposal\n');
    git(['add', '.']);
    git(['commit', '-m', 'prior proposal']);
    previous = git(['rev-parse', 'HEAD']);
    git(['push', 'origin', 'release/next']);
    git(['checkout', 'main']);
  }
  writeFileSync(path.join(producer, 'source'), 'new\n');
  git(['add', '.']);
  git(['commit', '-m', 'new main']);
  const base = git(['rev-parse', 'HEAD']);
  git(['push', 'origin', 'main']);
  git(['checkout', '-B', 'release/next']);
  writeFileSync(path.join(producer, 'notes'), 'new proposal\n');
  git(['add', '.']);
  git(['commit', '-m', 'prepared release']);
  if (badBundle) {
    writeFileSync(path.join(producer, 'second'), 'not one commit\n');
    git(['add', '.']);
    git(['commit', '-m', 'extra commit']);
  }
  const prepared = git(['rev-parse', 'HEAD']),
    tree = git(['rev-parse', 'HEAD^{tree}']);
  git(['bundle', 'create', path.join(temp, 'release-pr/release.bundle'), base + '..release/next']);
  writeFileSync(path.join(temp, 'release-pr/notes.md'), 'Synthetic release notes.\n');
  let racing = '';
  if (race) {
    racing = git(['commit-tree', tree, '-p', previous, '-m', 'concurrent proposal']);
  }
  git(['clone', '--branch', 'main', remote, writer], root);
  const gh = String.raw`#!/NODE
const fs=require('node:fs');const a=process.argv.slice(2);
fs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\n');
if(a[0]==='pr'&&a[1]==='list'){process.stdout.write('[]\n');process.exit(0);}
if(a[0]==='pr'&&a[1]==='create'){
 process.stdout.write('https://example.invalid/pull/1\n');
 process.exit(process.env.UNCERTAIN_CREATE==='true'?1:0);
}
if(a[0]==='pr'&&a[1]==='view'){process.stdout.write('{}\n');process.exit(0);}
process.stderr.write('UNDECLARED_GH_FIXTURE\n');process.exit(92);
`;
  const shim = String.raw`#!/NODE
const cp=require('node:child_process');const a=process.argv.slice(2);
if(a[0]==='push'&&process.env.RACE==='true'){
 const q=cp.spawnSync('/usr/bin/git',['-C',process.env.PRODUCER,'push','origin',process.env.RACING+':refs/heads/release/next'],{stdio:'inherit',timeout:5000});
 if(q.status!==0)process.exit(93);
}
const r=cp.spawnSync('/usr/bin/git',a,{stdio:'inherit',timeout:5000});process.exit(r.status??94);
`;
  for (const [name, text] of [
    ['gh', gh],
    ['git', shim],
  ]) {
    const f = path.join(bin, name);
    writeFileSync(f, text.replace('#!/NODE', '#!' + process.execPath));
    chmodSync(f, 0o700);
  }
  const rows = () => readFileSync(calls, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  function run(attempt = '1', directory = writer) {
    const r = spawnSync(
      '/bin/bash',
      ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', SCRIPT],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 1024 * 1024,
        env: {
          ...env,
          PATH: bin + ':' + env.PATH,
          RUNNER_TEMP: temp,
          BASE: base,
          VERSION: '14.0.0',
          RUN_ATTEMPT: attempt,
          GH_TOKEN: 'synthetic',
          CALLS: calls,
          RACE: String(race),
          RACING: racing,
          PRODUCER: producer,
          UNCERTAIN_CREATE: String(uncertainCreate),
        },
      },
    );
    assert.equal(r.error, undefined, 'writer timeout/setup is not product behavior');
    assert.equal(r.signal, null);
    assert(!/UNDECLARED_|SyntaxError/.test(r.stderr), r.stderr);
    return r;
  }
  const head = () => git(['--git-dir', remote, 'rev-parse', 'refs/heads/release/next'], root);
  return {
    root,
    remote,
    producer,
    writer,
    temp,
    initial,
    base,
    previous,
    prepared,
    tree,
    racing,
    git,
    run,
    rows,
    head,
  };
}
test('R0 native Git: successor parents are main then prior, with the exact prepared tree', () => {
  const f = fixture();
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const head = f.head(),
    parents = f
      .git(['--git-dir', f.remote, 'rev-list', '--parents', '-n', '1', head], f.root)
      .split(' ');
  assert.deepEqual(parents.slice(1), [f.base, f.previous]);
  assert.equal(f.git(['--git-dir', f.remote, 'rev-parse', head + '^{tree}'], f.root), f.tree);
  assert.equal(f.git(['--git-dir', f.remote, 'rev-parse', 'main'], f.root), f.base);
  assert.equal(f.git(['--git-dir', f.remote, 'merge-base', 'main', head], f.root), f.base);
  assert.equal(f.rows().filter((a) => a[1] === 'create').length, 1);
  assert(f.rows().every((a) => a[1] !== 'merge'));
});
test('R0 native Git: first proposal remains one commit on main', () => {
  const f = fixture({ prior: false });
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.head(), f.prepared);
});
test('R0 native Git: a concurrent proposal move rejects the stale successor without overwriting it', () => {
  const f = fixture({ race: true });
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.equal(f.head(), f.racing);
  assert.equal(f.rows().length, 0);
  assert.match(r.stderr, /non-fast-forward|fetch first/);
});
test('R0 native Git: a malformed two-commit producer bundle never reaches a push or PR write', () => {
  const f = fixture({ badBundle: true });
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.equal(f.head(), f.previous);
  assert.equal(f.rows().length, 0);
  assert.match(r.stdout, /not one commit/);
});
test('R0 native Git: an uncertain create is GET-only on retry and a later fresh invocation of the same base', () => {
  const f = fixture({ uncertainCreate: true });
  const first = f.run();
  assert.notEqual(first.status, 0);
  const accepted = f.head();
  assert.equal(f.rows().filter((a) => a[1] === 'create').length, 1);
  assert.notEqual(f.run('2').status, 0);
  assert.equal(f.head(), accepted);
  const fresh = path.join(f.root, 'fresh-writer');
  f.git(['clone', '--branch', 'main', f.remote, fresh], f.root);
  assert.notEqual(f.run('1', fresh).status, 0);
  assert.equal(f.head(), accepted);
  assert.equal(f.rows().filter((a) => a[1] === 'create').length, 1);
});
