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
  assert(start >= 0, 'existing ' + name + ' job missing');
  const after = workflow.slice(start + 1),
    end = after.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return active(end < 0 ? after : after.slice(0, end + 1));
}
function preparation(t, label, args = []) {
  const parent = os.tmpdir();
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'release-' + label + '-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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
  assert.equal(output.error, undefined, 'preparation setup/timeout must not earn a product red');
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
test('release route: positive: unprivileged preparation remains separate from the App writer', () => {
  assert(!/create-github-app-token@/.test(job('propose')));
  assert(/create-github-app-token@/.test(job('release-pr')));
  assert(/permission-contents:\s*write/.test(job('release-pr')));
  assert(/permission-pull-requests:\s*write/.test(job('release-pr')));
  assert(!/\bnpm\s+(?:ci|install|run)\b/.test(job('release-pr')));
});
test('release route: positive: final release consumes fragments and stamps the stable version', (t) => {
  const f = preparation(t, 'final-control');
  assert.equal(JSON.parse(f.read('package.json')).version, '14.0.0');
  assert.equal(JSON.parse(f.read('package-lock.json')).version, '14.0.0');
  assert.deepEqual(readdirSync(path.join(f.root, '.changes')), []);
  assert(f.read('CAPABILITIES.md').includes('| 14.0.0 |'));
  assert(f.read('CHANGELOG.md').includes('## [14.0.0] - 2026-11-04'));
});
test('release route: release job refuses every force push spelling and force refspec', () => {
  const commands = job('release-pr');
  assert(
    !/\bgit[^\n]*\bpush[^\n]*(?:--force(?:-with-lease)?(?:[=\s]|$)|\s-f(?:\s|$)|\s\+\S+)/m.test(
      commands,
    ),
    'release-pr still rewrites a remote ref with force',
  );
});
test('release route: release job never invokes automatic PR merge', () => {
  assert(
    !/\bgh\s+pr\s+merge\b[^\n]*--auto\b/m.test(job('release-pr')),
    'release PR must wait for its exact-head verdict',
  );
});
function candidate(current, fragments, tags) {
  assert.equal(
    typeof changes.candidateVersion,
    'function',
    'candidate version function is missing',
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
test('release route: dispatch exposes a boolean RC mode in the existing workflow', () => {
  const dispatch = active(
    workflow.slice(workflow.indexOf('  workflow_dispatch:'), workflow.indexOf('\n  release:\n')),
  );
  assert(/\n      rc:\n/.test(dispatch), 'dispatch has no RC input');
  assert(/rc:\n[^]*?type: boolean/.test(dispatch), 'RC dispatch must be boolean');
  assert(job('plan').includes('mode=rc'), 'plan has no separate RC mode');
});
test('release route: pure candidate version starts at rc.0 without changing source', () => {
  assert.equal(candidate('13.2.0', [fixed()], []), '13.2.1-rc.0');
});
test('release route: pure candidate version increments only the matching candidate tag cohort', () => {
  assert.equal(
    candidate('13.2.0', [fixed()], ['v13.2.1-rc.0', 'v13.2.1-rc.9', 'v14.0.0-rc.70']),
    '13.2.1-rc.10',
  );
});
test('release route: pure candidate version preserves the major floor implied by fragments', () => {
  assert.equal(candidate('13.2.0', [fixed(), breaking()], ['v14.0.0-rc.1']), '14.0.0-rc.2');
});
test('release route: pure candidate version refuses an empty fragment set', () => {
  assert.equal(
    typeof changes.candidateVersion,
    'function',
    'candidate version function is missing',
  );
  assert.throws(() => changes.candidateVersion('13.2.0', [], []), /no fragments/i);
});
test('release route: RC never reaches proposal or docs jobs and never invokes the preparer', () => {
  assert(/needs.plan.outputs.mode == 'propose'/.test(job('propose')));
  assert(
    /needs.plan.outputs.mode == 'propose'/.test(job('release-pr')),
    'RC must never enter the App proposal writer',
  );
  assert(
    /needs.plan.outputs.mode == 'publish'/.test(job('docs')),
    'RC must never deploy docs or re-dispatch',
  );
  assert(!/--rc\b/.test(job('propose')), 'RC must not use the committing preparer');
  assert(
    job('build').includes('jq --arg version "$VERSION"'),
    'RC package version must change only after the untouched-source gates',
  );
});
test('release route: publisher disables scripts and uses an explicit tag only for RC', () => {
  const publish = job('publish');
  assert(
    publish.includes('--ignore-scripts'),
    'folder publication must disable package lifecycle scripts',
  );
  assert(
    !publish.includes('NPM_TAG=latest'),
    'stable must retain implicit npm latest safety checks',
  );
  assert(
    /jq[^\n]*version[^\n]*package.json/.test(publish),
    'publish classifies the actual staged package',
  );
});

test('release route: pure candidate refuses ambiguous matching tags', () => {
  assert.throws(
    () => changes.candidateVersion('13.2.0', [fixed()], ['v13.2.1-rc.01']),
    /noncanonical/,
  );
  assert.throws(
    () => changes.candidateVersion('13.2.0', [fixed()], ['v13.2.1-rc.9007199254740992']),
    /noncanonical/,
  );
});
test('release route: candidate preserves raise-only explicit bump selection', () => {
  assert.equal(changes.candidateVersion('13.2.0', [fixed()], [], 'minor'), '13.3.0-rc.0');
  assert.throws(() => changes.candidateVersion('13.2.0', [breaking()], [], 'patch'), /floor/);
});

function stagedPublish(
  t,
  version,
  planned = version,
  manifest = {},
  manifestBytes = null,
  sourceManifest = null,
) {
  const parent = os.tmpdir();
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'staged-')),
    bin = path.join(root, 'bin'),
    output = path.join(root, 'args');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(bin);
  writeFileSync(
    path.join(root, 'package.json'),
    manifestBytes ?? JSON.stringify({ name: 'agentfootprint', version, ...manifest }),
  );
  const npm = path.join(bin, 'npm');
  writeFileSync(npm, '#!/bin/sh\nprintf "%s\\n" "$@" > "$NPM_ARGS"\n');
  chmodSync(npm, 0o700);
  const block = job('publish'),
    marker = '        run: |\n',
    at = block.lastIndexOf(marker);
  assert(at >= 0, 'actual publisher shell missing');
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
      env: {
        PATH: bin + ':/usr/bin:/bin',
        NPM_ARGS: output,
        PLANNED_VERSION: planned,
        SOURCE_MANIFEST: JSON.stringify(
          sourceManifest ?? {
            name: 'agentfootprint',
            version: typeof version === 'string' && version.includes('-rc.') ? '13.2.0' : version,
          },
        ),
      },
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
test('release route: actual publisher shell binds canonical RC package data to npm next', (t) => {
  const { r, args } = stagedPublish(t, '14.0.0-rc.10');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(args, [
    'publish',
    '--provenance',
    '--access',
    'public',
    '--ignore-scripts',
    '--tag',
    'next',
  ]);
});
test('release route: actual publisher shell preserves stable implicit latest and disables lifecycle scripts', (t) => {
  const { r, args } = stagedPublish(t, '13.2.0');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(args, ['publish', '--provenance', '--access', 'public', '--ignore-scripts']);
});
for (const version of ['014.0.0', '14.0.0-rc.01', '14.0.0-beta.1', '14.0.0+build.1', 4]) {
  test('release route: publisher refuses unsupported package version ' + String(version), (t) => {
    const { r, args } = stagedPublish(t, version);
    assert.notEqual(r.status, 0);
    assert.deepEqual(args, []);
  });
}

test('release route: data-only candidate staging leaves lock and fragments unchanged', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-staging-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = path.join(root, 'package'),
    temp = path.join(root, 'runner');
  mkdirSync(pkg);
  mkdirSync(temp);
  mkdirSync(path.join(pkg, '.changes'));
  writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({
      name: 'synthetic-package',
      version: '13.2.0',
      scripts: { version: 'exit 88' },
    }),
  );
  const lock = '{"version":"13.2.0","lockfileVersion":3}\n',
    fragment = 'original fragment bytes\n';
  writeFileSync(path.join(pkg, 'package-lock.json'), lock);
  writeFileSync(path.join(pkg, '.changes/change.md'), fragment);
  const build = job('build'),
    start = build.indexOf('      - name: Set only the staged candidate package version');
  assert(start >= 0);
  const rest = build.slice(start),
    end = rest.indexOf('\n      - ', 1),
    step = end < 0 ? rest : rest.slice(0, end);
  const marker = '        run: |\n',
    at = step.indexOf(marker);
  assert(at >= 0);
  const script = step
    .slice(at + marker.length)
    .split('\n')
    .map((l) => (l.startsWith('          ') ? l.slice(10) : l))
    .join('\n');
  const r = spawnSync(
    '/bin/bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
    {
      cwd: pkg,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 512 * 1024,
      env: { PATH: '/usr/bin:/bin', VERSION: '14.0.0-rc.4', RUNNER_TEMP: temp },
    },
  );
  assert.equal(r.error, undefined);
  assert.equal(r.signal, null);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).version,
    '14.0.0-rc.4',
  );
  assert.equal(readFileSync(path.join(pkg, 'package-lock.json'), 'utf8'), lock);
  assert.equal(readFileSync(path.join(pkg, '.changes/change.md'), 'utf8'), fragment);
});

for (const [staged, planned] of [
  ['14.0.0', '14.0.0-rc.0'],
  ['14.0.0-rc.0', '13.2.0'],
]) {
  test('release route: publisher refuses staged version different from plan ' + staged, (t) => {
    const { r, args } = stagedPublish(t, staged, planned);
    assert.notEqual(r.status, 0);
    assert.deepEqual(args, []);
  });
}
test('release route: OIDC publisher directly needs the plan version', () => {
  assert(/needs: \[plan, build, release\]/.test(job('publish')));
  assert(job('publish').includes('PLANNED_VERSION: ${{ needs.plan.outputs.version }}'));
});

for (const config of [
  null,
  false,
  '',
  {},
  { registry: 'http://127.0.0.1:9/evil/' },
  { 'https-proxy': 'http://127.0.0.1:9/' },
  { tag: 'latest' },
])
  test(
    'release route: publisher refuses every own publishConfig ' + JSON.stringify(config),
    (t) => {
      const { r, args } = stagedPublish(t, '14.0.0-rc.10', '14.0.0-rc.10', {
        publishConfig: config,
      });
      assert.notEqual(r.status, 0);
      assert.deepEqual(args, []);
    },
  );
test('release route: staged package identity is checked before npm receives publishing authority', (t) => {
  const { r, args } = stagedPublish(t, '14.0.0-rc.10', '14.0.0-rc.10', { name: 'other-package' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(args, []);
});
test('release route: hostile lifecycle declarations cannot remove ignore-scripts from either native route', (t) => {
  for (const version of ['13.2.0', '14.0.0-rc.10']) {
    const scripts = { prepublishOnly: 'exit 91', publish: 'exit 92', postpublish: 'exit 93' };
    const { r, args } = stagedPublish(t, version, version, { scripts }, null, {
      name: 'agentfootprint',
      version: version.includes('-rc.') ? '13.2.0' : version,
      scripts,
    });
    assert.equal(r.status, 0, r.stderr);
    assert(args.includes('--ignore-scripts'));
  }
});

for (const [version, config] of [
  ['13.2.0', undefined],
  ['14.0.0-rc.10', undefined],
  ['14.0.0-rc.10', { registry: 'http://127.0.0.1:9/evil/' }],
])
  test(
    'release route: actual native tar staging reaches the guarded publisher ' +
      version +
      (config ? ' config' : ' clean'),
    (t) => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'release-tar-stage-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const input = path.join(root, 'input'),
        stage = path.join(root, 'stage'),
        bin = path.join(root, 'bin');
      for (const dir of [path.join(input, 'package/dist'), stage, bin])
        mkdirSync(dir, { recursive: true });
      const manifest = {
        name: 'agentfootprint',
        version,
        scripts: { prepublishOnly: 'exit 91' },
        ...(config ? { publishConfig: config } : {}),
      };
      writeFileSync(path.join(input, 'package/package.json'), JSON.stringify(manifest) + '\n');
      writeFileSync(path.join(input, 'package/dist/index.js'), 'exports.fixture=true;\n');
      const archive = path.join(root, 'fixture.tgz');
      const tar = spawnSync('/usr/bin/tar', ['-czf', archive, '-C', input, 'package'], {
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(tar.error, undefined);
      assert.equal(tar.signal, null);
      assert.equal(tar.status, 0, tar.stderr);
      const pack = path.join(bin, 'npm');
      writeFileSync(
        pack,
        '#!/bin/sh\n[ "$1" = pack ] || exit 90\n/bin/cp "$FIXTURE_ARCHIVE" "$PACKED_FILE"\n',
      );
      chmodSync(pack, 0o700);
      const build = job('build'),
        start = build.indexOf('      - name: Stage published package');
      assert(start >= 0);
      const block = build.slice(
        start,
        build.indexOf('      - uses: actions/upload-artifact@', start),
      );
      const match = /        run: \|\n([\s\S]*)/.exec(block);
      assert(match, 'actual native package staging shell missing');
      const script = match[1]
        .split('\n')
        .map((l) => (l.startsWith('          ') ? l.slice(10) : l))
        .join('\n');
      const staged = spawnSync(
        '/bin/bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
        {
          cwd: stage,
          encoding: 'utf8',
          timeout: 10000,
          env: {
            PATH: bin + ':/usr/bin:/bin',
            FIXTURE_ARCHIVE: archive,
            PACKED_FILE: path.join(stage, 'packed.tgz'),
          },
        },
      );
      assert.equal(staged.error, undefined);
      assert.equal(staged.signal, null);
      assert.equal(staged.status, 0, staged.stderr);
      const bytes = readFileSync(path.join(stage, 'pkg/package.json'));
      const { r, args } = stagedPublish(t, version, version, {}, bytes, {
        name: 'agentfootprint',
        version: version.includes('-rc.') ? '13.2.0' : version,
        scripts: { prepublishOnly: 'exit 91' },
      });
      assert.equal(r.status, config ? 1 : 0, r.stderr);
      if (config) assert.deepEqual(args, []);
      else {
        assert(args.includes('--ignore-scripts'));
        assert.equal(args.includes('--tag'), version.includes('-rc.'));
      }
    },
  );

for (const version of ['13.2.0', '14.0.0-rc.10'])
  for (const [key, value] of [
    ['tag', 'latest'],
    ['scripts', { postinstall: 'exit 94' }],
    ['dependencies', { unreviewed: '9.0.0' }],
    ['bin', { tool: 'dist/other.js' }],
    ['dist', { tarball: 'unreviewed' }],
  ])
    test('publisher requires pinned-source equality for ' + version + ' ' + key, (t) => {
      const { r, args } = stagedPublish(t, version, version, { [key]: value });
      assert.equal(r.status, 1);
      assert.match(r.stdout, new RegExp('manifest-source:' + key));
      assert.deepEqual(args, []);
    });
test('publisher compares missing source keys separately from null and keeps object key order irrelevant', (t) => {
  const source = {
    name: 'agentfootprint',
    version: '13.2.0',
    scripts: { build: 'source' },
    dependencies: { b: '2', a: '1' },
  };
  const ok = stagedPublish(
    t,
    '14.0.0-rc.10',
    '14.0.0-rc.10',
    { dependencies: { a: '1', b: '2' }, scripts: { build: 'source' } },
    null,
    source,
  );
  assert.equal(ok.r.status, 0, ok.r.stderr);
  for (const changed of [
    { scripts: { build: 'source' } },
    { scripts: { build: 'source' }, dependencies: null },
  ]) {
    const bad = stagedPublish(t, '14.0.0-rc.10', '14.0.0-rc.10', changed, null, source);
    assert.equal(bad.r.status, 1);
    assert.match(bad.r.stdout, /manifest-source:dependencies/);
    assert.deepEqual(bad.args, []);
  }
});
test('publisher names the first differing key without echoing unknown raw names or values', (t) => {
  const marker = 'private-value\nmarker',
    key = 'unknown-key-' + marker;
  const bad = stagedPublish(t, '14.0.0-rc.10', '14.0.0-rc.10', { [key]: marker });
  assert.equal(bad.r.status, 1);
  assert.match(bad.r.stdout, /manifest-source:key-[a-f0-9]{12}/);
  assert(!bad.r.stdout.includes(marker));
  assert(!bad.r.stderr.includes(marker));
  assert.deepEqual(bad.args, []);
});
test('publisher source is fetched before artifact extraction at the native pinned SHA', () => {
  const publish = job('publish'),
    source = publish.indexOf('- name: Read the pinned source manifest');
  assert(source >= 0, 'missing trusted source read');
  assert(source < publish.indexOf('actions/download-artifact@'));
  assert(publish.includes('SOURCE_SHA: ${{ needs.plan.outputs.sha }}'));
  assert(publish.includes('SOURCE_MANIFEST: ${{ steps.source.outputs.manifest }}'));
  assert(publish.includes('repos/$REPO/contents/package.json?ref=$SOURCE_SHA'));
  assert.equal(
    (publish.match(/GH_TOKEN:/g) || []).length,
    1,
    'read credential is scoped to the source read step only',
  );
  assert(!/npm (ci|run)/.test(publish), 'no dependency execution in the OIDC job');
});
