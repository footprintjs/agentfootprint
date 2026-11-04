import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
function job(name) {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8'),
    start = workflow.indexOf('\n  ' + name + ':\n');
  assert(start >= 0);
  const after = workflow.slice(start + 1),
    end = after.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return (end < 0 ? after : after.slice(0, end + 1))
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
}
function sourceRead(t, response, { sha = '1'.repeat(40), fail = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'publisher-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'),
    output = path.join(root, 'output'),
    args = path.join(root, 'args');
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, 'gh'),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$GH_ARGS"\nif [ "$GH_FAIL" = true ]; then echo private-response >&2; exit 1; fi\nprintf "%s" "$GH_RESPONSE"\n',
  );
  chmodSync(path.join(bin, 'gh'), 0o700);
  const publish = job('publish'),
    start = publish.indexOf('      - name: Read the pinned source manifest'),
    end = publish.indexOf('      - uses: actions/download-artifact@', start),
    step = publish.slice(start, end);
  const marker = '        run: |\n',
    at = step.indexOf(marker);
  assert(at >= 0, 'source step shell missing');
  const script = step
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
      env: {
        PATH: bin + ':/usr/bin:/bin',
        REPO: 'footprintjs/agentfootprint',
        SOURCE_SHA: sha,
        GH_TOKEN: 'fixture-read-only-token',
        GH_ARGS: args,
        GH_RESPONSE: typeof response === 'string' ? response : JSON.stringify(response),
        GH_FAIL: String(fail),
        GITHUB_OUTPUT: output,
      },
    },
  );
  assert.equal(r.error, undefined);
  assert.equal(r.signal, null);
  return {
    r,
    args: existsSync(args) ? readFileSync(args, 'utf8').trim().split('\n') : [],
    output: existsSync(output) ? readFileSync(output, 'utf8') : '',
  };
}
const sourceDto = (manifest = { name: 'agentfootprint', version: '13.2.0' }) => {
  const raw = JSON.stringify(manifest);
  return {
    type: 'file',
    encoding: 'base64',
    size: Buffer.byteLength(raw),
    content: Buffer.from(raw).toString('base64'),
  };
};
test('actual publisher source reader pins one GET and emits compact data only', (t) => {
  const manifest = { name: 'agentfootprint', version: '13.2.0', description: 'line1\nline2' },
    f = sourceRead(t, sourceDto(manifest));
  assert.equal(f.r.status, 0, f.r.stderr);
  assert.deepEqual(f.args, [
    'api',
    '--hostname',
    'github.com',
    '--method',
    'GET',
    'repos/footprintjs/agentfootprint/contents/package.json?ref=' + '1'.repeat(40),
  ]);
  assert.equal(f.output, 'manifest=' + JSON.stringify(manifest) + '\n');
  assert.equal(f.r.stdout, '');
});
for (const [label, response] of [
  ['malformed', '{'],
  ['foreign-package', sourceDto({ name: 'other', version: '13.2.0' })],
  ['missing-version', sourceDto({ name: 'agentfootprint' })],
  ['wrong-encoding', { ...sourceDto(), encoding: 'none' }],
  ['oversized', { ...sourceDto(), size: 1048577 }],
  ['directory', { ...sourceDto(), type: 'dir' }],
  ['invalid-content', { ...sourceDto(), content: 'eA==' }],
])
  test('actual publisher source reader refuses ' + label + ' with fixed diagnostics', (t) => {
    const f = sourceRead(t, response);
    assert.equal(f.r.status, 1);
    assert.equal(f.r.stdout, '::error::source-manifest:shape\n');
    assert.equal(f.output, '');
    assert(!f.r.stdout.includes('private-response'));
    assert(!f.r.stderr.includes('private-response'));
  });
test('actual publisher source reader never retries an unreadable response', (t) => {
  const f = sourceRead(t, sourceDto(), { fail: true });
  assert.equal(f.r.status, 1);
  assert.equal(f.r.stdout, '::error::source-manifest:read\n');
  assert.equal(f.args.filter((a) => a === 'api').length, 1);
  assert.equal(f.output, '');
  assert.equal(f.r.stderr, '');
});
test('actual publisher source reader refuses an unpinned source before GET', (t) => {
  const f = sourceRead(t, sourceDto(), { sha: 'main' });
  assert.equal(f.r.status, 1);
  assert.equal(f.r.stdout, '::error::source-manifest:identity\n');
  assert.deepEqual(f.args, []);
  assert.equal(f.output, '');
});

test('source-reader fixture remains registered in the hosted native release wrapper', () => {
  const wrapper = readFileSync(path.join(ROOT, 'test/docs/release-route.test.ts'), 'utf8');
  assert(wrapper.includes("'scripts/publish-source.test.mjs'"));
});
