// Inert metadata and ZIP fixtures test admission, not package compatibility.
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOriginalMember, sha256, integrity } from './zipMember.mjs';
import { validateProvider } from './provider.mjs';
import { githubInputReader } from './github.mjs';
import { collectOriginalInputs } from './intake.mjs';
import { DOCS_INPUTS, fetchDocsInputs } from './inputs.mjs';
import { apiOperation, failureDetails } from './failures.mjs';

test('the facade fixes all three admitted inputs, and callers cannot mutate their identity', () => {
  assert.deepEqual(DOCS_INPUTS.map(({ name, version, filename }) => ({ name, version, filename })), [
    { name: 'agentfootprint', version: '15.0.0-rc.0', filename: 'agentfootprint.tgz' },
    { name: 'agentfootprint-lens', version: '0.83.0', filename: 'agentfootprint-lens.tgz' },
    { name: 'footprint-explainable-ui', version: '1.1.1', filename: 'footprint-explainable-ui.tgz' },
  ]);
  assert(Object.isFrozen(DOCS_INPUTS));
  for (const selected of DOCS_INPUTS) {
    assert(Object.isFrozen(selected.tar));
    assert(Object.isFrozen(selected.runs[0].jobs));
    assert.match(selected.source.head, /^[0-9a-f]{40}$/);
    assert.match(selected.source.tree, /^[0-9a-f]{40}$/);
    assert.equal(selected.tested.tree, selected.source.tree);
    assert.equal(selected.tested.parents[1], selected.source.head);
    assert.match(selected.tar.sha256, /^[0-9a-f]{64}$/);
    assert.match(selected.tar.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    assert.match(selected.artifact.sha256, /^[0-9a-f]{64}$/);
    assert(selected.runs.some((r) => r.id === selected.artifact.runId));
  }
  assert.throws(() => { DOCS_INPUTS[0].tar.sha256 = '0'.repeat(64); }, TypeError);
});

test('the only non-success producer gate is the exact admitted AF docs bootstrap hold', () => {
  const failed = DOCS_INPUTS.flatMap((s) => s.runs.flatMap((r) => r.jobs
    .filter((j) => j.conclusion !== 'success').map((j) => ({ repository: s.repository, ...j }))));
  assert.deepEqual(failed, [{ repository: 'footprintjs/agentfootprint', id: 134504312782,
    name: 'docs', conclusion: 'failure' }]);
  assert.deepEqual(DOCS_INPUTS.map((s) => s.runs.reduce((sum, r) => sum + r.jobs.length, 0)), [27, 21, 4]);
});

test('public intake cannot use a caller plan or invoke local credential fallback', () => withJobEnv(() => {
  delete process.env.GITHUB_ACTIONS;
  assert.throws(() => fetchDocsInputs('/must-not-create'), /hosted-downloader-only/);
}));

test('fixed URL grammar accepts every configured repository, run and original artifact', () => {
  for (const input of DOCS_INPUTS) {
    const paths = [`git/commits/${input.source.head}`, `git/commits/${input.tested.head}`,
      `actions/artifacts/${input.artifact.id}`, `actions/artifacts/${input.artifact.id}/zip`,
      ...input.runs.flatMap((r) => [`actions/runs/${r.id}`,
        `actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`])];
    for (const path of paths) {
      assert.equal(apiOperation(`repos/${input.repository}/${path}`).repository, input.repository);
    }
  }
  assert.throws(() => apiOperation('repos/footprintjs/unconfigured/actions/runs/1'), /fixed-api-path/);
  assert.throws(() => apiOperation('repos/footprintjs/agentfootprint/actions/runs/1?token=private'), /fixed-api-path/);
});

function fixture() {
  const selected = { repository: 'footprintjs/agentfootprint', repositoryId: 7,
    source: { head: 'a'.repeat(40), tree: 'b'.repeat(40) },
    tested: { head: 'c'.repeat(40), parents: ['d'.repeat(40), 'a'.repeat(40)] },
    runs: [{ id: 11, workflow_id: 13, run_attempt: 1, head_branch: 'branch',
      event: 'pull_request', conclusion: 'success', jobs: [{ id: 17, name: 'test (24)', conclusion: 'success' }] }],
    artifact: { id: 19, name: 'original', bytes: 23, sha256: 'e'.repeat(64), runId: 11,
      member: 'package.tgz' }, tar: { bytes: 3 } };
  const run = { ...selected.runs[0], status: 'completed', head_sha: selected.source.head,
    repository: { id: 7, full_name: selected.repository, private: false },
    head_commit: { id: selected.source.head, tree_id: selected.source.tree } };
  delete run.jobs;
  const actual = { source: { sha: selected.source.head, tree: { sha: selected.source.tree } },
    tested: { sha: selected.tested.head, tree: { sha: selected.source.tree },
      parents: selected.tested.parents.map((sha) => ({ sha })) },
    runs: [{ run, jobs: { total_count: 1, jobs: [{ id: 17, name: 'test (24)',
      conclusion: 'success', status: 'completed', run_id: 11, run_attempt: 1,
      head_sha: selected.source.head }] } }], artifact: { id: 19, name: 'original',
      size_in_bytes: 23, digest: `sha256:${selected.artifact.sha256}`, expired: false,
      workflow_run: { id: 11, repository_id: 7, head_repository_id: 7,
        head_sha: selected.source.head, head_branch: 'branch' } } };
  return { selected, actual };
}

test('matching source, tested tree, all jobs and artifact join are admitted', () => {
  const { selected, actual } = fixture();
  validateProvider(selected, actual);
});

const metadataFaults = {
  'wrong source commit': (v) => { v.source.sha = '0'.repeat(40); },
  'wrong source tree': (v) => { v.source.tree.sha = '0'.repeat(40); },
  'wrong tested commit': (v) => { v.tested.sha = '0'.repeat(40); },
  'wrong tested tree': (v) => { v.tested.tree.sha = '0'.repeat(40); },
  'wrong tested parent order': (v) => { v.tested.parents.reverse(); },
  'wrong attempt': (v) => { v.runs[0].run.run_attempt = 2; },
  'wrong workflow': (v) => { v.runs[0].run.workflow_id++; },
  'wrong branch': (v) => { v.runs[0].run.head_branch = 'other'; },
  'wrong event': (v) => { v.runs[0].run.event = 'push'; },
  'pending run': (v) => { v.runs[0].run.status = 'in_progress'; },
  'failed run': (v) => { v.runs[0].run.conclusion = 'failure'; },
  'wrong repository identity': (v) => { v.runs[0].run.repository.id++; },
  'private repository': (v) => { v.runs[0].run.repository.private = true; },
  'wrong run tree': (v) => { v.runs[0].run.head_commit.tree_id = '0'.repeat(40); },
  'incomplete paginated jobs': (v) => { v.runs[0].jobs.total_count++; },
  'missing required job': (v) => { v.runs[0].jobs.jobs = []; },
  'failed required job': (v) => { v.runs[0].jobs.jobs[0].conclusion = 'failure'; },
  'renamed required job': (v) => { v.runs[0].jobs.jobs[0].name = 'other'; },
  'wrong job source': (v) => { v.runs[0].jobs.jobs[0].head_sha = '0'.repeat(40); },
  'wrong job attempt': (v) => { v.runs[0].jobs.jobs[0].run_attempt++; },
  'wrong artifact identity': (v) => { v.artifact.id++; },
  'wrong artifact digest': (v) => { v.artifact.digest = `sha256:${'0'.repeat(64)}`; },
  'wrong artifact length': (v) => { v.artifact.size_in_bytes++; },
  'expired original': (v) => { v.artifact.expired = true; },
  'artifact from another run': (v) => { v.artifact.workflow_run.id++; },
  'artifact from fork': (v) => { v.artifact.workflow_run.head_repository_id++; },
};
for (const [name, change] of Object.entries(metadataFaults)) {
  test(`refuses ${name}`, () => {
    const { selected, actual } = fixture();
    change(actual);
    assert.throws(() => validateProvider(selected, actual), /docs-input-/);
  });
}

test('duplicate IDs cannot conceal a missing required job', () => {
  const { selected, actual } = fixture();
  selected.runs[0].jobs.push({ id: 18, name: 'types', conclusion: 'success' });
  actual.runs[0].jobs.total_count = 2;
  actual.runs[0].jobs.jobs.push({ ...actual.runs[0].jobs.jobs[0] });
  assert.throws(() => validateProvider(selected, actual), /duplicate-jobs/);
});

test('only the specifically pinned deferred conclusion is admitted', () => {
  const { selected, actual } = fixture();
  selected.runs[0].conclusion = actual.runs[0].run.conclusion = 'failure';
  selected.runs[0].jobs[0].conclusion = actual.runs[0].jobs.jobs[0].conclusion = 'failure';
  validateProvider(selected, actual);
  actual.runs[0].jobs.jobs[0].conclusion = 'cancelled';
  assert.throws(() => validateProvider(selected, actual), /job-conclusion/);
});

const zipProgram = `
import sys, json, io, zipfile, stat
data=json.load(sys.stdin)
out=io.BytesIO()
with zipfile.ZipFile(out, 'w') as z:
 for item in data:
  entry=zipfile.ZipInfo(item['name'])
  entry.create_system=3
  entry.external_attr=(stat.S_IFLNK | 0o777 if item.get('link') else stat.S_IFREG | 0o644)<<16
  entry.compress_type=zipfile.ZIP_DEFLATED
  z.writestr(entry, item['body'].encode())
sys.stdout.buffer.write(out.getvalue())
`;
function zip(entries = [{ name: 'package.tgz', body: 'inert archive bytes' }]) {
  const p = childProcess.spawnSync('python3', ['-B', '-c', zipProgram], {
    input: JSON.stringify(entries), timeout: 10_000, maxBuffer: 1_000_000,
    env: { PATH: process.env.PATH },
  });
  assert.equal(p.status, 0);
  return p.stdout;
}
function zipFixture(entries) {
  const bytes = zip(entries);
  const body = Buffer.from('inert archive bytes');
  const selected = { artifact: { bytes: bytes.length, sha256: sha256(bytes), member: 'package.tgz' },
    tar: { bytes: body.length, sha256: sha256(body), integrity: integrity(body) } };
  return { bytes, body, selected };
}

test('returns only the unchanged selected regular bytes', () => {
  const { bytes, body, selected } = zipFixture([
    { name: 'other.txt', body: 'never materialized' },
    { name: 'package.tgz', body: 'inert archive bytes' },
  ]);
  assert.deepEqual(readOriginalMember(bytes, selected), body);
});

test('a ZIP identity refusal happens before the ZIP interpreter is invoked', () => {
  const { bytes, selected } = zipFixture();
  selected.artifact.sha256 = '0'.repeat(64);
  let calls = 0;
  mock.method(childProcess, 'spawnSync', () => { calls++; throw new Error('must not spawn'); });
  syncBuiltinESMExports();
  try {
    assert.throws(() => readOriginalMember(bytes, selected), /zip-identity/);
    assert.equal(calls, 0);
  } finally { mock.restoreAll(); syncBuiltinESMExports(); }
});

test('the ZIP interpreter receives neither tokens nor Node/Python injection settings', () => withJobEnv(() => {
  const { bytes, body, selected } = zipFixture();
  process.env.PYTHONPATH = '/untrusted';
  process.env.PYTHONSTARTUP = '/untrusted';
  let captured;
  mock.method(childProcess, 'spawnSync', (command, args, options) => {
    captured = { command, args, options };
    return { status: 0, signal: null, stdout: body, stderr: Buffer.alloc(0) };
  });
  syncBuiltinESMExports();
  try {
    readOriginalMember(bytes, selected);
    assert.equal(captured.command, 'python3');
    assert.equal(captured.args[0], '-B');
    assert.deepEqual(captured.options.input, bytes);
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONSTARTUP']) {
      assert.equal(captured.options.env[key], undefined);
    }
  } finally { mock.restoreAll(); syncBuiltinESMExports(); }
}));

for (const [name, change] of Object.entries({
  'ZIP digest': (s) => { s.artifact.sha256 = '0'.repeat(64); },
  'ZIP byte count': (s) => { s.artifact.bytes++; },
  'tar digest': (s) => { s.tar.sha256 = '0'.repeat(64); },
  'tar integrity': (s) => { s.tar.integrity = integrity(Buffer.from('other')); },
  'tar byte count': (s) => { s.tar.bytes++; },
  'missing selected name': (s) => { s.artifact.member = 'missing.tgz'; },
})) {
  test(`refuses changed ${name}`, () => {
    const { bytes, selected } = zipFixture();
    change(selected);
    assert.throws(() => readOriginalMember(bytes, selected), /docs-input-/);
  });
}
for (const [name, entries] of Object.entries({
  'selected symlink': [{ name: 'package.tgz', body: 'inert archive bytes', link: true }],
  'duplicate member': [{ name: 'package.tgz', body: 'inert archive bytes' },
    { name: 'package.tgz', body: 'inert archive bytes' }],
  'case collision': [{ name: 'package.tgz', body: 'inert archive bytes' },
    { name: 'PACKAGE.tgz', body: 'inert archive bytes' }],
  'traversal member': [{ name: 'package.tgz', body: 'inert archive bytes' },
    { name: '../unused', body: 'bad path' }],
  'absolute member': [{ name: '/package.tgz', body: 'inert archive bytes' }],
})) {
  test(`refuses ${name} without extracting files`, () => {
    const { bytes, selected } = zipFixture(entries);
    assert.throws(() => readOriginalMember(bytes, selected), /zip-refused/);
  });
}

function withJobEnv(fn) {
  const saved = process.env;
  process.env = { PATH: saved.PATH, GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'footprintjs/agentfootprint', GITHUB_TOKEN: 'inert-fixture-token',
    NODE_OPTIONS: '--untrusted', NPM_TOKEN: 'must-not-reach-child', HOME: '/not-a-credential-source' };
  try { return fn(); } finally { process.env = saved; }
}

test('GH receives only the existing job token and an empty isolated configuration', () => withJobEnv(() => {
  const calls = [];
  mock.method(childProcess, 'spawnSync', (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: Buffer.from('{}'), stderr: Buffer.alloc(0), status: 0, signal: null };
  });
  syncBuiltinESMExports();
  let reader;
  try {
    reader = githubInputReader();
    reader.get('repos/footprintjs/agentfootprint/actions/runs/11');
    const { command, args, options } = calls[0];
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', '--hostname', 'github.com', '--method', 'GET',
      'repos/footprintjs/agentfootprint/actions/runs/11']);
    assert.equal(options.env.GH_TOKEN, 'inert-fixture-token');
    for (const key of ['HOME', 'NODE_OPTIONS', 'NPM_TOKEN', 'GITHUB_TOKEN']) assert.equal(options.env[key], undefined);
    assert.equal(options.env.GH_HOST, 'github.com');
    assert(existsSync(options.env.GH_CONFIG_DIR));
    reader.close();
    assert(!existsSync(options.env.GH_CONFIG_DIR));
  } finally { reader?.close(); mock.restoreAll(); syncBuiltinESMExports(); }
}));

test('GH device state stays in its owned temporary directory and is removed on close', () => withJobEnv(() => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'docs-gh-state-unit-')));
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  writeFileSync(join(workspace, 'preserve.txt'), 'not owned by the downloader');
  process.chdir(workspace);
  let captured;
  let device;
  let reader;
  // Model gh's observed no-HOME/XDG fallback without executing gh or making a request.
  mock.method(childProcess, 'spawnSync', (_command, _args, options) => {
    captured = options;
    const state = options.env.XDG_STATE_HOME || join(options.env.HOME || options.cwd || process.cwd(), '.local', 'state');
    mkdirSync(join(state, 'gh'), { recursive: true });
    device = join(state, 'gh', 'device-id');
    writeFileSync(device, 'inert-device-id');
    return { stdout: Buffer.from('{}'), stderr: Buffer.alloc(0), status: 0, signal: null };
  });
  syncBuiltinESMExports();
  try {
    reader = githubInputReader();
    reader.get('repos/footprintjs/agentfootprint/actions/runs/11');
    assert(existsSync(device));
    reader.close();
    assert.deepEqual(readdirSync(workspace), ['preserve.txt'], 'gh must not leave .local/state/gh/device-id in the source cwd');
    assert(!existsSync(device), 'owned gh device state must be cleaned');
    assert.equal(captured.cwd, captured.env.GH_CONFIG_DIR);
    for (const [key, child] of [['XDG_STATE_HOME', 'state'], ['XDG_CACHE_HOME', 'cache'], ['XDG_DATA_HOME', 'data']]) {
      assert.equal(captured.env[key], join(captured.cwd, child));
    }
    assert.equal(captured.env.HOME, undefined);
    assert.equal(process.env.HOME, originalHome);
  } finally {
    reader?.close();
    mock.restoreAll();
    syncBuiltinESMExports();
    process.chdir(originalCwd);
    rmSync(workspace, { recursive: true, force: true });
  }
}));

test('the downloader refuses missing tokens and local invocation before spawning', () => withJobEnv(() => {
  delete process.env.GITHUB_TOKEN;
  assert.throws(() => githubInputReader(), /job-token-required/);
  process.env.GITHUB_TOKEN = 'inert';
  delete process.env.GITHUB_ACTIONS;
  assert.throws(() => githubInputReader(), /hosted-downloader-only/);
}));

test('authentication output is never included in refusal text', () => withJobEnv(() => {
  mock.method(childProcess, 'spawnSync', () => ({ status: 1, signal: null,
    stdout: Buffer.alloc(0), stderr: Buffer.from('secret-fixture-detail HTTP 403') }));
  syncBuiltinESMExports();
  const reader = githubInputReader();
  try {
    assert.throws(() => reader.get('repos/footprintjs/agentfootprint/actions/runs/11'), (error) => {
      assert.deepEqual(failureDetails(error), { code: 'docs-input-api-read-refused',
        repository: 'footprintjs/agentfootprint', operation: 'metadata',
        target: 'actions/runs/11', httpStatus: 403 });
      return !JSON.stringify(failureDetails(error)).includes('secret-fixture-detail');
    });
  } finally { reader.close(); mock.restoreAll(); syncBuiltinESMExports(); }
}));

test('unclassified failure output cannot carry foreign messages or injected operation fields', () => {
  const error = Object.assign(new Error('secret-fixture-detail'), { repository: 'secret-fixture-detail' });
  assert.deepEqual(failureDetails(error), { code: 'docs-input-intake-refused' });
});

function intakeFixture(fn) {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'docs-input-unit-')));
  const source = join(temporary, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'preserve.txt'), 'source is never altered');
  const z = zipFixture();
  const f = fixture();
  Object.assign(f.selected.artifact, z.selected.artifact);
  f.selected.tar = z.selected.tar;
  f.selected.filename = 'agentfootprint.tgz';
  Object.assign(f.actual.artifact, { size_in_bytes: z.bytes.length,
    digest: `sha256:${sha256(z.bytes)}` });
  const calls = [];
  const reader = { get(path) {
    calls.push(path);
    if (path.endsWith('/zip')) return z.bytes;
    const values = {
      [`git/commits/${f.selected.source.head}`]: f.actual.source,
      [`git/commits/${f.selected.tested.head}`]: f.actual.tested,
      'actions/runs/11': f.actual.runs[0].run,
      'actions/runs/11/attempts/1/jobs?per_page=100': f.actual.runs[0].jobs,
      'actions/artifacts/19': f.actual.artifact,
    };
    const value = values[path.replace(`repos/${f.selected.repository}/`, '')];
    assert(value, `unexpected fixture endpoint ${path}`);
    return Buffer.from(JSON.stringify(value));
  } };
  try { fn({ temporary, source, out: join(temporary, 'inputs'), calls, reader, ...z, ...f }); }
  finally { rmSync(temporary, { recursive: true, force: true }); }
}

test('materializes the original bytes and one reusable identity receipt outside source', () => intakeFixture((f) => {
  const receipt = collectOriginalInputs([f.selected], f.out, f.source, f.reader);
  assert.deepEqual(readFileSync(join(f.out, 'agentfootprint.tgz')), f.body);
  assert.deepEqual(JSON.parse(readFileSync(join(f.out, 'inputs.json'))), receipt);
  assert.equal(receipt.inputTableSha256, sha256(Buffer.from(JSON.stringify([f.selected]))));
  assert.equal(f.calls.filter((p) => p.endsWith('/zip')).length, 1);
  assert.equal(readFileSync(join(f.source, 'preserve.txt'), 'utf8'), 'source is never altered');
}));

test('no archive downloads occur if any provider is refused', () => intakeFixture((f) => {
  const second = structuredClone(f.selected);
  second.source.tree = '0'.repeat(40);
  assert.throws(() => collectOriginalInputs([f.selected, second], f.out, f.source, f.reader), (error) => {
    assert.deepEqual(failureDetails(error), { code: 'docs-input-source-tree',
      repository: f.selected.repository, operation: 'metadata', runId: 11, artifactId: 19 });
    return true;
  });
  assert.equal(f.calls.filter((p) => p.endsWith('/zip')).length, 0);
  assert.deepEqual(readdirSync(f.out), []);
}));

test('partial failure removes only original files this invocation wrote', () => intakeFixture((f) => {
  const second = structuredClone(f.selected);
  second.filename = 'agentfootprint-lens.tgz';
  second.tar.sha256 = '0'.repeat(64);
  assert.throws(() => collectOriginalInputs([f.selected, second], f.out, f.source, f.reader), /tar-identity/);
  assert.deepEqual(readdirSync(f.out), []);
  assert.equal(readFileSync(join(f.source, 'preserve.txt'), 'utf8'), 'source is never altered');
}));

test('a partial disk write removes its own incomplete file', () => intakeFixture((f) => {
  const original = fs.writeFileSync;
  mock.method(fs, 'writeFileSync', (fd, bytes) => {
    assert.equal(typeof fd, 'number');
    original(fd, bytes.subarray(0, 3));
    throw new Error('inert-short-write');
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => collectOriginalInputs([f.selected], f.out, f.source, f.reader), /inert-short-write/);
    assert.deepEqual(readdirSync(f.out), []);
  } finally { mock.restoreAll(); syncBuiltinESMExports(); }
}));

test('refuses output inside the source before any provider read', () => intakeFixture((f) => {
  assert.throws(() => collectOriginalInputs([f.selected], join(f.source, 'inputs'), f.source, f.reader),
    /outside-source/);
  assert.equal(f.calls.length, 0);
}));

test('refuses a nonempty output and preserves its contents', () => intakeFixture((f) => {
  mkdirSync(f.out);
  writeFileSync(join(f.out, 'other-task.txt'), 'keep');
  assert.throws(() => collectOriginalInputs([f.selected], f.out, f.source, f.reader), /output-empty/);
  assert.equal(readFileSync(join(f.out, 'other-task.txt'), 'utf8'), 'keep');
  assert.equal(f.calls.length, 0);
}));

test('refuses a symlink output and a source alias', () => intakeFixture((f) => {
  const elsewhere = join(f.temporary, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, f.out, 'dir');
  assert.throws(() => collectOriginalInputs([f.selected], f.out, f.source, f.reader), /output-directory/);
  const alias = join(f.temporary, 'source-alias');
  symlinkSync(f.source, alias, 'dir');
  assert.throws(() => collectOriginalInputs([f.selected], join(alias, 'inputs'), f.source, f.reader),
    /outside-source/);
  assert.equal(f.calls.length, 0);
}));
