import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
  rmSync,
  renameSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');
const block = workflow.slice(workflow.indexOf('\n  release-pr:\n'));
const marker = '        run: |\n',
  at = block.lastIndexOf(marker);
assert(at >= 0, 'release writer shell missing');
const SCRIPT = block
  .slice(at + marker.length)
  .split('\n')
  .map((l) => (l.startsWith('          ') ? l.slice(10) : l))
  .join('\n');
const GIT = '/usr/bin/git';

function fixture(
  t,
  { prior = true, race = false, badBundle = false, ownPr = false, fork = false } = {},
) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-proposal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git'),
    producer = path.join(root, 'producer');
  const temp = path.join(root, 'temp'),
    bin = path.join(root, 'bin');
  const calls = path.join(root, 'calls'),
    gitCalls = path.join(root, 'git-calls'),
    state = path.join(root, 'pulls.json');
  for (const dir of [producer, temp, bin]) mkdirSync(dir);
  mkdirSync(path.join(temp, 'release-pr'));
  for (const file of [calls, gitCalls]) writeFileSync(file, '');
  writeFileSync(state, JSON.stringify(ownPr ? [{ number: 101, isCrossRepository: false }] : []));
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
  git(['--git-dir', remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true'], root);
  git(['-c', 'init.defaultBranch=main', 'init']);
  git(['remote', 'add', 'origin', remote]);
  writeFileSync(path.join(producer, 'source'), 'old\n');
  git(['add', '.']);
  git(['commit', '-m', 'initial']);
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
    writeFileSync(path.join(producer, 'extra'), 'extra\n');
    git(['add', '.']);
    git(['commit', '-m', 'extra']);
  }
  const prepared = git(['rev-parse', 'HEAD']),
    tree = git(['rev-parse', 'HEAD^{tree}']);
  const bundle = path.join(temp, 'release-pr/release.bundle');
  git(['bundle', 'create', bundle, base + '..release/next']);
  writeFileSync(path.join(temp, 'release-pr/notes.md'), 'Synthetic notes.\n');
  const racing = race
    ? git(['commit-tree', tree, '-p', previous, '-m', 'concurrent proposal'])
    : '';
  const gh = String.raw`#!/NODE
const fs = require('node:fs'), a = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(a) + '\n');
const own = JSON.parse(fs.readFileSync(process.env.PR_STATE, 'utf8'));
if (a[0] === 'pr' && a[1] === 'list') {
 const fork = process.env.FORK === 'true' ? Array.from({length:30},(_,i)=>({number:900+i,isCrossRepository:true})) : [];
 process.stdout.write(JSON.stringify([...fork,...own].slice(0,30)) + '\n'); process.exit(0);
}
if (a[0] === 'api') {
 if(a[1] !== 'repos/fixture-owner/fixture-repo/pulls?state=open&base=main&head=fixture-owner:release/next') process.exit(91);
 process.stdout.write(JSON.stringify(own) + '\n');process.exit(0);
}
if (a[0] === 'pr' && a[1] === 'create') {
 if (own.length) process.exit(1);
 if (process.env.UNCERTAIN !== 'true' || process.env.APPLY === 'true')
  fs.writeFileSync(process.env.PR_STATE, JSON.stringify([{number:101,isCrossRepository:false}]));
 process.exit(process.env.UNCERTAIN === 'true' ? 1 : 0);
}
if (a[0] === 'pr' && a[1] === 'edit') process.exit(0);
process.stderr.write('UNDECLARED_GH_FIXTURE\n'); process.exit(92);
`;
  const shim = String.raw`#!/NODE
const cp = require('node:child_process'), fs = require('node:fs'), a = process.argv.slice(2);
if (a[0] === 'push') {
 fs.appendFileSync(process.env.GIT_CALLS, JSON.stringify(a) + '\n');
 if (process.env.RACE === 'true') {
  const q = cp.spawnSync('/usr/bin/git',['-C',process.env.PRODUCER,'push','origin',process.env.RACING+':refs/heads/release/next'],{stdio:'inherit',timeout:5000});
  if(q.status!==0) process.exit(93);
 }
}
const r = cp.spawnSync('/usr/bin/git', a, {stdio:'inherit',timeout:5000}); process.exit(r.status ?? 94);
`;
  for (const [name, source] of [
    ['gh', gh],
    ['git', shim],
  ]) {
    const file = path.join(bin, name);
    writeFileSync(file, source.replace('#!/NODE', '#!' + process.execPath));
    chmodSync(file, 0o700);
  }
  let writerCount = 0;
  function checkout() {
    const dir = path.join(root, 'writer-' + writerCount++);
    git(['clone', '--depth', '1', '--branch', 'main', 'file://' + remote, dir], root);
    assert.equal(git(['rev-parse', '--is-shallow-repository'], dir), 'true');
    return dir;
  }
  const writer = checkout();
  function run({ fresh = false, uncertain = false, apply = true, version = '14.0.0' } = {}) {
    const r = spawnSync(
      '/bin/bash',
      ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', SCRIPT],
      {
        cwd: fresh ? checkout() : writer,
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 1024 * 1024,
        env: {
          ...env,
          PATH: bin + ':' + env.PATH,
          RUNNER_TEMP: temp,
          BASE: base,
          VERSION: version,
          GH_TOKEN: 'synthetic',
          REPO: 'fixture-owner/fixture-repo',
          CALLS: calls,
          GIT_CALLS: gitCalls,
          PR_STATE: state,
          FORK: String(fork),
          UNCERTAIN: String(uncertain),
          APPLY: String(apply),
          RACE: String(race),
          RACING: racing,
          PRODUCER: producer,
        },
      },
    );
    assert.equal(r.error, undefined, 'writer fixture timeout/setup');
    assert.equal(r.signal, null);
    assert(!/UNDECLARED_|SyntaxError/.test(r.stderr), r.stderr);
    return r;
  }
  const rows = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const head = () => git(['--git-dir', remote, 'rev-parse', 'refs/heads/release/next'], root);
  function raised() {
    writeFileSync(path.join(producer, 'notes'), 'raised proposal\n');
    git(['add', '.']);
    const nextTree = git(['write-tree']),
      next = git(['commit-tree', nextTree, '-p', base, '-m', 'raised release']);
    git(['update-ref', 'refs/heads/release/next', next]);
    const replacement = path.join(temp, 'release-pr/raised.bundle');
    git(['bundle', 'create', replacement, base + '..release/next']);
    renameSync(replacement, bundle);
    return nextTree;
  }
  function advanceMain() {
    const next = git(['commit-tree', tree, '-p', base, '-m', 'newer main']);
    git(['push', 'origin', next + ':refs/heads/main']);
    return next;
  }
  return {
    root,
    remote,
    base,
    previous,
    prepared,
    tree,
    racing,
    git,
    writer,
    run,
    head,
    raised,
    advanceMain,
    calls: () => rows(calls),
    pushes: () => rows(gitCalls),
    pulls: () => JSON.parse(readFileSync(state, 'utf8')),
  };
}
test('release proposal: shallow successor preserves ordered parents and the exact prepared tree', (t) => {
  const f = fixture(t),
    r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const head = f.head();
  assert.deepEqual(
    f
      .git(['--git-dir', f.remote, 'rev-list', '--parents', '-n', '1', head], f.root)
      .split(' ')
      .slice(1),
    [f.base, f.previous],
  );
  assert.equal(f.git(['--git-dir', f.remote, 'rev-parse', head + '^{tree}'], f.root), f.tree);
  assert.equal(f.git(['--git-dir', f.remote, 'merge-base', 'main', head], f.root), f.base);
  assert.equal(f.git(['rev-parse', '--is-shallow-repository'], f.writer), 'true');
  assert.equal(f.pulls().length, 1);
});
test('release proposal: first proposal is one commit on main', (t) => {
  const f = fixture(t, { prior: false }),
    r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.head(), f.prepared);
});
test('release proposal: a concurrent move rejects the stale successor without overwriting it', (t) => {
  const f = fixture(t, { race: true }),
    r = f.run();
  assert.notEqual(r.status, 0);
  assert.equal(f.head(), f.racing);
  assert.equal(f.calls().length, 0);
  assert.match(r.stderr, /non-fast-forward|fetch first/);
});
test('release proposal: malformed producer bundle cannot reach a push or PR write', (t) => {
  const f = fixture(t, { badBundle: true }),
    r = f.run();
  assert.notEqual(r.status, 0);
  assert.equal(f.head(), f.previous);
  assert.equal(f.pushes().length, 0);
  assert.equal(f.calls().length, 0);
});
for (const apply of [true, false])
  test('release proposal: uncertain create converges to one PR, applied=' + apply, (t) => {
    const f = fixture(t);
    assert.notEqual(f.run({ uncertain: true, apply }).status, 0);
    const head = f.head(),
      pushes = f.pushes().length;
    const r = f.run({ fresh: true });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(f.head(), head);
    assert.equal(f.pushes().length, pushes);
    assert.equal(f.pulls().length, 1);
    assert.equal(f.calls().filter((a) => a[1] === 'create').length, apply ? 1 : 2);
  });
test('release proposal: same base and tree pushes nothing and edits the existing PR', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const head = f.head(),
    pushes = f.pushes().length;
  const r = f.run({ fresh: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.head(), head);
  assert.equal(f.pushes().length, pushes);
  assert.equal(f.calls().filter((a) => a[1] === 'create').length, 1);
  assert.equal(f.calls().filter((a) => a[1] === 'edit' && a[2] === '101').length, 1);
});
test('release proposal: same base with a raised version produces a successor', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const prior = f.head(),
    tree = f.raised();
  const r = f.run({ fresh: true, version: '14.1.0' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    f
      .git(['--git-dir', f.remote, 'rev-list', '--parents', '-n', '1', f.head()], f.root)
      .split(' ')
      .slice(1),
    [f.base, prior],
  );
  assert.equal(f.git(['--git-dir', f.remote, 'rev-parse', f.head() + '^{tree}'], f.root), tree);
  assert.equal(f.pulls().length, 1);
});
test('release proposal: main moved ends successfully without a proposal effect', (t) => {
  const f = fixture(t);
  f.advanceMain();
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.head(), f.previous);
  assert.equal(f.pushes().length, 0);
  assert.equal(f.calls().length, 0);
});
test('release proposal: a fork row cannot block or edit the own-repository PR', (t) => {
  const f = fixture(t, { fork: true, ownPr: true }),
    r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    f
      .calls()
      .filter((a) => a[1] === 'edit')
      .map((a) => a[2]),
    ['101'],
  );
  assert.equal(f.calls().filter((a) => a[1] === 'create').length, 0);
});
test('release proposal: a lone fork row does not replace own-repository creation', (t) => {
  const f = fixture(t, { fork: true }),
    r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.calls().filter((a) => a[1] === 'edit').length, 0);
  assert.equal(f.calls().filter((a) => a[1] === 'create').length, 1);
  assert.equal(f.pulls().length, 1);
});

test('release proposal: exact owner/head query is not truncated by thirty newer fork PRs', (t) => {
  const f = fixture(t, { fork: true, ownPr: true }),
    r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.calls().filter((a) => a[0] === 'pr' && a[1] === 'list').length, 0);
  assert.deepEqual(
    f.calls().filter((a) => a[0] === 'api'),
    [
      [
        'api',
        'repos/fixture-owner/fixture-repo/pulls?state=open&base=main&head=fixture-owner:release/next',
      ],
    ],
  );
});
