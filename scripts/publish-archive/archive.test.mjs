import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { archiveBytes } from './archive-fixture.mjs';
import archive from './archive.cjs';
import verifier from './verify.cjs';
const { inspectArchive, archiveRefusalCode } = archive;
const { stageCheckedArchive, refusalCode } = verifier;
const source = { name: 'agentfootprint', version: '13.2.0' };
const fixture = fileURLToPath(new URL('./fixtures/', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function workspace(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'archive-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function refuses(fn, code) {
  assert.throws(fn, (e) => refusalCode(e) === code);
}
const cases = JSON.parse(readFileSync(path.join(fixture, 'cases.json'), 'utf8'));
for (const row of cases)
  test('independent reviewer archive ' + row.file, () => {
    const bytes = readFileSync(path.join(fixture, row.file));
    assert.equal(hash(bytes), row.sha256);
    if (row.canonicalAllowed) {
      const report = inspectArchive(bytes, { package: 'foottrace', version: row.version });
      if (row.file.startsWith('T0-'))
        assert.equal(
          inspectArchive(bytes, {
            package: 'foottrace',
            version: row.version,
            sourceManifest: { name: 'foottrace', version: '1.11.0' },
          }).sha256,
          row.sha256,
        );

      assert.equal(report.sha256, row.sha256);
      // Tag overrides can be syntactically valid JSON, but cannot differ from source.
      if (row.manifestTag)
        assert.throws(
          () =>
            inspectArchive(bytes, {
              package: 'foottrace',
              version: row.version,
              sourceManifest: { name: 'foottrace', version: '1.11.0' },
            }),
          (e) => archiveRefusalCode(e) === (row.file.startsWith('T3-') ? 'manifest-source:scripts' : 'manifest-source:tag'),
        );
    } else
      assert.throws(
        () => inspectArchive(bytes, { package: 'foottrace', version: row.version }),
        (e) =>
          typeof archiveRefusalCode(e) === 'string' &&
          (!row.refusal || archiveRefusalCode(e) === row.refusal),
      );
  });
for (const name of ['package/.npmrc', 'package/binding.gyp', 'package/server.js'])
  test('noncanonical ' + name + ' is refused before even malformed manifest JSON', () => {
    const bytes = archiveBytes(source, { manifestBytes: '{invalid', extra: [[name, 'inert']] });
    refuses(
      () =>
        inspectArchive(bytes, {
          package: 'agentfootprint',
          version: source.version,
          sourceManifest: source,
        }),
      'archive-path',
    );
  });
test('known AgentFootprint roots and directories remain canonical', () => {
  const bytes = archiveBytes(source, {
    extra: [
      'AGENTS.md',
      'CAPABILITIES.md',
      'canonical-notes.json',
      'bin/cli.js',
      'ai-instructions/guide.md',
    ].map((name) => ['package/' + name, 'inert']),
  });
  assert.equal(
    inspectArchive(bytes, {
      package: 'agentfootprint',
      version: source.version,
      sourceManifest: source,
    }).files.length,
    7,
  );
});
test('stage writes exactly the once-inspected bytes into a new empty directory', (t) => {
  const root = workspace(t),
    input = path.join(root, 'input.tgz'),
    output = path.join(root, 'out');
  mkdirSync(output);
  const bytes = archiveBytes(source);
  writeFileSync(input, bytes);
  const report = stageCheckedArchive(input, output, source, source.version);
  assert.equal(report.tag, 'latest');
  assert.equal(report.report.sha256, hash(bytes));
  assert.deepEqual(readdirSync(output), ['package.tgz']);
  assert.deepEqual(readFileSync(path.join(output, 'package.tgz')), bytes);
});
test('stage refuses symlink input, symlink output and nonempty output without overwriting', (t) => {
  const root = workspace(t),
    input = path.join(root, 'input.tgz'),
    out = path.join(root, 'out');
  mkdirSync(out);
  writeFileSync(input, archiveBytes(source));
  symlinkSync(input, path.join(root, 'link.tgz'));
  refuses(
    () => stageCheckedArchive(path.join(root, 'link.tgz'), out, source, source.version),
    'archive-input',
  );
  symlinkSync(out, path.join(root, 'linkdir'));
  refuses(
    () => stageCheckedArchive(input, path.join(root, 'linkdir'), source, source.version),
    'archive-directory',
  );
  writeFileSync(path.join(out, '.npmrc'), 'inert');
  refuses(() => stageCheckedArchive(input, out, source, source.version), 'archive-directory');
  assert.deepEqual(readdirSync(out), ['.npmrc']);
});
test('current npm data-only pack and npm own reader agree on the canonical archive', async (t) => {
  const root = workspace(t),
    packdir = path.join(root, 'package'),
    out = path.join(root, 'out');
  mkdirSync(packdir);
  mkdirSync(out);
  const npmCli = process.env.NPM_CLI || process.env.npm_execpath;
  assert(npmCli, 'test needs current npm_execpath or explicit retained NPM_CLI');
  const env = {
    PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
    npm_config_cache: path.join(root, 'cache'),
    npm_config_userconfig: path.join(root, 'user.npmrc'),
    npm_config_globalconfig: path.join(root, 'global.npmrc'),
  };
  for (const name of ['user.npmrc', 'global.npmrc']) writeFileSync(path.join(root, name), '');
  const run = (args) =>
    spawnSync(process.execPath, [npmCli, ...args], {
      cwd: packdir,
      env,
      encoding: 'utf8',
      timeout: 15000,
    });
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(
    version.stdout.trim(),
    JSON.parse(readFileSync(path.join(path.dirname(path.dirname(npmCli)), 'package.json'), 'utf8'))
      .version,
  );
  const manifest = {
    ...source,
    scripts: { prepare: 'node -e "process.exit(91)"', prepack: 'node -e "process.exit(92)"' },
  };
  writeFileSync(path.join(packdir, 'package.json'), JSON.stringify(manifest));
  mkdirSync(path.join(packdir, 'dist'));
  writeFileSync(path.join(packdir, 'dist/index.js'), 'exports.fixture=true;\n');
  const packed = run([
    'pack',
    '--ignore-scripts',
    '--offline',
    '--json',
    '--pack-destination',
    out,
  ]);
  assert.equal(packed.status, 0, packed.stderr);
  const name = JSON.parse(packed.stdout)[0].filename,
    bytes = readFileSync(path.join(out, name));
  const report = inspectArchive(bytes, {
    package: 'agentfootprint',
    version: source.version,
    sourceManifest: manifest,
  });
  assert.equal(report.sha256, hash(bytes));
  assert.equal(report.files.length, 2);
  const require = createRequire(npmCli),
    pacote = require('pacote');
  const npmManifest = await pacote.manifest(path.join(out, name), {
    offline: true,
    ignoreScripts: true,
    cache: path.join(root, 'cache'),
  });
  assert.equal(npmManifest.name, report.package);
  assert.equal(npmManifest.version, report.version);
  for (const row of cases.filter((row) => row.canonicalAllowed)) {
    const actual = await pacote.manifest(path.join(fixture, row.file), {
      offline: true,
      ignoreScripts: true,
      cache: path.join(root, 'cache'),
    });
    const report = inspectArchive(readFileSync(path.join(fixture, row.file)), {
      package: 'foottrace',
      version: row.version,
    });
    assert.equal(actual.name, report.package);
    assert.equal(actual.version, report.version);
    assert.equal(
      actual.tag || (row.version.includes('-rc.') ? 'next' : 'latest'),
      row.manifestTag || (row.version.includes('-rc.') ? 'next' : 'latest'),
    );
  }
  // Read-only npm config in the staged cwd proves the hostile incoming project
  // configuration is not consulted. No publication or OIDC request is made.
  const intake = path.join(root, 'incoming'),
    publish = path.join(root, 'publish');
  mkdirSync(intake);
  mkdirSync(publish);
  writeFileSync(path.join(intake, '.npmrc'), 'registry=http://127.0.0.1:9/evil/\ntag=next\n');
  for (const [key, expected] of [
    ['registry', 'https://registry.npmjs.org/'],
    ['tag', 'latest'],
  ]) {
    const config = spawnSync(process.execPath, [npmCli, 'config', 'get', key], {
      cwd: publish,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(config.status, 0, config.stderr);
    assert.equal(config.stdout.trim(), expected);
  }
});
